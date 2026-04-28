package com.wakeme_mobile

import org.json.JSONArray
import java.util.Calendar

/**
 * 지오펜스 방식에서 GPS 폴링 방식으로 전환됨.
 * onReceive는 더 이상 사용하지 않으며,
 * companion object의 유틸 함수는 WakeMeService / WakeMeWatchdogReceiver에서 계속 사용.
 */
class WakeMeGeofenceReceiver {

    companion object {

        /**
         * 지오펜스 알림 허용 시간 창:
         *   [출발시간 - 10분] ~ [출발시간 + 2시간]
         *
         * 예) 출발 07:00 → 06:50 ~ 09:00 사이에만 알림
         * departTime이 비어있으면 항상 true.
         */
        fun isWithinServiceWindow(departTime: String): Boolean {
            if (departTime.isBlank()) return true
            val parts = departTime.split(":")
            if (parts.size != 2) return true
            val depHour = parts[0].toIntOrNull() ?: return true
            val depMin  = parts[1].toIntOrNull() ?: return true

            val now         = Calendar.getInstance()
            val nowMin      = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
            val depTotalMin = depHour * 60 + depMin

            var elapsed = nowMin - depTotalMin
            if (elapsed > 720)  elapsed -= 1440
            if (elapsed < -720) elapsed += 1440

            val withinWindow = elapsed in -10..120
            android.util.Log.i("WAKE_GEO",
                "시간창 체크: departTime=$departTime, elapsed=${elapsed}분, 허용=$withinWindow")
            return withinWindow
        }

        fun parseWaypoints(json: String): List<Waypoint> {
            return try {
                val arr = JSONArray(json)
                (0 until arr.length()).map { i ->
                    val obj = arr.getJSONObject(i)
                    Waypoint(
                        id   = obj.getString("id"),
                        lat  = obj.getDouble("lat"),
                        lng  = obj.getDouble("lng"),
                        name = obj.getString("name"),
                        type = obj.getString("type"),
                    )
                }
            } catch (e: Exception) {
                android.util.Log.e("WAKE_GEO", "waypoints 파싱 실패", e)
                emptyList()
            }
        }

        /** 다중 경로 JSON 배열에서 전체 waypoint 플래튼 */
        fun parseAllRouteWaypoints(allRoutesJson: String): List<Waypoint> {
            return try {
                val routes = JSONArray(allRoutesJson)
                val result = mutableListOf<Waypoint>()
                for (i in 0 until routes.length()) {
                    val route   = routes.getJSONObject(i)
                    val wpArray = route.getJSONArray("waypoints")
                    result.addAll(parseWaypoints(wpArray.toString()))
                }
                result
            } catch (e: Exception) {
                android.util.Log.e("WAKE_GEO", "다중 경로 파싱 실패", e)
                emptyList()
            }
        }

        /** 마지막 목적지 이름 (포그라운드 알림 본문용) */
        fun lastDestinationName(allRoutesJson: String): String {
            return try {
                val routes = JSONArray(allRoutesJson)
                if (routes.length() == 0) return ""
                val last = routes.getJSONObject(routes.length() - 1)
                val wps  = last.getJSONArray("waypoints")
                if (wps.length() == 0) return ""
                wps.getJSONObject(wps.length() - 1).optString("name", "")
            } catch (e: Exception) { "" }
        }

        /** { routeId → departTime } 맵 */
        fun buildRouteDepartMap(allRoutesJson: String?): Map<String, String> {
            if (allRoutesJson.isNullOrEmpty()) return emptyMap()
            return try {
                val routes = JSONArray(allRoutesJson)
                (0 until routes.length()).associate { i ->
                    val r = routes.getJSONObject(i)
                    r.getString("routeId") to r.optString("departTime", "")
                }
            } catch (e: Exception) { emptyMap() }
        }

        /** "routeId__wp_N" 에서 routeId 추출 */
        fun extractRouteId(waypointId: String): String =
            waypointId.substringBefore("__")
    }
}

data class Waypoint(
    val id:   String,
    val lat:  Double,
    val lng:  Double,
    val name: String,
    val type: String,   // "transfer" | "destination"
)
