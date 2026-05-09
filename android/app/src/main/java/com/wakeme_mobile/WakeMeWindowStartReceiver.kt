package com.wakeme_mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * AlarmManager가 출발시간 10분 전에 깨우는 리시버.
 *
 * WakeMeService를 시작해 GPS 폴링을 시작한다.
 * 서비스는 [출발시간 - 10분 ~ 출발시간 + 2시간] 동안 동작 후 스스로 종료.
 *
 * 평소에는 백그라운드 서비스가 전혀 돌지 않으므로 배터리 낭비 없음.
 */
class WakeMeWindowStartReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        android.util.Log.i("WAKE_ALARM", "⏰ 시간창 시작 알람 수신 → WakeMeService 시작")

        // SharedPreferences에 저장된 경로가 없으면 시작할 필요 없음
        val prefs = context.getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)
        val allRoutesJson = prefs.getString(WakeMeServiceModule.KEY_ACTIVE_ROUTES, null)
        if (allRoutesJson.isNullOrEmpty() || allRoutesJson == "[]") {
            android.util.Log.i("WAKE_ALARM", "활성 경로 없음 → 서비스 미시작")
            return
        }

        val serviceIntent = Intent(context, WakeMeService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent)
        } else {
            context.startService(serviceIntent)
        }
    }

    companion object {
        private const val REQUEST_CODE_BASE = 8888  // 워치독(7777)과 겹치지 않는 코드

        /**
         * 모든 경로의 [departTime - 10분] 알람을 예약한다.
         * 이미 등록된 알람은 FLAG_UPDATE_CURRENT로 조용히 덮어씀.
         */
        fun scheduleAll(context: Context, allRoutesJson: String) {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE)
                as android.app.AlarmManager
            val now = System.currentTimeMillis()

            try {
                val routes = org.json.JSONArray(allRoutesJson)
                for (i in 0 until routes.length()) {
                    val r          = routes.getJSONObject(i)
                    val routeId    = r.optString("routeId")
                    val departTime = r.optString("departTime")
                    if (routeId.isEmpty() || departTime.isEmpty()) continue

                    val parts = departTime.split(":")
                    if (parts.size != 2) continue
                    val hour = parts[0].toIntOrNull() ?: continue
                    val min  = parts[1].toIntOrNull() ?: continue

                    // 오늘 departTime 정각에 GPS 시작
                    val triggerCal = java.util.Calendar.getInstance().apply {
                        set(java.util.Calendar.HOUR_OF_DAY, hour)
                        set(java.util.Calendar.MINUTE, min)
                        set(java.util.Calendar.SECOND, 0)
                        set(java.util.Calendar.MILLISECOND, 0)
                    }

                    // 이미 지났으면 내일로
                    if (triggerCal.timeInMillis < now) {
                        triggerCal.add(java.util.Calendar.DAY_OF_MONTH, 1)
                    }

                    val msUntil = triggerCal.timeInMillis - now

                    // 24시간 이후면 스킵 (내일 워치독이 재등록)
                    if (msUntil > 24 * 60 * 60 * 1000L) {
                        android.util.Log.d("WAKE_ALARM", "윈도우 알람 스킵 (24h 초과): $routeId $departTime")
                        continue
                    }

                    val reqCode = (REQUEST_CODE_BASE.toLong() + routeId.hashCode().toLong()).toInt()
                    val pi = android.app.PendingIntent.getBroadcast(
                        context,
                        reqCode,
                        Intent(context, WakeMeWindowStartReceiver::class.java),
                        android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
                    )

                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            alarmManager.setExactAndAllowWhileIdle(
                                android.app.AlarmManager.RTC_WAKEUP, triggerCal.timeInMillis, pi)
                        } else {
                            alarmManager.setExact(
                                android.app.AlarmManager.RTC_WAKEUP, triggerCal.timeInMillis, pi)
                        }
                        android.util.Log.i("WAKE_ALARM",
                            "GPS 시작 알람 등록: $routeId $departTime → ${msUntil / 60000}분 후")
                    } catch (e: SecurityException) {
                        alarmManager.setAndAllowWhileIdle(
                            android.app.AlarmManager.RTC_WAKEUP, triggerCal.timeInMillis, pi)
                    }
                }
            } catch (e: Exception) {
                android.util.Log.w("WAKE_ALARM", "시간창 알람 등록 실패: ${e.message}")
            }
        }
    }
}
