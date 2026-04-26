package com.wakeme_mobile

import android.Manifest
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*

class WakeMeService : Service() {

    companion object {
        const val CHANNEL_TRACKING = "wakeme-tracking"
        const val CHANNEL_ALERT    = "wakeme-alert"
        const val FG_NOTIF_ID      = 9001
        const val GEOFENCE_RADIUS  = 500f   // meters — OS가 진입 시 WakeMeGeofenceReceiver 호출
    }

    private lateinit var geofencingClient: GeofencingClient

    override fun onCreate() {
        super.onCreate()
        geofencingClient = LocationServices.getGeofencingClient(this)
        createNotificationChannels()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prefs = getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)

        val routeId      = intent?.getStringExtra(WakeMeServiceModule.KEY_ROUTE_ID)
            ?: prefs.getString(WakeMeServiceModule.KEY_ROUTE_ID, "") ?: ""
        val waypointsJson = intent?.getStringExtra(WakeMeServiceModule.KEY_WAYPOINTS)
            ?: prefs.getString(WakeMeServiceModule.KEY_WAYPOINTS, "[]") ?: "[]"

        if (routeId.isEmpty()) {
            stopSelf()
            return START_NOT_STICKY
        }

        val waypoints = WakeMeGeofenceReceiver.parseWaypoints(waypointsJson)
        val destName = waypoints.lastOrNull()?.name ?: ""

        startForeground(FG_NOTIF_ID, buildTrackingNotification(destName))

        if (waypoints.isNotEmpty()) {
            registerGeofences(waypoints)
        } else {
            android.util.Log.w("WAKE", "waypoints 없음 → 지오펜스 미등록")
        }

        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        geofencingClient.removeGeofences(geofencePendingIntent())
        sendBroadcast(Intent("com.wakeme_mobile.RESTART_SERVICE"))
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── 지오펜스 등록 ───────────────────────────────────────────────────────

    private fun registerGeofences(waypoints: List<Waypoint>) {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) {
            android.util.Log.w("WAKE", "위치 권한 없음 → 지오펜스 미등록")
            return
        }

        val geofences = waypoints.map { wp ->
            Geofence.Builder()
                .setRequestId(wp.id)
                .setCircularRegion(wp.lat, wp.lng, GEOFENCE_RADIUS)
                .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER)
                .setExpirationDuration(Geofence.NEVER_EXPIRE)
                .build()
        }

        val request = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
            .addGeofences(geofences)
            .build()

        geofencingClient.addGeofences(request, geofencePendingIntent())
            .addOnSuccessListener {
                android.util.Log.i("WAKE", "지오펜스 ${geofences.size}개 등록 완료")
                waypoints.forEach { android.util.Log.i("WAKE", "  → ${it.id} ${it.name} (${it.type})") }
            }
            .addOnFailureListener { e ->
                android.util.Log.e("WAKE", "지오펜스 등록 실패: ${e.message}")
            }
    }

    private fun geofencePendingIntent(): PendingIntent {
        val intent = Intent(this, WakeMeGeofenceReceiver::class.java)
        return PendingIntent.getBroadcast(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
    }

    // ── 포그라운드 알림 ────────────────────────────────────────────────────

    private fun buildTrackingNotification(destName: String): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pi = PendingIntent.getActivity(this, 0, launchIntent, PendingIntent.FLAG_IMMUTABLE)

        val deleteIntent = PendingIntent.getBroadcast(
            this, 0,
            Intent(this, WakeMeBootReceiver::class.java).apply {
                action = "com.wakeme_mobile.NOTIFICATION_DELETED"
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_TRACKING)
            .setContentTitle("WakeMe 모니터링 중")
            .setContentText(if (destName.isNotEmpty()) "$destName 하차 감지 중" else "모니터링 중")
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
