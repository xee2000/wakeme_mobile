package com.wakeme_mobile

import android.app.AlarmManager
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

/**
 * 하차 알림("🚨 지금 내리세요!") 직후 발송되는 "수신 확인" 알림에 대한
 * 사용자 응답(예/아니오) 또는 무응답(timeout) 에스컬레이션을 처리하는 리시버.
 *
 * 동기: 백그라운드/Doze 모드에서 하차 알림(sendDestinationAlert)이 실제로
 * 사용자에게 도달했는지 확인할 방법이 없었음 — 이 리시버가 그 확인 루프를 담당.
 *
 * 플로우:
 *  1) WakeMeService가 destination 진입 시 sendDestinationAlert() 직후
 *     sendAckCheckNotification()으로 "정상적으로 알림을 받으셨나요?" 알림 발송 (예/아니오 액션)
 *     + ESCALATION_DELAY_MS 후 발화할 1회성 AlarmManager 타이머 등록
 *  2) 사용자가 "예"/"아니오" 탭 → 이 리시버의 onReceive(ACTION_ACK_*) 호출
 *     → 에스컬레이션 알람 취소 + 서버에 응답 기록 전송 + 확인 알림 닫기
 *  3) 60초 내 응답 없음 → 에스컬레이션 알람(ACTION_ESCALATE) 발화
 *     → 더 강한 재시도 알림 1회 발송 + 서버에 timeout 기록 전송
 *     (그 이상 반복하지 않음 — 알림 스팸 방지)
 */
class WakeMeAlertAckReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_ACK_YES   = "com.wakeme_mobile.ACK_YES"
        const val ACTION_ACK_NO    = "com.wakeme_mobile.ACK_NO"
        const val ACTION_ESCALATE  = "com.wakeme_mobile.ACK_ESCALATE"

        const val EXTRA_WAYPOINT_NAME = "waypointName"
        const val EXTRA_NOTIF_ID      = "notifId"
        const val EXTRA_USER_ID       = "userId"

        const val ACK_CHECK_NOTIF_ID_OFFSET = 1_000_000  // 원본 알림 id와 충돌 방지

        private const val ESCALATION_DELAY_MS = 60_000L   // 60초 무응답 시 1회 에스컬레이션
        private const val ESCALATE_REQUEST_CODE_BASE = 9_500_000
        private const val SERVER_BASE = "https://wakeme-api.fly.dev"

        /**
         * 하차 알림 직후 호출 — "수신 확인" 알림 발송 + 무응답 에스컬레이션 타이머 등록.
         */
        fun sendAckCheckNotification(context: Context, waypointName: String, userId: String, baseId: Int) {
            val ackNotifId = ACK_CHECK_NOTIF_ID_OFFSET + (baseId and 0x0FFFFFFF)
            showAckNotification(context, ackNotifId, waypointName, escalated = false)
            scheduleEscalation(context, ackNotifId, waypointName, userId)
        }

        private fun showAckNotification(
            context: Context,
            ackNotifId: Int,
            waypointName: String,
            escalated: Boolean,
        ) {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            val title = if (escalated) "⚠️ 알림 확인이 안 됐어요" else "🔔 하차 알림 확인"
            val body  = if (escalated)
                "$waypointName 하차 알림에 응답이 없습니다. 혹시 못 보셨다면 지금 확인해주세요!"
            else
                "방금 \"$waypointName 지금 내리세요\" 알림이 정상적으로 표시됐나요?"

            fun ackPendingIntent(action: String): PendingIntent {
                val intent = Intent(context, WakeMeAlertAckReceiver::class.java).apply {
                    this.action = action
                    putExtra(EXTRA_WAYPOINT_NAME, waypointName)
                    putExtra(EXTRA_NOTIF_ID, ackNotifId)
                }
                return PendingIntent.getBroadcast(
                    context, ackNotifId + action.hashCode(), intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
            }

            val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            val contentPi = PendingIntent.getActivity(
                context, ackNotifId, launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

            val builder = NotificationCompat.Builder(context, WakeMeService.CHANNEL_DESTINATION)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setSmallIcon(R.mipmap.ic_launcher)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setAutoCancel(true)
                .setContentIntent(contentPi)
                .addAction(0, "예, 받았어요", ackPendingIntent(ACTION_ACK_YES))
                .addAction(0, "못 받았어요", ackPendingIntent(ACTION_ACK_NO))

            if (escalated) {
                // 1회 한정 강한 재시도: 강진동 + 풀스크린 인텐트로 더 눈에 띄게
                builder.setVibrate(longArrayOf(0, 700, 400, 700, 400, 700))
                    .setLights(0xFFFF0000.toInt(), 500, 500)
                    .setFullScreenIntent(contentPi, true)
            } else {
                builder.setVibrate(longArrayOf(0, 300, 200, 300))
            }

            nm.notify(ackNotifId, builder.build())
        }

        private fun scheduleEscalation(context: Context, ackNotifId: Int, waypointName: String, userId: String) {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, WakeMeAlertAckReceiver::class.java).apply {
                action = ACTION_ESCALATE
                putExtra(EXTRA_WAYPOINT_NAME, waypointName)
                putExtra(EXTRA_NOTIF_ID, ackNotifId)
                putExtra(EXTRA_USER_ID, userId)
            }
            val reqCode = ESCALATE_REQUEST_CODE_BASE + ackNotifId
            val pi = PendingIntent.getBroadcast(
                context, reqCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val triggerAt = System.currentTimeMillis() + ESCALATION_DELAY_MS
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
                } else {
                    alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi)
                }
            } catch (e: SecurityException) {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
            }
            android.util.Log.i("WAKE_ACK", "에스컬레이션 타이머 등록: $waypointName (${ESCALATION_DELAY_MS / 1000}초 후)")
        }

        private fun cancelEscalation(context: Context, ackNotifId: Int) {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val reqCode = ESCALATE_REQUEST_CODE_BASE + ackNotifId
            val pi = PendingIntent.getBroadcast(
                context, reqCode,
                Intent(context, WakeMeAlertAckReceiver::class.java),
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
            )
            pi?.let { alarmManager.cancel(it) }
        }

        private fun sendAckLog(userId: String, waypointName: String, result: String) {
            Thread {
                try {
                    val url  = URL("$SERVER_BASE/api/notify/alert-ack")
                    val conn = url.openConnection() as HttpURLConnection
                    conn.requestMethod = "POST"; conn.doOutput = true
                    conn.connectTimeout = 3000; conn.readTimeout = 3000
                    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    val body = JSONObject().apply {
                        put("userId", userId)
                        put("waypointName", waypointName)
                        put("result", result) // "yes" | "no" | "timeout"
                    }.toString()
                    conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                    conn.responseCode; conn.disconnect()
                } catch (e: Exception) {
                    android.util.Log.w("WAKE_ACK", "ack 로그 전송 실패: ${e.message}")
                }
            }.start()
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action       = intent.action ?: return
        val waypointName = intent.getStringExtra(EXTRA_WAYPOINT_NAME) ?: ""
        val ackNotifId   = intent.getIntExtra(EXTRA_NOTIF_ID, -1)
        val prefs        = context.getSharedPreferences(WakeMeServiceModule.PREFS_NAME, Context.MODE_PRIVATE)
        val userId       = intent.getStringExtra(EXTRA_USER_ID)
            ?: prefs.getString(WakeMeServiceModule.KEY_USER_ID, "unknown") ?: "unknown"

        when (action) {
            ACTION_ACK_YES, ACTION_ACK_NO -> {
                android.util.Log.i("WAKE_ACK", "사용자 응답: $action ($waypointName)")
                cancelEscalation(context, ackNotifId)
                if (ackNotifId != -1) {
                    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    nm.cancel(ackNotifId)
                }
                sendAckLog(userId, waypointName, if (action == ACTION_ACK_YES) "yes" else "no")
            }
            ACTION_ESCALATE -> {
                android.util.Log.w("WAKE_ACK", "⚠️ 무응답 → 에스컬레이션 발송: $waypointName")
                showAckNotification(context, ackNotifId, waypointName, escalated = true)
                sendAckLog(userId, waypointName, "timeout")
            }
        }
    }
}
