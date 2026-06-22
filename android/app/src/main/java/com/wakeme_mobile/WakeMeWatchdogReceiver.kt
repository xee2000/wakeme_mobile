package com.wakeme_mobile

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.location.LocationManager
import android.os.Build
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * 10분마다 WakeMeService를 재시작하는 워치독.
 *
 * ★ setExactAndAllowWhileIdle 자가 체인 방식:
 *    onReceive 종료 시마다 다음 알람을 즉시 예약 → Doze 모드에서도 정확히 동작
 *    (setRepeating은 Doze에서 최대 수 시간 배치될 수 있어 사용하지 않음)
 */
class WakeMeWatchdogReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val prefs         = context.getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)
        val allRoutesJson = prefs.getString(WakeMeServiceModule.KEY_ACTIVE_ROUTES, null)

        if (allRoutesJson.isNullOrEmpty() || allRoutesJson == "[]") {
            android.util.Log.i("WAKE_WD", "활성 경로 없음 → 워치독 종료 (다음 알람 미예약)")
            // 다음 알람 예약 안 함 → 체인 종료
            return
        }

        // ── 시간창 체크 ──────────────────────────────────────────────
        val departMap = WakeMeGeofenceReceiver.buildRouteDepartMap(allRoutesJson)
        val hasActiveWindow = if (departMap.isEmpty()) {
            true  // 경로 정보 없으면 일단 서비스 유지
        } else {
            // isNotBlank() 필수: departTime="" 는 isWithinServiceWindow가 true 반환하므로 항상 체크
            departMap.values.any { dt -> dt.isNotBlank() && WakeMeGeofenceReceiver.isWithinServiceWindow(dt) }
        }

        // GPS 상태 + userId (heartbeat는 시간창 안에서만 전송)
        val lm          = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val gpsEnabled  = lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
        val userId      = prefs.getString(WakeMeServiceModule.KEY_USER_ID, "unknown") ?: "unknown"
        val routeIds    = departMap.keys.joinToString(",")
        val departTimes = departMap.entries.joinToString("|") { "${it.key}=${it.value}" }

        if (hasActiveWindow) {
            android.util.Log.i("WAKE_WD", "워치독: 서비스 재시작 (경로 수=${departMap.size})")
            val serviceIntent = Intent(context, WakeMeService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }

            // heartbeat 전송 (시간창 안에서만)
            val result = goAsync()
            Thread {
                try {
                    sendHeartbeat(routeIds, userId, departTimes, gpsEnabled)
                } catch (e: Exception) {
                    android.util.Log.w("WAKE_WD", "heartbeat 전송 실패: ${e.message}")
                } finally {
                    result.finish()
                }
            }.start()

            // ── 출발 알람 재등록 (버스 첫 구간 경로: departTime에 버스 도착 알림) ──
            rescheduleDepartureAlarms(context, allRoutesJson)

            // ── 시간창 시작 알람 재등록 (모든 경로: departTime에 GPS 폴링 시작) ──
            WakeMeWindowStartReceiver.scheduleAll(context, allRoutesJson)

            // ── 다음 알람 자가 체인 예약 ──
            scheduleNext(context)
        } else {
            // 모든 시간창 종료 → 워치독 체인 중단 (다음 날 WakeMeWindowStartReceiver가 재시작)
            android.util.Log.i("WAKE_WD", "모든 경로 시간창 종료 → 워치독 체인 종료 (다음 알람 미예약)")
            // 내일을 위해 시간창 시작 알람만 재등록 (워치독은 WindowStart 시점에 다시 등록)
            WakeMeWindowStartReceiver.scheduleAll(context, allRoutesJson)
        }
    }

    companion object {
        private const val REQUEST_CODE = 7777
        private const val INTERVAL_MS  = 10 * 60 * 1000L  // 10분

        /** 최초 등록 또는 재등록 시 호출 */
        fun schedule(context: Context) {
            scheduleNext(context)
            android.util.Log.i("WAKE_WD", "워치독 최초 등록: ${INTERVAL_MS / 60000}분 후 첫 실행")
        }

        /** 다음 1회 Exact 알람 예약 (자가 체인 핵심) */
        private fun scheduleNext(context: Context) {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val triggerAt    = System.currentTimeMillis() + INTERVAL_MS
            val pi           = getPendingIntent(context)

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
                } else {
                    alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi)
                }
                android.util.Log.i("WAKE_WD", "다음 워치독 예약: ${INTERVAL_MS / 60000}분 후")
            } catch (e: SecurityException) {
                // API 31+ SCHEDULE_EXACT_ALARM 권한 없으면 폴백
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
                android.util.Log.w("WAKE_WD", "setExact 권한 없음 → setAndAllowWhileIdle 폴백")
            }
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

        private fun sendHeartbeat(
            routeIds:   String,
            userId:     String,
            departTimes: String,
            gpsEnabled: Boolean,
        ) {
            val url  = URL("$SERVER_BASE/api/notify/heartbeat")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod  = "POST"
            conn.doOutput       = true
            conn.connectTimeout = 5000
            conn.readTimeout    = 5000
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")

            val body = JSONObject().apply {
                put("userId",      userId)
                put("routeId",     routeIds)
                put("departTime",  departTimes)
                put("gpsEnabled",  gpsEnabled)
            }.toString()

            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }

            val code = conn.responseCode
            android.util.Log.i("WAKE_WD", "heartbeat 완료: HTTP $code gps=$gpsEnabled routes=$routeIds")
            conn.disconnect()
        }

        private const val SERVER_BASE = "https://wakeme-api.fly.dev"

        /**
         * 활성 경로 중 startStopId가 있는 경우(첫 구간이 버스)
         * 출발 24시간 이내이면 AlarmManager 알람을 재등록한다.
         * FLAG_UPDATE_CURRENT로 이미 등록된 알람은 조용히 덮어씀.
         */
        private fun rescheduleDepartureAlarms(context: Context, allRoutesJson: String) {
            // 버스 시간 안내 알림 제거됨 — no-op
        }
    }
}
