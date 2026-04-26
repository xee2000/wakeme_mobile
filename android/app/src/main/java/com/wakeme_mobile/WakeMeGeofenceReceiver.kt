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
        val waypoints = parseWaypoints(waypointsJson)

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
