package com.wakeme_mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofenceStatusCodes
import com.google.android.gms.location.GeofencingEvent
import org.json.JSONArray
import java.util.Calendar

class WakeMeGeofenceReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent) ?: return

        if (event.hasError()) {
            val code = GeofenceStatusCodes.getStatusCodeString(event.errorCode)
            android.util.Log.e("WAKE_GEO", "GeofencingEvent 오류: $code")
            return
        }

        if (event.geofenceTransition != Geofence.GEOFENCE_TRANSITION_ENTER) return

        val prefs = context.getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)
        val waypointsJson = prefs.getString(WakeMeServiceModule.KEY_WAYPOINTS, "[]") ?: "[]"
        val departTime    = prefs.getString(WakeMeServiceModule.KEY_DEPART_TIME, "") ?: ""
        val waypoints     = parseWaypoints(waypointsJson)

        // ── 출발시간 ±2시간 이내가 아니면 무시 ───────────────────────
        if (!isWithinServiceWindow(departTime)) {
            android.util.Log.i("WAKE_GEO", "서비스 시간 외 → 지오펜스 무시 (departTime=$departTime)")
            return
        }

        event.triggeringGeofences?.forEach { geofence ->
            val wp = waypoints.find { it.id == geofence.requestId } ?: return@forEach

            android.util.Log.i("WAKE_GEO", "진입: ${wp.name} type=${wp.type}")

            val (title, body) = when (wp.type) {
                "destination" -> "🚨 지금 내리세요!" to "${wp.name} 도착"
                else          -> "🔔 환승 준비"      to "${wp.name}에서 환승하세요"
            }

            sendNotification(context, wp.id.hashCode(), title, body)
        }
    }

    private fun sendNotification(context: Context, id: Int, title: String, body: String) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(
                    WakeMeService.CHANNEL_ALERT,
                    "WakeMe 알림",
                    NotificationManager.IMPORTANCE_HIGH
                )
            )
        }

        val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val pi = PendingIntent.getActivity(
            context, id, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, WakeMeService.CHANNEL_ALERT)
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

    companion object {
        /**
         * 지오펜스 알림 허용 시간 창:
         *   [출발시간 - 10분] ~ [출발시간 + 2시간]
         *
         * 예) 출발 07:00 → 06:50 ~ 09:00 사이에만 알림
         * departTime이 비어있으면 항상 true.
         */
        fun isWithinServiceWindow(departTime: String): Boolean {
            if (departTime.isBlank()) return true
            val parts = departTime.split(":")
            if (parts.size != 2) return true
            val depHour = parts[0].toIntOrNull() ?: return true
            val depMin  = parts[1].toIntOrNull() ?: return true

            val now    = Calendar.getInstance()
            val nowMin = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
            val depTotalMin = depHour * 60 + depMin

            // 자정 경계 처리: 현재 시각을 출발시간 기준으로 정규화
            var elapsed = nowMin - depTotalMin          // 출발시간 기준 경과 분
            if (elapsed > 720)  elapsed -= 1440         // 자정 넘어 다음날인 경우
            if (elapsed < -720) elapsed += 1440

            // 출발 10분 전(-10) ~ 출발 2시간 후(+120) 사이
            val withinWindow = elapsed in -10..120
            android.util.Log.i("WAKE_GEO",
                "시간창 체크: departTime=$departTime, elapsed=${elapsed}분, 허용=$withinWindow")
            return withinWindow
        }

        fun parseWaypoints(json: String): List<Waypoint> {
            return try {
                val arr = JSONArray(json)
                (0 until arr.length()).map { i ->
                    val obj = arr.getJSONObject(i)
                    Waypoint(
                        id   = obj.getString("id"),
                        lat  = obj.getDouble("lat"),
                        lng  = obj.getDouble("lng"),
                        name = obj.getString("name"),
                        type = obj.getString("type"),
                    )
                }
            } catch (e: Exception) {
                android.util.Log.e("WAKE_GEO", "waypoints 파싱 실패", e)
                emptyList()
            }
        }
    }
}

data class Waypoint(
    val id: String,
    val lat: Double,
    val lng: Double,
    val name: String,
    val type: String,   // "transfer" | "destination"
)
