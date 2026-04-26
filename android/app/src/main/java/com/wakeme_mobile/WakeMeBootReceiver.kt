package com.wakeme_mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

class WakeMeBootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        android.util.Log.i("WAKE", "WakeMeBootReceiver: action=$action")

        when (action) {
            Intent.ACTION_BOOT_COMPLETED,
            "com.wakeme_mobile.RESTART_SERVICE",
            "com.wakeme_mobile.NOTIFICATION_DELETED" -> {   // ✅ 추가

                val prefs = context.getSharedPreferences(
                    WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE
                )
                val routeId = prefs.getString(WakeMeServiceModule.KEY_ROUTE_ID, "")

                if (routeId.isNullOrEmpty()) {
                    android.util.Log.i("WAKE", "WakeMeBootReceiver: 상태 없음 — 스킵")
                    return
                }

                android.util.Log.i("WAKE", "WakeMeBootReceiver: 서비스 재시작 action=$action")

                val serviceIntent = Intent(context, WakeMeService::class.java)

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
            }
        }
    }
}
