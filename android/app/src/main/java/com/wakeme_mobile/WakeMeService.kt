package com.wakeme_mobile

import android.Manifest
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.speech.tts.TextToSpeech
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import kotlin.math.*

class WakeMeService : Service() {

    companion object {
        const val CHANNEL_TRACKING    = "wakeme-tracking"
        const val CHANNEL_ALERT       = "wakeme-alert"
        const val CHANNEL_DESTINATION = "wakeme-destination"  // 하차 전용 채널 (강진동)
        const val FG_NOTIF_ID         = 9001
        const val DEFAULT_ALERT_RADIUS_M = 500.0  // 환승/하차 준비 알림 반경 기본값 (미터) — 사용자가 500/700/900/1200 중 선택 가능
        const val FINAL_DEST_RADIUS_M = 50.0    // 최종 목적지(주소) 도착 반경 (미터)
        const val POLL_INTERVAL_MS    = 5_000L  // 5초 GPS 폴링 간격
        const val GPS_LOG_INTERVAL_MS = 30_000L // 서버 로그 전송 간격 (30초 1회)
        const val MAX_ACCURACY_M      = 50f     // 이 값 초과 GPS는 무시 (지상 버스 전용)
    }

    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private var locationCallback: LocationCallback? = null

    /**
     * 이미 알림 보낸 waypoint ID 집합.
     * 날짜(YYYY-MM-DD)별로 SharedPreferences에 영구 저장해
     * 서비스 재시작 후에도 중복 알림을 방지하고, 다음 날 자동 초기화.
     */
    private val notifiedWaypoints: MutableSet<String> by lazy { loadNotifiedWaypoints() }

    private fun todayStr(): String {
        val cal = java.util.Calendar.getInstance()
        return "%04d-%02d-%02d".format(
            cal.get(java.util.Calendar.YEAR),
            cal.get(java.util.Calendar.MONTH) + 1,
            cal.get(java.util.Calendar.DAY_OF_MONTH),
        )
    }

    private fun loadNotifiedWaypoints(): MutableSet<String> {
        val prefs     = getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)
        val savedDate = prefs.getString("notified_date", "")
        val today     = todayStr()
        return if (savedDate == today) {
            val raw = prefs.getString("notified_waypoints", "") ?: ""
            android.util.Log.i("WAKE", "notifiedWaypoints 복원: $raw")
            if (raw.isEmpty()) mutableSetOf() else raw.split(",").toMutableSet()
        } else {
            android.util.Log.i("WAKE", "새로운 날짜 → notifiedWaypoints 초기화 (이전: $savedDate)")
            prefs.edit().putString("notified_date", today).putString("notified_waypoints", "").apply()
            mutableSetOf()
        }
    }

    private fun persistNotifiedWaypoints() {
        getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("notified_date", todayStr())
            .putString("notified_waypoints", notifiedWaypoints.joinToString(","))
            .apply()
    }

    // 서버 GPS 로그 마지막 전송 시각
    private val lastGpsPollLogTime: Long
        get() = getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)
                    .getLong("last_gps_poll_log_time", 0L)
    private fun saveGpsPollLogTime(t: Long) =
        getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putLong("last_gps_poll_log_time", t).apply()

    // 마지막 정상 GPS 위치
    @Volatile private var lastKnownLat  = Double.NaN
    @Volatile private var lastKnownLng  = Double.NaN
    @Volatile private var lastKnownAcc  = Float.MAX_VALUE
    @Volatile private var lastKnownTime = 0L

    // 경로별 운행 요일 맵 { routeId → daysOfWeek }
    private var routeDaysMap: Map<String, List<Int>> = emptyMap()

    // 이어폰 연결 시 TTS 음성 안내
    private var tts: TextToSpeech? = null

    override fun onCreate() {
        super.onCreate()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        createNotificationChannels()

        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = java.util.Locale.KOREAN
                android.util.Log.i("WAKE", "TTS 초기화 완료")
            } else {
                android.util.Log.w("WAKE", "TTS 초기화 실패: status=$status")
                tts = null
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(FG_NOTIF_ID, buildTrackingNotification())

        val prefs = getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)

        val allRoutesJson = intent?.getStringExtra(WakeMeServiceModule.KEY_ACTIVE_ROUTES)
            ?: prefs.getString(WakeMeServiceModule.KEY_ACTIVE_ROUTES, null)

        val waypoints: List<Waypoint>
        val destText: String

        if (!allRoutesJson.isNullOrEmpty() && allRoutesJson != "[]") {
            waypoints = WakeMeGeofenceReceiver.parseAllRouteWaypoints(allRoutesJson)
            destText  = try {
                val count = org.json.JSONArray(allRoutesJson).length()
                if (count > 1) "${count}개 경로 모니터링 중"
                else WakeMeGeofenceReceiver.lastDestinationName(allRoutesJson)
            } catch (e: Exception) {
                WakeMeGeofenceReceiver.lastDestinationName(allRoutesJson)
            }
        } else {
            val routeId = intent?.getStringExtra(WakeMeServiceModule.KEY_ROUTE_ID)
                ?: prefs.getString(WakeMeServiceModule.KEY_ROUTE_ID, "") ?: ""
            if (routeId.isEmpty()) {
                stopForeground(true); stopSelf(); return START_NOT_STICKY
            }
            val waypointsJson = intent?.getStringExtra(WakeMeServiceModule.KEY_WAYPOINTS)
                ?: prefs.getString(WakeMeServiceModule.KEY_WAYPOINTS, "[]") ?: "[]"
            waypoints = WakeMeGeofenceReceiver.parseWaypoints(waypointsJson)
            destText  = waypoints.lastOrNull()?.name ?: ""
        }

        if (waypoints.isEmpty()) {
            android.util.Log.w("WAKE", "waypoints 없음 → 서비스 종료")
            stopForeground(true); stopSelf(); return START_NOT_STICKY
        }

        val routeDepartMap = WakeMeGeofenceReceiver.buildRouteDepartMap(allRoutesJson)
        routeDaysMap       = WakeMeGeofenceReceiver.buildRouteDaysMap(allRoutesJson)

        // 오늘 운행 요일 체크
        val anyActiveToday = if (routeDaysMap.isEmpty()) true
        else routeDaysMap.values.any { days -> WakeMeGeofenceReceiver.isActiveToday(days) }
        if (!anyActiveToday) {
            android.util.Log.i("WAKE", "오늘 운행 요일 아님 → 서비스 미시작")
            stopForeground(true); stopSelf(); return START_NOT_STICKY
        }

        // 시간창 체크
        val anyInWindow = if (routeDepartMap.isEmpty()) true
        else routeDepartMap.values.any { dt ->
            dt.isBlank() || WakeMeGeofenceReceiver.isWithinServiceWindow(dt)
        }
        if (!anyInWindow) {
            android.util.Log.i("WAKE", "모든 경로 시간창 밖 → 서비스 미시작")
            stopForeground(true); stopSelf(); return START_NOT_STICKY
        }

        startForeground(FG_NOTIF_ID, buildTrackingNotification(destText))

        locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
        startLocationUpdates(waypoints, routeDepartMap)

        android.util.Log.i("WAKE", "GPS 폴링 시작: waypoints=${waypoints.size}개, routes=${routeDepartMap.size}개")
        waypoints.forEach { android.util.Log.i("WAKE", "  → ${it.id} ${it.name} (${it.type})") }

        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
        tts?.shutdown(); tts = null
        sendShutdownLog()

        val prefs = getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)
        val hasRoutes = !prefs.getString(WakeMeServiceModule.KEY_ACTIVE_ROUTES, null).isNullOrEmpty()
        if (hasRoutes) {
            android.util.Log.i("WAKE", "onDestroy: 경로 잔존 → RESTART_SERVICE 전송")
            sendBroadcast(Intent("com.wakeme_mobile.RESTART_SERVICE"))
        } else {
            android.util.Log.i("WAKE", "onDestroy: 경로 없음 → 재시작 안 함")
        }
    }

    private fun sendShutdownLog() {
        val prefs   = getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)
        val userId  = prefs.getString(WakeMeServiceModule.KEY_USER_ID, "unknown") ?: "unknown"
        val routeId = prefs.getString(WakeMeServiceModule.KEY_ROUTE_ID, "") ?: ""
        Thread {
            try {
                val url  = java.net.URL("https://wakeme-api.fly.dev/api/notify/shutdown")
                val conn = url.openConnection() as java.net.HttpURLConnection
                conn.requestMethod = "POST"; conn.doOutput = true
                conn.connectTimeout = 3000; conn.readTimeout = 3000
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                val body = org.json.JSONObject().apply {
                    put("userId", userId); put("routeId", routeId); put("reason", "onDestroy")
                }.toString()
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                conn.responseCode; conn.disconnect()
            } catch (e: Exception) {
                android.util.Log.w("WAKE", "shutdown 로그 전송 실패: ${e.message}")
            }
        }.start()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── 포그라운드 알림 업데이트 ──────────────────────────────────────

    private fun updateForegroundNotification(alertText: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val pi = PendingIntent.getActivity(
            this, 0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE,
        )
        nm.notify(FG_NOTIF_ID, NotificationCompat.Builder(this, CHANNEL_TRACKING)
            .setContentTitle("WakeMe 알림")
            .setContentText(alertText)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pi)
            .setOngoing(false)
            .build())
    }

    // ── GPS 폴링 (버스 전용 — 지상 GPS만 사용) ────────────────────────

    private fun startLocationUpdates(
        waypoints:      List<Waypoint>,
        routeDepartMap: Map<String, String>,
    ) {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
            android.util.Log.w("WAKE", "위치 권한 없음 → GPS 폴링 미시작")
            return
        }

        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, POLL_INTERVAL_MS)
            .setMinUpdateIntervalMillis(3_000L)
            .build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                // result.lastLocation은 deprecated + Play Services 내부에서
                // locations.get(size-1) race condition → IndexOutOfBoundsException 발생 가능.
                // locations.lastOrNull()로 직접 접근해 방어.
                val loc = try {
                    result.locations.lastOrNull() ?: result.lastLocation
                } catch (e: Exception) {
                    android.util.Log.w("WAKE_GPS", "lastLocation 접근 실패, locations 직접 사용: ${e.message}")
                    result.locations.lastOrNull()
                } ?: return

                // 정확도 낮은 GPS 무시 (지상 버스 환경에서 50m 초과는 신뢰 불가)
                if (loc.accuracy > MAX_ACCURACY_M) {
                    android.util.Log.d("WAKE_GPS",
                        "[GPS 스킵] acc=${loc.accuracy}m > ${MAX_ACCURACY_M}m")
                    return
                }

                lastKnownLat  = loc.latitude
                lastKnownLng  = loc.longitude
                lastKnownAcc  = loc.accuracy
                lastKnownTime = System.currentTimeMillis()

                // 시간창 만료 체크
                val anyInWindow = routeDepartMap.values.any { dt ->
                    dt.isBlank() || WakeMeGeofenceReceiver.isWithinServiceWindow(dt)
                }
                if (!anyInWindow) {
                    android.util.Log.i("WAKE_GPS", "⏰ 시간창 종료 → GPS 폴링 중지")
                    fusedLocationClient.removeLocationUpdates(locationCallback!!)
                    stopForeground(true); stopSelf(); return
                }

                android.util.Log.i("WAKE_GPS",
                    "[GPS] ${loc.latitude}, ${loc.longitude} acc=${loc.accuracy}m")

                checkNearbyWaypoints(loc.latitude, loc.longitude, waypoints, routeDepartMap)
                sendGpsPollLogThrottled(loc.latitude, loc.longitude, loc.accuracy, waypoints, routeDepartMap)
            }
        }

        fusedLocationClient.requestLocationUpdates(request, locationCallback!!, Looper.getMainLooper())
        android.util.Log.i("WAKE", "FusedLocationProvider ${POLL_INTERVAL_MS / 1000}초 폴링 등록")
    }

    // ── 거리 체크 + 알림 ──────────────────────────────────────────────

    private fun checkNearbyWaypoints(
        myLat:          Double,
        myLng:          Double,
        waypoints:      List<Waypoint>,
        routeDepartMap: Map<String, String>,
    ) {
        val prefs = getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)
        val userAlertRadiusM = prefs.getFloat(
            WakeMeServiceModule.KEY_ALERT_RADIUS, DEFAULT_ALERT_RADIUS_M.toFloat()
        ).toDouble()

        waypoints.forEach { wp ->
            if (wp.id in notifiedWaypoints) return@forEach

            val routeId    = WakeMeGeofenceReceiver.extractRouteId(wp.id)
            val departTime = routeDepartMap[routeId]
                ?: prefs.getString(WakeMeServiceModule.KEY_DEPART_TIME, "") ?: ""

            if (!WakeMeGeofenceReceiver.isWithinServiceWindow(departTime)) {
                android.util.Log.d("WAKE_GPS", "시간창 밖 스킵: ${wp.name} (depart=$departTime)")
                return@forEach
            }

            val routeDays = routeDaysMap[routeId] ?: listOf(0, 1, 2, 3, 4, 5, 6)
            if (!WakeMeGeofenceReceiver.isActiveToday(routeDays)) {
                android.util.Log.d("WAKE_GPS", "오늘 운행 요일 아님 스킵: ${wp.name}")
                return@forEach
            }

            val isFinalDest = wp.id.endsWith("wp_final_dest")
            val radius      = if (isFinalDest) FINAL_DEST_RADIUS_M else userAlertRadiusM
            val distM       = haversineMeters(myLat, myLng, wp.lat, wp.lng)
            android.util.Log.d("WAKE_GPS",
                "${wp.name}: ${distM.toInt()}m / ${radius.toInt()}m${if (isFinalDest) " [최종목적지]" else ""}")

            if (distM <= radius) {
                android.util.Log.i("WAKE_GPS",
                    "✅ 진입 감지: ${wp.name} (${distM.toInt()}m) type=${wp.type} nextMode=${wp.nextMode}")
                notifiedWaypoints.add(wp.id)
                persistNotifiedWaypoints()

                when (wp.type) {
                    "destination" -> {
                        sendDestinationAlert(wp.id.hashCode(), "🚨 지금 내리세요!", "${wp.name} 하차 준비하세요")
                        updateForegroundNotification("🚨 지금 내리세요! — ${wp.name}")
                        sendAlertAckCheck(wp.name, wp.id.hashCode())
                        android.util.Log.i("WAKE_GPS", "🏁 목적지 도착: ${wp.name} → 서비스 종료")
                        android.os.Handler(Looper.getMainLooper()).postDelayed({
                            locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
                            WakeMeWatchdogReceiver.cancel(this)

                            val completedRouteId = wp.id.split("__").firstOrNull() ?: ""
                            val currentJson = prefs.getString(
                                WakeMeServiceModule.KEY_ACTIVE_ROUTES, "[]") ?: "[]"
                            val remaining = try {
                                val arr      = org.json.JSONArray(currentJson)
                                val filtered = org.json.JSONArray()
                                for (i in 0 until arr.length()) {
                                    val r = arr.getJSONObject(i)
                                    if (r.optString("routeId") != completedRouteId) filtered.put(r)
                                }
                                filtered
                            } catch (e: Exception) { org.json.JSONArray() }

                            android.util.Log.i("WAKE_GPS",
                                "🏁 경로 $completedRouteId 완료 → 남은 경로: ${remaining.length()}개")
                            prefs.edit()
                                .putString(WakeMeServiceModule.KEY_ACTIVE_ROUTES, remaining.toString())
                                .remove(WakeMeServiceModule.KEY_ROUTE_ID)
                                .apply()

                            if (remaining.length() > 0) {
                                WakeMeWindowStartReceiver.scheduleAll(this, remaining.toString())
                            }
                            stopForeground(true); stopSelf()
                        }, 2_000L)
                    }
                    "transfer" -> when (wp.nextMode) {
                        "bus" -> {
                            val stopName = wp.nextStopName.ifEmpty { wp.name }
                            sendAlert(wp.id.hashCode(), "🔔 환승 준비", "$stopName 에서 버스로 환승하세요")
                            updateForegroundNotification("🔔 환승 준비 — $stopName")
                        }
                        "subway" -> {
                            sendAlert(wp.id.hashCode(), "🔔 환승 준비", "${wp.name}에서 지하철로 환승하세요")
                            updateForegroundNotification("🔔 환승 준비 — ${wp.name}")
                        }
                        else -> {
                            sendDestinationAlert(wp.id.hashCode(), "🚨 지금 내리세요!", "${wp.name}에서 내리세요")
                            updateForegroundNotification("🚨 지금 내리세요! — ${wp.name}")
                        }
                    }
                }
            }
        }
    }

    // ── Haversine (두 좌표 간 거리, 미터) ────────────────────────────

    private fun haversineMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val R    = 6_371_000.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a    = sin(dLat / 2).pow(2) +
                   cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
                   sin(dLng / 2).pow(2)
        return R * 2 * asin(sqrt(a))
    }

    // ── 서버 GPS 폴링 로그 (30초 throttle) ───────────────────────────

    private fun sendGpsPollLogThrottled(
        lat:            Double,
        lng:            Double,
        accuracy:       Float,
        waypoints:      List<Waypoint>,
        routeDepartMap: Map<String, String>,
    ) {
        val anyInWindow = routeDepartMap.values.any { dt ->
            dt.isNotBlank() && WakeMeGeofenceReceiver.isWithinServiceWindow(dt)
        }
        if (!anyInWindow) return

        val now = System.currentTimeMillis()
        if (now - lastGpsPollLogTime < GPS_LOG_INTERVAL_MS) return
        saveGpsPollLogTime(now)

        val prefs  = getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)
        val userId = prefs.getString(WakeMeServiceModule.KEY_USER_ID, "unknown") ?: "unknown"

        Thread {
            try {
                val wpArray = org.json.JSONArray()
                waypoints.forEach { wp ->
                    val distM   = haversineMeters(lat, lng, wp.lat, wp.lng).toInt()
                    val routeId = WakeMeGeofenceReceiver.extractRouteId(wp.id)
                    val depart  = routeDepartMap[routeId] ?: ""
                    wpArray.put(org.json.JSONObject().apply {
                        put("name",      wp.name)
                        put("type",      wp.type)
                        put("distanceM", distM)
                        put("inWindow",  WakeMeGeofenceReceiver.isWithinServiceWindow(depart))
                        put("notified",  wp.id in notifiedWaypoints)
                    })
                }

                val body = org.json.JSONObject().apply {
                    put("userId",    userId)
                    put("lat",       lat)
                    put("lng",       lng)
                    put("accuracy",  accuracy)
                    put("gpsType",   "real")
                    put("waypoints", wpArray)
                }.toString()

                val url  = java.net.URL("https://wakeme-api.fly.dev/api/notify/gps-poll")
                val conn = url.openConnection() as java.net.HttpURLConnection
                conn.requestMethod = "POST"; conn.doOutput = true
                conn.connectTimeout = 3000; conn.readTimeout = 3000
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                conn.responseCode; conn.disconnect()
            } catch (e: Exception) {
                android.util.Log.w("WAKE_GPS", "poll 로그 전송 실패: ${e.message}")
            }
        }.start()
    }

    // ── 이어폰 감지 + TTS ─────────────────────────────────────────────

    private fun isEarphoneConnected(): Boolean {
        val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val connected = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).filter { device ->
                when (device.type) {
                    AudioDeviceInfo.TYPE_WIRED_HEADSET,
                    AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
                    AudioDeviceInfo.TYPE_USB_HEADSET,
                    -> true
                    else -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        device.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
                        device.type == AudioDeviceInfo.TYPE_BLE_SPEAKER
                    } else false
                }
            }
            connected.isNotEmpty()
        } else {
            @Suppress("DEPRECATION")
            am.isWiredHeadsetOn || am.isBluetoothA2dpOn || am.isBluetoothScoOn
        }
    }

    private fun speakAlert(text: String) {
        if (!isEarphoneConnected()) return
        val engine = tts ?: return
        val volume = getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)
            .getFloat(WakeMeServiceModule.KEY_TTS_VOLUME, 0.8f)
        val params = android.os.Bundle().apply {
            putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume)
        }
        engine.speak(text, TextToSpeech.QUEUE_FLUSH, params, "wakeme_alert")
        android.util.Log.i("WAKE_TTS", "TTS 발화 (볼륨=${volume}): $text")
    }

    // ── 하차 알림 (강진동 3회) ────────────────────────────────────────

    private fun sendDestinationAlert(id: Int, title: String, body: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val pi = PendingIntent.getActivity(
            this, id,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        nm.notify(id, NotificationCompat.Builder(this, CHANNEL_DESTINATION)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVibrate(longArrayOf(0, 700, 400, 700, 400, 700))
            .setLights(0xFFFF0000.toInt(), 500, 500)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setFullScreenIntent(pi, true)
            .build())
        speakAlert(body)
    }

    // ── 하차 알림 수신 확인 ("정상적으로 받으셨나요?") ──────────────────
    // 백그라운드/Doze 모드에서 sendDestinationAlert()가 실제로 사용자에게
    // 도달했는지 확인할 길이 없었음 → Yes/No 액션 알림 + 60초 무응답 시
    // 1회 에스컬레이션. WakeMeAlertAckReceiver가 응답/타임아웃을 처리.
    private fun sendAlertAckCheck(waypointName: String, baseId: Int) {
        val userId = getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)
            .getString(WakeMeServiceModule.KEY_USER_ID, "unknown") ?: "unknown"
        WakeMeAlertAckReceiver.sendAckCheckNotification(this, waypointName, userId, baseId)
    }

    // ── 환승 알림 ─────────────────────────────────────────────────────

    private fun sendAlert(id: Int, title: String, body: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val pi = PendingIntent.getActivity(
            this, id,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        nm.notify(id, NotificationCompat.Builder(this, CHANNEL_ALERT)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVibrate(longArrayOf(0, 400, 200, 400))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build())
        speakAlert(body)
    }

    // ── 포그라운드 알림 ───────────────────────────────────────────────

    private fun buildTrackingNotification(destText: String = ""): Notification {
        val pi = PendingIntent.getActivity(
            this, 0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val deleteIntent = PendingIntent.getBroadcast(
            this, 0,
            Intent(this, WakeMeBootReceiver::class.java).apply {
                action = "com.wakeme_mobile.NOTIFICATION_DELETED"
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_TRACKING)
            .setContentTitle("WakeMe")
            .setContentText("상시 대기 중입니다")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pi)
            .setDeleteIntent(deleteIntent)
            .setOngoing(false)
            .build()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_TRACKING, "WakeMe 모니터링 중", NotificationManager.IMPORTANCE_LOW)
            )
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ALERT, "WakeMe 환승 알림", NotificationManager.IMPORTANCE_HIGH).apply {
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 400, 200, 400)
                }
            )
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_DESTINATION, "WakeMe 하차 알림", NotificationManager.IMPORTANCE_HIGH).apply {
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 700, 400, 700, 400, 700)
                    enableLights(true)
                    lightColor = 0xFFFF0000.toInt()
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                }
            )
        }
    }
}
