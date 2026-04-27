package com.wakeme_mobile

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * 10분마다 WakeMeService를 재시작하는 워치독.
 * - startForegroundService는 이미 실행 중인 서비스에 호출해도 onStartCommand만 재호출됨 (안전)
 * - 모니터링 상태(SharedPreferences)가 없거나 서비스 시간 창 밖이면 스킵
 */
class WakeMeWatchdogReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val prefs   = context.getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)
        val routeId = prefs.getString(WakeMeServiceModule.KEY_ROUTE_ID, "")

        if (routeId.isNullOrEmpty()) {
            android.util.Log.i("WAKE_WD", "모니터링 상태 없음 → 워치독 종료")
            cancel(context)
            return
        }

        val departTime = prefs.getString(WakeMeServiceModule.KEY_DEPART_TIME, "") ?: ""
        if (!WakeMeGeofenceReceiver.isWithinServiceWindow(departTime)) {
            android.util.Log.i("WAKE_WD", "서비스 시간 창 밖 → 재시작 스킵 (departTime=$departTime)")
            return
        }

        android.util.Log.i("WAKE_WD", "10분 워치독: 서비스 재시작 (routeId=$routeId)")
        val serviceIntent = Intent(context, WakeMeService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent)
        } else {
            context.startService(serviceIntent)
        }
    }

    companion object {
        private const val REQUEST_CODE   = 7777
        private const val INTERVAL_MS    = 10 * 60 * 1000L  // 10분

        fun schedule(context: Context) {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            // setRepeating: API 19+ 에서 부정확(OS 배치)하지만 워치독 목적으론 충분
            alarmManager.setRepeating(
                AlarmManager.RTC_WAKEUP,
                System.currentTimeMillis() + INTERVAL_MS,
                INTERVAL_MS,
                getPendingIntent(context),
            )
            android.util.Log.i("WAKE_WD", "워치독 알람 등록: ${INTERVAL_MS / 60000}분 주기")
        }

        fun cancel(context: Context) {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            alarmManager.cancel(getPendingIntent(context))
            android.util.Log.i("WAKE_WD", "워치독 알람 취소")
        }

        private fun getPendingIntent(context: Context): PendingIntent {
            val intent = Intent(context, WakeMeWatchdogReceiver::class.java)
            return PendingIntent.getBroadcast(
                context,
                REQUEST_CODE,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
    }
}
