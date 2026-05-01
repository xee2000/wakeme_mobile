package com.wakeme_mobile

import android.Manifest
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
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
        const val ALERT_RADIUS_M      = 500.0   // 알림 반경 (미터)
        const val POLL_INTERVAL_MS    = 15_000L // 15초 폴링 간격 (지하철 출구 타이밍 대응)
    }

    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private var locationCallback: LocationCallback? = null

    // 이번 서비스 인스턴스에서 이미 알림 보낸 waypoint ID 집합 (중복 방지)
    private val notifiedWaypoints = mutableSetOf<String>()

    override fun onCreate() {
        super.onCreate()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        createNotificationChannels()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prefs = getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)

        // 다중 경로: intent extra 우선, 없으면 SharedPreferences
        val allRoutesJson = intent?.getStringExtra(WakeMeServiceModule.KEY_ACTIVE_ROUTES)
            ?: prefs.getString(WakeMeServiceModule.KEY_ACTIVE_ROUTES, null)

        // waypoints 수집
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
            // 하위 호환 — 단일 경로
            val routeId = intent?.getStringExtra(WakeMeServiceModule.KEY_ROUTE_ID)
                ?: prefs.getString(WakeMeServiceModule.KEY_ROUTE_ID, "") ?: ""
            if (routeId.isEmpty()) { stopSelf(); return START_NOT_STICKY }
            val waypointsJson = intent?.getStringExtra(WakeMeServiceModule.KEY_WAYPOINTS)
                ?: prefs.getString(WakeMeServiceModule.KEY_WAYPOINTS, "[]") ?: "[]"
            waypoints = WakeMeGeofenceReceiver.parseWaypoints(waypointsJson)
            destText  = waypoints.lastOrNull()?.name ?: ""
        }

        if (waypoints.isEmpty()) {
            android.util.Log.w("WAKE", "waypoints 없음 → 서비스 종료")
            stopSelf()
            return START_NOT_STICKY
        }

        val routeDepartMap = WakeMeGeofenceReceiver.buildRouteDepartMap(allRoutesJson)

        startForeground(FG_NOTIF_ID, buildTrackingNotification(destText))

        // 기존 위치 콜백 제거 후 재시작 (onStartCommand 재호출 대응)
        locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
        startLocationUpdates(waypoints, routeDepartMap)

        android.util.Log.i("WAKE", "GPS 폴링 시작: waypoints=${waypoints.size}개, routes=${routeDepartMap.size}개")
        waypoints.forEach { android.util.Log.i("WAKE", "  → ${it.id} ${it.name} (${it.type})") }

        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
        // 종료 직전 서버에 shutdown 로그 전송
        sendShutdownLog()
        // 워치독과 별개로 RESTART_SERVICE 브로드캐스트도 유지 (이중 안전망)
        sendBroadcast(Intent("com.wakeme_mobile.RESTART_SERVICE"))
    }

    private fun sendShutdownLog() {
        val prefs   = getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)
        val userId  = prefs.getString(WakeMeServiceModule.KEY_USER_ID, "unknown") ?: "unknown"
        val routeId = prefs.getString(WakeMeServiceModule.KEY_ROUTE_ID, "") ?: ""
        Thread {
            try {
                val url  = java.net.URL("https://wakeme-api.fly.dev/api/notify/shutdown")
                val conn = url.openConnection() as java.net.HttpURLConnection
                conn.requestMethod = "POST"
                conn.doOutput      = true
                conn.connectTimeout = 3000
                conn.readTimeout    = 3000
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                val body = org.json.JSONObject().apply {
                    put("userId",  userId)
                    put("routeId", routeId)
                    put("reason",  "onDestroy")
                }.toString()
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                conn.responseCode
                conn.disconnect()
                android.util.Log.i("WAKE", "shutdown 로그 전송 완료")
            } catch (e: Exception) {
                android.util.Log.w("WAKE", "shutdown 로그 전송 실패: ${e.message}")
            }
        }.start()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── 포그라운드 알림 업데이트 (하차/환승 접근 시) ─────────────────

    private fun updateForegroundNotification(alertText: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val pi = PendingIntent.getActivity(
            this, 0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val updated = NotificationCompat.Builder(this, CHANNEL_TRACKING)
            .setContentTitle("WakeMe 알림")
            .setContentText(alertText)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pi)
            .setOngoing(false)
            .build()
        nm.notify(FG_NOTIF_ID, updated)
    }

    // ── GPS 폴링 ───────────────────────────────────────────────────

    private fun startLocationUpdates(
        waypoints:      List<Waypoint>,
        routeDepartMap: Map<String, String>,
    ) {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) {
            android.util.Log.w("WAKE", "위치 권한 없음 → GPS 폴링 미시작")
            return
        }

        val request = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,  // 지하철 출구 GPS 재획득 대응
            POLL_INTERVAL_MS,
        )
            .setMinUpdateIntervalMillis(10_000L)
            .build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val loc = result.lastLocation ?: return
                android.util.Log.d("WAKE_GPS", "위치 수신: ${loc.latitude}, ${loc.longitude} acc=${loc.accuracy}m")
                checkNearbyWaypoints(loc.latitude, loc.longitude, waypoints, routeDepartMap)
                // 서버에 GPS 폴링 로그 전송 (비동기) — 끊기는 시점 파악용
                sendGpsPollLog(loc.latitude, loc.longitude, loc.accuracy, waypoints, routeDepartMap)
            }
        }

        fusedLocationClient.requestLocationUpdates(
            request,
            locationCallback!!,
            Looper.getMainLooper(),
        )
        android.util.Log.i("WAKE", "FusedLocationProvider ${POLL_INTERVAL_MS / 1000}초 폴링 등록")
    }

    // ── 거리 체크 ──────────────────────────────────────────────────

    private fun checkNearbyWaypoints(
        myLat:          Double,
        myLng:          Double,
        waypoints:      List<Waypoint>,
        routeDepartMap: Map<String, String>,
    ) {
        val prefs = getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)

        waypoints.forEach { wp ->
            // 이미 알림 보낸 waypoint 스킵
            if (wp.id in notifiedWaypoints) return@forEach

            // 경로별 서비스 시간창 체크
            val routeId    = WakeMeGeofenceReceiver.extractRouteId(wp.id)
            val departTime = routeDepartMap[routeId]
                ?: prefs.getString(WakeMeServiceModule.KEY_DEPART_TIME, "") ?: ""

            if (!WakeMeGeofenceReceiver.isWithinServiceWindow(departTime)) {
                android.util.Log.d("WAKE_GPS", "시간창 밖 스킵: ${wp.name} (depart=$departTime)")
                return@forEach
            }

            // Haversine 거리 계산
            val distM = haversineMeters(myLat, myLng, wp.lat, wp.lng)
            android.util.Log.d("WAKE_GPS", "${wp.name}: ${distM.toInt()}m / ${ALERT_RADIUS_M.toInt()}m")

            if (distM <= ALERT_RADIUS_M) {
                android.util.Log.i("WAKE_GPS", "✅ 진입 감지: ${wp.name} (${distM.toInt()}m) type=${wp.type} nextMode=${wp.nextMode}")
                notifiedWaypoints.add(wp.id)

                when (wp.type) {
                    "destination" -> {
                        sendDestinationAlert(wp.id.hashCode(), "🚨 지금 내리세요!", "${wp.name} 하차 준비하세요")
                        updateForegroundNotification("🚨 지금 내리세요! — ${wp.name}")
                    }
                    "transfer" -> when (wp.nextMode) {
                        "bus" -> {
                            // 다음이 버스 구간 → 탑승 정류장 버스 도착 정보 조회
                            val stopId   = wp.nextStopId
                            val stopName = wp.nextStopName.ifEmpty { wp.name }
                            updateForegroundNotification("🔔 환승 준비 — $stopName 버스 안내 조회 중")
                            Thread {
                                try {
                                    val body = fetchBusArrivals(stopId, stopName)
                                    sendAlert(wp.id.hashCode(), "🚌 $stopName — 버스 시간 안내", body)
                                } catch (e: Exception) {
                                    android.util.Log.w("WAKE_GPS", "버스 도착 조회 실패: ${e.message}")
                                    sendAlert(wp.id.hashCode(), "🔔 환승 준비", "$stopName 에서 버스로 환승하세요")
                                }
                            }.start()
                        }
                        else -> {
                            // 다음이 지하철이거나 정보 없음 → 단순 환승 안내
                            sendAlert(wp.id.hashCode(), "🔔 환승 준비", "${wp.name}에서 환승하세요")
                            updateForegroundNotification("🔔 환승 준비 — ${wp.name}")
                        }
                    }
                }
            }
        }
    }

    // ── Haversine 공식 (두 좌표 간 실제 거리, 미터) ─────────────────

    private fun haversineMeters(
        lat1: Double, lng1: Double,
        lat2: Double, lng2: Double,
    ): Double {
        val R    = 6_371_000.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a    = sin(dLat / 2).pow(2) +
                   cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
                   sin(dLng / 2).pow(2)
        return R * 2 * asin(sqrt(a))
    }

    // ── 서버 GPS 폴링 로그 전송 (비동기) ─────────────────────────────

    private fun sendGpsPollLog(
        lat:            Double,
        lng:            Double,
        accuracy:       Float,
        waypoints:      List<Waypoint>,
        routeDepartMap: Map<String, String>,
    ) {
        val prefs  = getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)
        val userId = prefs.getString(WakeMeServiceModule.KEY_USER_ID, "unknown") ?: "unknown"

        Thread {
            try {
                val wpArray = org.json.JSONArray()
                waypoints.forEach { wp ->
                    val distM    = haversineMeters(lat, lng, wp.lat, wp.lng).toInt()
                    val routeId  = WakeMeGeofenceReceiver.extractRouteId(wp.id)
                    val depart   = routeDepartMap[routeId] ?: ""
                    val inWindow = WakeMeGeofenceReceiver.isWithinServiceWindow(depart)
                    val notified = wp.id in notifiedWaypoints
                    wpArray.put(org.json.JSONObject().apply {
                        put("name",      wp.name)
                        put("type",      wp.type)
                        put("distanceM", distM)
                        put("inWindow",  inWindow)
                        put("notified",  notified)
                    })
                }

                val body = org.json.JSONObject().apply {
                    put("userId",    userId)
                    put("lat",       lat)
                    put("lng",       lng)
                    put("accuracy",  accuracy)
                    put("waypoints", wpArray)
                }.toString()

                val url  = java.net.URL("https://wakeme-api.fly.dev/api/notify/gps-poll")
                val conn = url.openConnection() as java.net.HttpURLConnection
                conn.requestMethod = "POST"
                conn.doOutput      = true
                conn.connectTimeout = 3000
                conn.readTimeout    = 3000
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                conn.responseCode
                conn.disconnect()
            } catch (e: Exception) {
                android.util.Log.w("WAKE_GPS", "poll 로그 전송 실패: ${e.message}")
            }
        }.start()
    }

    // ── 버스 도착 정보 조회 (환승 지오펜스 진입 시 사용) ─────────────

    private fun fetchBusArrivals(stopId: String, stopName: String): String {
        if (stopId.isEmpty()) return "탑승 준비하세요"

        val url  = java.net.URL("https://wakeme-api.fly.dev/api/bus/arriving?nodeId=$stopId")
        val conn = url.openConnection() as java.net.HttpURLConnection
        conn.connectTimeout = 5000
        conn.readTimeout    = 5000

        return try {
            val response = conn.inputStream.bufferedReader().readText()
            val json = org.json.JSONObject(response)
            val arr  = json.optJSONArray("data") ?: return "현재 운행 정보를 불러올 수 없습니다"

            data class BusArrival(val routeNo: String, val arrMin: Int)
            val buses = mutableListOf<BusArrival>()
            for (i in 0 until arr.length()) {
                val item = arr.getJSONObject(i)
                val rno  = item.optString("routeno").trim()
                val sec  = item.optInt("arrtime", 0)
                if (rno.isNotEmpty() && sec > 0) {
                    buses.add(BusArrival(rno, kotlin.math.ceil(sec / 60.0).toInt()))
                }
            }
            if (buses.isEmpty()) return "현재 운행 정보를 불러올 수 없습니다"

            buses.sortBy { it.arrMin }
            val cal    = java.util.Calendar.getInstance()
            val nowStr = String.format("%d:%02d", cal.get(java.util.Calendar.HOUR_OF_DAY), cal.get(java.util.Calendar.MINUTE))
            val summary = buses.take(4).joinToString(" • ") { "${it.routeNo}번 ${it.arrMin}분 후" }
            "현재 ${nowStr} 기준\n$summary"
        } finally {
            conn.disconnect()
        }
    }

    // ── 하차 알림 (강진동 3회) ────────────────────────────────────

    private fun sendDestinationAlert(id: Int, title: String, body: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val pi = PendingIntent.getActivity(
            this, id,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        // 진동 패턴: [대기, 진동, 쉬기] × 3회
        // 0ms 대기 → 700ms 진동 → 400ms 쉬기 → 700ms 진동 → 400ms 쉬기 → 700ms 진동
        val vibPattern = longArrayOf(0, 700, 400, 700, 400, 700)

        val notification = NotificationCompat.Builder(this, CHANNEL_DESTINATION)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVibrate(vibPattern)
            .setLights(0xFFFF0000.toInt(), 500, 500)  // 빨간 LED 점멸
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setFullScreenIntent(pi, true)  // 화면 켜기 (잠금화면 팝업)
            .build()

        nm.notify(id, notification)
    }

    // ── 환승 알림 ─────────────────────────────────────────────────

    private fun sendAlert(id: Int, title: String, body: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val pi = PendingIntent.getActivity(
            this, id,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ALERT)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVibrate(longArrayOf(0, 400, 200, 400))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build()

        nm.notify(id, notification)
    }

    // ── 포그라운드 알림 ────────────────────────────────────────────

    private fun buildTrackingNotification(@Suppress("UNUSED_PARAMETER") destText: String = ""): Notification {
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
            .setContentText("상시 대기 중입니다")   // 항상 고정 문구
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
            // 하차 전용: 최고 우선순위 + 강진동 3회
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
