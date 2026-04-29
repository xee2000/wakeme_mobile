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
            true
        } else {
            departMap.values.any { WakeMeGeofenceReceiver.isWithinServiceWindow(it) }
        }

        // GPS 상태 + userId (heartbeat는 시간창과 무관하게 항상 전송)
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
        } else {
            android.util.Log.i("WAKE_WD", "모든 경로 시간창 밖 → 서비스 재시작 스킵 (heartbeat는 전송)")
        }

        // heartbeat 항상 전송 (앱 생존 확인 목적)
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

        // ── 다음 알람 자가 체인 예약 (항상 재예약, 경로가 살아있는 한) ──
        scheduleNext(context)
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
    }
}
