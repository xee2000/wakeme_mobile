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
        const val CHANNEL_TRACKING = "wakeme-tracking"
        const val CHANNEL_ALERT    = "wakeme-alert"
        const val FG_NOTIF_ID      = 9001
        const val ALERT_RADIUS_M   = 500.0   // 알림 반경 (미터)
        const val POLL_INTERVAL_MS = 30_000L // 30초 폴링 간격
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
        // 워치독과 별개로 RESTART_SERVICE 브로드캐스트도 유지 (이중 안전망)
        sendBroadcast(Intent("com.wakeme_mobile.RESTART_SERVICE"))
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
            Priority.PRIORITY_BALANCED_POWER_ACCURACY,
            POLL_INTERVAL_MS,
        )
            .setMinUpdateIntervalMillis(15_000L)
            .build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val loc = result.lastLocation ?: return
                android.util.Log.d("WAKE_GPS", "위치 수신: ${loc.latitude}, ${loc.longitude} acc=${loc.accuracy}m")
                checkNearbyWaypoints(loc.latitude, loc.longitude, waypoints, routeDepartMap)
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
                android.util.Log.i("WAKE_GPS", "✅ 진입 감지: ${wp.name} (${distM.toInt()}m)")
                notifiedWaypoints.add(wp.id)

                val (title, body) = when (wp.type) {
                    "destination" -> "🚨 지금 내리세요!" to "${wp.name} 도착"
                    else          -> "🔔 환승 준비"      to "${wp.name}에서 환승하세요"
                }
                // 별도 알림으로 발송
                sendAlert(wp.id.hashCode(), title, body)
                // 포그라운드 알림도 잠시 내용 업데이트 (선택적)
                updateForegroundNotification("$title — $body")
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

    // ── 하차/환승 알림 발송 ────────────────────────────────────────

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
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVibrate(longArrayOf(0, 500, 200, 500))
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
                NotificationChannel(CHANNEL_ALERT, "WakeMe 알림", NotificationManager.IMPORTANCE_HIGH)
            )
        }
    }
}
