# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

WakeMe (`com.wakeme_mobile`) is a Korean transit "don't miss your stop" alarm app — Daejeon is the first launch market. Users register a route (bus/subway/KTX legs + an optional final destination address), and the app watches GPS in the background to fire a 환승(transfer)/하차(alight) notification as they approach each stop.

Login is Kakao-only (no Supabase Auth); the Kakao user ID is used directly as the primary key everywhere (`users.id`, `routes.user_id`, etc).

## Commands

```sh
npm start                 # Metro dev server
npm run android           # build + run on device/emulator
npm run lint               # eslint . (@react-native config)
npm test                   # jest
npx jest __tests__/App.test.tsx     # single test file
npx jest -t "<test name>"           # single test by name
npx tsc --noEmit            # typecheck only (no build step wired to this)
```

Native (Kotlin) changes — verify compilation without a full app build:
```sh
cd android && ./gradlew :app:compileDebugKotlin
```

Always edit files directly in the main repo path (`/Users/ijeongho/GitHub/wakeme_mobile/`), never in a worktree — Android Studio only watches the main repo, so worktree-only edits silently fail to show up there.

## Release process

Versioning is fastlane-driven, not manual edits to `android/app/build.gradle`:
```sh
bundle exec fastlane android internal               # bump minor, build AAB, upload to Play internal track (draft)
bundle exec fastlane android internal bump:patch    # bump:major / bump:minor / bump:patch
bundle exec fastlane android build_only             # build AAB only, no upload (signing sanity check)
```
CI (`.github/workflows/deploy.yml`) auto-builds and uploads to the Play Store on every push to `main` — `versionCode` there is computed as `100 + run_number` (independent of the fastlane-bumped value), track defaults to `internal` and is overridable via `workflow_dispatch`.

## Architecture

### The split: JS prepares data, native Kotlin does the actual monitoring

GPS polling and geofence distance checks run **entirely in the native Android foreground service** (`android/app/src/main/java/com/wakeme_mobile/WakeMeService.kt`), not in JS. JS's job ends at handing the service a waypoint list and calling start/stop on the bridge.

Two unused/legacy things not to be misled by:
- `src/utils/geofence.ts` (Haversine + `ALERT_DISTANCE` constants) is dead code — the real distance check is `WakeMeService.kt`'s own `haversineMeters()` + `ALERT_RADIUS_M`/`FINAL_DEST_RADIUS_M`.
- `react-native-geolocation-service` and `@react-native-community/geolocation` are both in `package.json` but neither is imported anywhere in `src/` — all location comes from Google Play Services `FusedLocationProviderClient` inside `WakeMeService.kt`.

### End-to-end flow: registering a route → getting alerted

1. **Register**: `RouteRegisterScreen` → `useRouteStore` → `src/api/routeApi.ts` writes to Supabase `routes` + `route_segments`.
2. **Build waypoints**: `RouteActiveScreen.startMonitoring()` walks `route.segments` (sorted by `order_index`) and resolves each leg's end-stop coordinates — bus/subway stops from Supabase `bus_stops`, KTX stations from the local table `src/data/ktxStations.ts` (KTX is a third `TransportMode` that never becomes a DB `route_segments.mode`, which only allows `'bus' | 'subway'`). The last leg is typed `"destination"`; if the route has a `final_dest_lat/lng`, a synthetic `wp_final_dest` waypoint is appended instead and the original last leg is demoted to `"transfer"` (so the service doesn't stop early).
3. **Hand off to native**: `src/utils/nativeService.ts` `startRouteMonitoring()` saves to an MMKV "route cache" (survives app restarts) and calls the bridge `WakeMeService.startAll(allRoutesJson, userId)` (`WakeMeServiceModule.kt`). Because multiple routes can be monitored simultaneously, every waypoint id gets prefixed `${routeId}__${wp.id}` so the native side can disambiguate.
4. **Native bridge → service**: `WakeMeServiceModule.kt` persists everything to Android `SharedPreferences` (`"WakeMePrefs"`, key `activeRoutes` = JSON array of `{routeId, waypoints, departTime, daysOfWeek}`) — note this is a *separate* store from the JS-side MMKV, and is the single source of truth on the native side — then starts `WakeMeService` as a foreground service.
5. **Polling**: `WakeMeService.kt` polls every 5s, skips fixes with accuracy worse than `MAX_ACCURACY_M` (50m — tuned for surface buses, not underground), and on each fix checks Haversine distance to every un-notified waypoint. `"transfer"` waypoints fire a 🔔 alert; `"destination"` waypoints fire the 🚨 "지금 내리세요" alert *and* end monitoring for that route (removed from `activeRoutes`, watchdog rescheduled for whatever routes remain).

### Battery-efficient resilience chain

The service intentionally does **not** run all day — it only polls within each route's *service window* (`[departTime - 10min, departTime + 3h]`, see `WakeMeGeofenceReceiver.isWithinServiceWindow`). Outside that window nothing runs. The chain that keeps it alive *inside* the window despite Doze/OS kills:

- **`WakeMeWindowStartReceiver`** — one-shot `AlarmManager.setExactAndAllowWhileIdle` per route, fired at `departTime`, starts the service and kicks off the watchdog.
- **`WakeMeWatchdogReceiver`** — self-chaining: on each firing it restarts the service if needed, POSTs a heartbeat, then re-schedules *itself* 10 minutes later via `setExactAndAllowWhileIdle` (deliberately not `setRepeating`, which Doze can delay by hours). It stops re-chaining once no route is in its window — the next day's `WindowStartReceiver` alarm restarts the chain.
- **`WakeMeBootReceiver`** — restores the service on `BOOT_COMPLETED`, on the custom `com.wakeme_mobile.RESTART_SERVICE` broadcast (sent from `WakeMeService.onDestroy()` whenever routes remain), and on notification-dismissed.
- All of the above read the same `SharedPreferences` (`activeRoutes`) rather than receiving fresh data — that's why intents only need to say "go check prefs", not carry payloads.

### Multi-route + day-of-week scheduling

- `daysOfWeek` uses JS `Date.getDay()` convention (0=Sun..6=Sat) everywhere, including in Kotlin (`(Calendar.DAY_OF_WEEK - 1) % 7`). An empty/absent array means "every day."
- This is checked redundantly in three places that all need to agree if you touch the schedule logic: `WakeMeService.checkNearbyWaypoints()`, `WakeMeWindowStartReceiver.scheduleAll()`, and JS `navigation/index.tsx`'s `rescheduleDepartureAlarms()`.

### Adding a new user-configurable setting

TTS volume and alert radius are the existing examples — follow the same shape:
1. SharedPreferences key constant in `WakeMeServiceModule.kt`'s companion object.
2. `@ReactMethod` setter + getter (getter usually `isBlockingSynchronousMethod = true` so JS can read it synchronously on modal open).
3. JS wrapper functions in `src/utils/nativeService.ts`.
4. UI control in `src/components/SettingsModal.tsx` (rendered globally from `src/navigation/index.tsx`, opened from the Home screen's ⚙️ header button — it's a single global modal, not per-route settings).
5. `WakeMeService.kt` reads the SharedPreferences value at point-of-use inside the polling loop (not cached at service start), so a change takes effect on the very next GPS tick without restarting the service.

### Notification channels (all created in `WakeMeService.createNotificationChannels()`)

| Channel | Importance | Purpose |
|---|---|---|
| `wakeme-tracking` | LOW | persistent "모니터링 중" foreground-service notification |
| `wakeme-alert` | HIGH | 환승(transfer) alerts |
| `wakeme-destination` | HIGH, lockscreen-public | 하차(alight) alerts — also TTS-spoken (`speakAlert`) if a wired/Bluetooth audio device is connected, at the user's saved TTS volume |

### Backend (external — not in this repo)

`https://wakeme-api.fly.dev` lives in a separate repo. Several native files fire-and-forget POST logs to it (`/api/notify/start`, `/api/notify/heartbeat`, `/api/notify/shutdown`, `/api/notify/gps-poll`, `/api/notify/alert-ack`) — these are best-effort telemetry only; failures are always swallowed and never affect the alert flow itself. `src/api/RestApi.ts` is the JS-side client pointed at the same base URL. If a feature needs new server-side logging, the client side can be written against a proposed endpoint shape immediately, but the actual endpoint must be added in that other repo before any data is captured.

### Database (Supabase / Postgres + PostGIS)

`supabase_schema.sql` is a partial, manually-applied reference (no migration tool) — it covers `bus_stops`, `subway_stations` (+ `nearby_bus_stops`/`nearby_subway_stations` PostGIS RPCs), `users`, `routes`, `route_segments`, `station_predictions`. It does **not** include the `questions` table that `CustomerSupportScreen`/`AdminScreen` read/write — don't treat the file as exhaustive. RLS policies are currently `USING (true)` (wide open) everywhere since auth is Kakao-based rather than Supabase JWT; that's flagged as a known TODO in the schema file itself.

### Build requirements

- `newArchEnabled=true` in `android/gradle.properties` is mandatory — `react-native-mmkv` v3 is JSI-only and fails to build with the old architecture. Don't disable it.
- New native modules must be registered by hand in `MainApplication.kt`'s `PackageList` (see `WakeMeServicePackage()`) — there's no autolinking for this in-tree module.
- API keys/secrets (Supabase URL+anon key, Kakao native app key, Naver Map client ID) are hardcoded directly in source (`src/api/supabaseClient.ts`, `MainApplication.kt`) rather than env vars — keep that in mind when rotating keys, there's no single `.env` to edit.
