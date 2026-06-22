package com.wakeme_mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

class WakeMeDepartureReceiver : BroadcastReceiver() {

    companion object {
        const val EXTRA_TITLE      = "title"
        const val EXTRA_NOTIF_ID   = "notifId"
        const val EXTRA_STOP_NAME  = "stopName"
        const val EXTRA_STOP_ID    = "stopId"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val title    = intent.getStringExtra(EXTRA_TITLE) ?: return
        val notifId  = intent.getIntExtra(EXTRA_NOTIF_ID, 2001)
        val stopName = intent.getStringExtra(EXTRA_STOP_NAME) ?: ""

        android.util.Log.i("WAKE_DEP", "알람 수신 stopName=$stopName")

        val body = if (stopName.isNotEmpty()) "$stopName 에서 탑승 준비하세요" else "탑승 준비하세요"
        showNotification(context, notifId, title, body)
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
