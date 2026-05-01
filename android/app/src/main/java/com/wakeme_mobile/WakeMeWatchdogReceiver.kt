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

        // ── 출발 알람 재등록 (1회성 AlarmManager 알람이 만료됐을 수 있으므로 매번 갱신) ──
        rescheduleDepartureAlarms(context, allRoutesJson)

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

        /**
         * 활성 경로 중 startStopId가 있는 경우(첫 구간이 버스)
         * 출발 24시간 이내이면 AlarmManager 알람을 재등록한다.
         * FLAG_UPDATE_CURRENT로 이미 등록된 알람은 조용히 덮어씀.
         */
        private fun rescheduleDepartureAlarms(context: Context, allRoutesJson: String) {
            try {
                val routes = org.json.JSONArray(allRoutesJson)
                val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
                val now = System.currentTimeMillis()

                for (i in 0 until routes.length()) {
                    val r          = routes.getJSONObject(i)
                    val routeId    = r.optString("routeId")
                    val departTime = r.optString("departTime")
                    val startStopId   = r.optString("startStopId")
                    val startStopName = r.optString("startStopName")

                    if (routeId.isEmpty() || departTime.isEmpty() || startStopId.isEmpty()) continue

                    val parts = departTime.split(":")
                    if (parts.size != 2) continue
                    val hour = parts[0].toIntOrNull() ?: continue
                    val min  = parts[1].toIntOrNull() ?: continue

                    val departAt = java.util.Calendar.getInstance().apply {
                        set(java.util.Calendar.HOUR_OF_DAY, hour)
                        set(java.util.Calendar.MINUTE, min)
                        set(java.util.Calendar.SECOND, 0)
                        set(java.util.Calendar.MILLISECOND, 0)
                    }

                    // 오늘 출발 시각이 이미 지났으면 내일로
                    var msUntil = departAt.timeInMillis - now
                    if (msUntil < 0) {
                        departAt.add(java.util.Calendar.DAY_OF_MONTH, 1)
                        msUntil = departAt.timeInMillis - now
                    }

                    // 24시간 이내인 경우만 등록
                    if (msUntil > 24 * 60 * 60 * 1000L) {
                        android.util.Log.d("WAKE_WD", "출발 알람 스킵 (24h 초과): $routeId departTime=$departTime")
                        continue
                    }

                    fun makePi(reqCode: Int, title: String): PendingIntent {
                        val intent = Intent(context, WakeMeDepartureReceiver::class.java).apply {
                            putExtra(WakeMeDepartureReceiver.EXTRA_TITLE,     title)
                            putExtra(WakeMeDepartureReceiver.EXTRA_NOTIF_ID,  reqCode)
                            putExtra(WakeMeDepartureReceiver.EXTRA_STOP_NAME, startStopName)
                            putExtra(WakeMeDepartureReceiver.EXTRA_STOP_ID,   startStopId)
                        }
                        return PendingIntent.getBroadcast(
                            context, reqCode, intent,
                            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                        )
                    }

                    fun scheduleExact(triggerMs: Long, pi: PendingIntent) {
                        try {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerMs, pi)
                            } else {
                                alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerMs, pi)
                            }
                        } catch (e: SecurityException) {
                            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerMs, pi)
                        }
                    }

                    val title   = "🚌 $startStopName — 버스 시간 안내"
                    val id5min  = ("$routeId-5min").hashCode()
                    val idNow   = ("$routeId-now").hashCode()
                    val ms5min  = msUntil - 5 * 60 * 1000L

                    if (ms5min > 0) {
                        scheduleExact(now + ms5min, makePi(id5min, title))
                    }
                    scheduleExact(now + msUntil, makePi(idNow, title))

                    android.util.Log.i("WAKE_WD", "출발 알람 갱신: $routeId $departTime → ${msUntil / 60000}분 후")
                }
            } catch (e: Exception) {
                android.util.Log.w("WAKE_WD", "출발 알람 재등록 실패: ${e.message}")
            }
        }
    }
}
