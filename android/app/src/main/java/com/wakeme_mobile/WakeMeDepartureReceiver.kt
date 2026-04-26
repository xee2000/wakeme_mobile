package com.wakeme_mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class WakeMeDepartureReceiver : BroadcastReceiver() {

    companion object {
        const val EXTRA_TITLE      = "title"
        const val EXTRA_NOTIF_ID   = "notifId"
        const val EXTRA_STOP_NAME  = "stopName"
        const val EXTRA_STOP_ID    = "stopId"

        private const val SERVER_BASE = "https://wakeme-api.fly.dev"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val title    = intent.getStringExtra(EXTRA_TITLE) ?: return
        val notifId  = intent.getIntExtra(EXTRA_NOTIF_ID, 2001)
        val stopName = intent.getStringExtra(EXTRA_STOP_NAME) ?: ""
        val stopId   = intent.getStringExtra(EXTRA_STOP_ID) ?: ""

        android.util.Log.i("WAKE_DEP", "알람 수신 stopId=$stopId stopName=$stopName")

        val result = goAsync()
        Thread {
            try {
                val body = fetchArrivalBody(stopId, stopName)
                android.util.Log.i("WAKE_DEP", "알림 본문: $body")
                showNotification(context, notifId, title, body)
            } catch (e: Exception) {
                android.util.Log.w("WAKE_DEP", "도착 API 실패: ${e.message}")
                showNotification(context, notifId, title, "탑승 준비하세요")
            } finally {
                result.finish()
            }
        }.start()
    }

    private fun fetchArrivalBody(stopId: String, stopName: String): String {
        if (stopId.isEmpty()) {
            return "탑승 준비하세요"
        }

        val url = URL("$SERVER_BASE/api/bus/arriving?nodeId=${stopId}")
        val conn = url.openConnection() as HttpURLConnection
        conn.connectTimeout = 5000
        conn.readTimeout    = 5000

        return try {
            val response = conn.inputStream.bufferedReader().readText()
            android.util.Log.i("WAKE_DEP", "API 응답: ${response.take(400)}")
            val json = JSONObject(response)
            val arr  = json.optJSONArray("data") ?: run {
                android.util.Log.w("WAKE_DEP", "data 없음")
                return "현재 운행 정보를 불러올 수 없습니다"
            }

            android.util.Log.i("WAKE_DEP", "버스 ${arr.length()}대 조회됨")

            // 도착시간 오름차순 정렬 후 상위 4개
            data class BusArrival(val routeNo: String, val arrMin: Int, val destination: String)
            val buses = mutableListOf<BusArrival>()

            for (i in 0 until arr.length()) {
                val item  = arr.getJSONObject(i)
                val rno   = item.optString("routeno").trim()
                val sec   = item.optInt("arrtime", 0)
                val dest  = item.optString("destination").trim()
                if (rno.isNotEmpty() && sec > 0) {
                    val min = Math.ceil(sec / 60.0).toInt()
                    buses.add(BusArrival(rno, min, dest))
                    android.util.Log.d("WAKE_DEP", "  버스 $rno → ${min}분 (${dest}방면)")
                }
            }

            if (buses.isEmpty()) {
                return "현재 운행 정보를 불러올 수 없습니다"
            }

            buses.sortBy { it.arrMin }
            val top = buses.take(4)

            val cal = java.util.Calendar.getInstance()
            val nowStr = String.format("%d:%02d", cal.get(java.util.Calendar.HOUR_OF_DAY), cal.get(java.util.Calendar.MINUTE))
            val summary = top.joinToString(" • ") { "${it.routeNo}번 ${it.arrMin}분 후" }
            "현재 ${nowStr} 기준\n$summary"
        } finally {
            conn.disconnect()
        }
    }

    private fun showNotification(context: Context, notifId: Int, title: String, body: String) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(WakeMeService.CHANNEL_ALERT, "WakeMe 알림", NotificationManager.IMPORTANCE_HIGH)
            )
        }

        val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val pi = PendingIntent.getActivity(
            context, notifId, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notif = NotificationCompat.Builder(context, WakeMeService.CHANNEL_ALERT)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setVibrate(longArrayOf(100, 300, 200, 300))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        nm.notify(notifId, notif)
    }
}
