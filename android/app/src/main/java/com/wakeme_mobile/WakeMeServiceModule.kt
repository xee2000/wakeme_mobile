package com.wakeme_mobile

import android.Manifest
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.Calendar

class WakeMeServiceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val PREFS_NAME        = "WakeMePrefs"
        const val KEY_ROUTE_ID      = "routeId"       // 하위 호환
        const val KEY_WAYPOINTS     = "waypoints"     // 하위 호환
        const val KEY_DEPART_TIME   = "departTime"    // 하위 호환
        const val KEY_USER_ID       = "userId"
        const val KEY_ACTIVE_ROUTES = "activeRoutes"  // JSON 배열 [{routeId, waypoints, departTime}]
    }

    override fun getName(): String = "WakeMeService"

    /**
     * @param routeId       모니터링 중인 경로 ID
     * @param waypointsJson 경유지/목적지 배열 JSON
     *   예: [{"id":"wp_0","lat":36.33,"lng":127.44,"name":"대전역","type":"transfer"},
     *         {"id":"wp_1","lat":36.35,"lng":127.38,"name":"노은역","type":"destination"}]
     */
    /**
     * 전체 활성 경로 목록으로 서비스 동기화 (JS 단에서 MMKV 업데이트 후 호출)
     * allRoutesJson: [{ routeId, waypoints:[{id,lat,lng,name,type}], departTime }, ...]
     */
    @ReactMethod
    fun startAll(allRoutesJson: String, userId: String) {
        android.util.Log.i("WAKE", "WakeMeServiceModule: startAll userId=$userId routes=$allRoutesJson")

        reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_ACTIVE_ROUTES, allRoutesJson)
            .putString(KEY_USER_ID,       userId)
            .apply()

        val intent = Intent(reactContext, WakeMeService::class.java).apply {
            putExtra(KEY_ACTIVE_ROUTES, allRoutesJson)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactContext.startForegroundService(intent)
        } else {
            reactContext.startService(intent)
        }

        WakeMeWatchdogReceiver.schedule(reactContext)
    }

    /** 하위 호환 — 단일 경로 시작 */
    @ReactMethod
    fun start(routeId: String, waypointsJson: String, departTime: String, userId: String) {
        val singleRoute = """[{"routeId":"$routeId","waypoints":$waypointsJson,"departTime":"$departTime"}]"""
        startAll(singleRoute, userId)
    }

    @ReactMethod
    fun stopAll() {
        android.util.Log.i("WAKE", "WakeMeServiceModule: stopAll()")
        WakeMeWatchdogReceiver.cancel(reactContext)
        reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().clear().apply()
        reactContext.stopService(Intent(reactContext, WakeMeService::class.java))
    }

    /** 하위 호환 */
    @ReactMethod
    fun stop() { stopAll() }

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun isLocationPermissionGranted(): Boolean {
        return ContextCompat.checkSelfPermission(
            reactContext, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * 출발 시간 기준으로 AlarmManager 알림 2개 예약
     *  - 출발 5분 전
     *  - 출발 정시
     * 알림 본문에 해당 정류장의 실시간 버스 도착 정보가 포함됨
     */
    @ReactMethod
    fun scheduleDeparture(routeId: String, departTime: String, stopName: String, startStopId: String) {
        val parts = departTime.split(":")
        if (parts.size != 2) return
        val hour = parts[0].toIntOrNull() ?: return
        val min  = parts[1].toIntOrNull() ?: return

        val departAt = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, min)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }

        val msUntilDepart = departAt.timeInMillis - System.currentTimeMillis()
        // 이미 지났거나 24시간 이상 남은 경우만 제외 (4시간 제한 제거 → 당일이면 언제든 등록)
        if (msUntilDepart <= 0 || msUntilDepart > 24 * 60 * 60 * 1000) return

        val alarmManager = reactContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager

        fun makePi(reqCode: Int, title: String): PendingIntent {
            val i = Intent(reactContext, WakeMeDepartureReceiver::class.java).apply {
                putExtra(WakeMeDepartureReceiver.EXTRA_TITLE,     title)
                putExtra(WakeMeDepartureReceiver.EXTRA_NOTIF_ID,  reqCode)
                putExtra(WakeMeDepartureReceiver.EXTRA_STOP_NAME, stopName)
                putExtra(WakeMeDepartureReceiver.EXTRA_STOP_ID,   startStopId)
            }
            return PendingIntent.getBroadcast(
                reactContext, reqCode, i,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        fun scheduleExact(triggerMs: Long, pi: PendingIntent) {
            try {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerMs, pi)
            } catch (e: SecurityException) {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerMs, pi)
            }
        }

        val id5min = ("$routeId-5min").hashCode()
        val idNow  = ("$routeId-now").hashCode()

        val msUntil5Min = msUntilDepart - 5 * 60 * 1000
        if (msUntil5Min > 0) {
            scheduleExact(
                System.currentTimeMillis() + msUntil5Min,
                makePi(id5min, "🚌 $stopName — 버스 시간 안내")
            )
            android.util.Log.i("WAKE", "출발 5분전 알람 예약: ${msUntil5Min / 1000}초 후")
        }

        scheduleExact(
            System.currentTimeMillis() + msUntilDepart,
            makePi(idNow, "🚌 $stopName — 버스 시간 안내")
        )
        android.util.Log.i("WAKE", "출발시간 알람 예약: ${msUntilDepart / 1000}초 후")
    }

    /** 배터리 최적화 예외 요청 다이얼로그 직접 띄우기 */
    @ReactMethod
    fun requestIgnoreBatteryOptimization() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (pm.isIgnoringBatteryOptimizations(reactContext.packageName)) return
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
            data = Uri.parse("package:${reactContext.packageName}")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        reactContext.startActivity(intent)
    }

    /** 배터리 최적화 예외 여부 확인 */
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun isBatteryOptimizationIgnored(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
        val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(reactContext.packageName)
    }

    @ReactMethod
    fun cancelDeparture(routeId: String) {
        val alarmManager = reactContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager

        fun cancelById(reqCode: Int) {
            val i = Intent(reactContext, WakeMeDepartureReceiver::class.java)
            val pi = PendingIntent.getBroadcast(
                reactContext, reqCode, i,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            pi?.let { alarmManager.cancel(it) }
        }

        cancelById(("$routeId-5min").hashCode())
        cancelById(("$routeId-now").hashCode())
        android.util.Log.i("WAKE", "출발 알람 취소: routeId=$routeId")
    }
}
