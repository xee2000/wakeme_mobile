package com.wakeme_mobile

import android.Manifest
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.speech.tts.TextToSpeech
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
        const val KEY_TTS_VOLUME    = "ttsVolume"     // TTS 볼륨 (0.0 ~ 1.0, 기본 0.8)
        const val KEY_ALERT_RADIUS  = "alertRadiusM"  // 하차/환승 준비 알림 반경 (m, 기본 500f) — 500/700/900/1200 중 선택
    }

    // 미리듣기 전용 TTS (모듈 레벨, 설정 화면에서만 사용)
    private var previewTts: TextToSpeech? = null

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
        // 워치독 취소
        WakeMeWatchdogReceiver.cancel(reactContext)
        // 저장된 모든 경로의 시간창 AlarmManager 알람 취소 (주말 오발동 방지)
        val prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val routesJson = prefs.getString(KEY_ACTIVE_ROUTES, "[]") ?: "[]"
        try {
            val arr = org.json.JSONArray(routesJson)
            for (i in 0 until arr.length()) {
                val routeId = arr.getJSONObject(i).optString("routeId")
                if (routeId.isNotEmpty()) {
                    WakeMeWindowStartReceiver.cancel(reactContext, routeId)
                }
            }
        } catch (e: Exception) {
            android.util.Log.w("WAKE", "시간창 알람 취소 실패: ${e.message}")
        }
        // SharedPreferences 초기화 + 서비스 종료
        prefs.edit().clear().apply()
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

        // 오늘 출발 시간이 이미 지났으면 → 내일 같은 시간으로 예약
        var msUntilDepart = departAt.timeInMillis - System.currentTimeMillis()
        if (msUntilDepart < 0) {
            departAt.add(Calendar.DAY_OF_MONTH, 1)
            msUntilDepart = departAt.timeInMillis - System.currentTimeMillis()
            android.util.Log.i("WAKE", "출발 시간 이미 지남 → 내일로 예약: ${hour}:${String.format("%02d", min)}")
        }

        // 24시간 이상 남은 경우는 너무 이른 예약 → 스킵
        if (msUntilDepart > 24 * 60 * 60 * 1000) return

        // 버스 시간 안내 알림 제거됨
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

        cancelById(("$routeId-now").hashCode())
        android.util.Log.i("WAKE", "출발 알람 취소: routeId=$routeId")
    }

    // ── TTS 볼륨 설정 ──────────────────────────────────────────────

    /** JS에서 볼륨 저장 (0.0 ~ 1.0) */
    @ReactMethod
    fun setTtsVolume(volume: Float) {
        reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putFloat(KEY_TTS_VOLUME, volume).apply()
        android.util.Log.i("WAKE", "TTS 볼륨 저장: $volume")
    }

    /** 현재 저장된 볼륨 반환 (기본 0.8) */
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun getTtsVolume(): Float {
        return reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getFloat(KEY_TTS_VOLUME, 0.8f)
    }

    /**
     * 설정 화면에서 슬라이더를 움직일 때 미리 소리 재생.
     * 매 호출마다 이전 TTS를 종료하고 새로 초기화해 볼륨을 즉시 반영한다.
     */
    @ReactMethod
    fun previewTts(volume: Float) {
        previewTts?.shutdown()
        previewTts = TextToSpeech(reactContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                previewTts?.language = java.util.Locale.KOREAN
                val params = android.os.Bundle().apply {
                    putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume)
                }
                previewTts?.speak("볼륨 테스트입니다", TextToSpeech.QUEUE_FLUSH, params, "preview")
            }
        }
    }

    // ── 알림 반경 설정 (전역, 경로별 아님) ────────────────────────────

    /** JS에서 알림 반경 저장 (미터, 500/700/900/1200 중 선택) */
    @ReactMethod
    fun setAlertRadius(radius: Float) {
        reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putFloat(KEY_ALERT_RADIUS, radius).apply()
        android.util.Log.i("WAKE", "알림 반경 저장: ${radius}m")
    }

    /** 현재 저장된 알림 반경 반환 (기본 500m) */
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun getAlertRadius(): Float {
        return reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getFloat(KEY_ALERT_RADIUS, 500f)
    }

}