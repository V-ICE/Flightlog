# Changelog

All notable changes to Flightlog are documented here.  
Format: `v<major>.<minor>.<patch>` — patch for fixes, minor for features, major for breaking changes.

---

## [v1.2.2] — 2026-07-04

### Fixed
- Skyline parser: removed TLM subtype whitelist `[0x2C, 0x28, 0x29]` that was discarding all packets after ~248s into a flight. All subtypes carry GPS at the same byte offsets (12-19); the existing coordinate sanity checks filter junk. A 52-min flight was being recorded as 4 min.

---

## [v1.2.1] — 2026-06-23

### Changed
- Renamed project from UAVLogBook to Flightlog throughout codebase, config, mobile app, and docs
- Updated mobile bundle IDs to `com.vice.flightlog`, scheme to `flightlog`
- Rewrote README with accurate Docker-first install instructions

### Fixed
- `mgrs` npm dependency pinned to `^2.1.0` (v3.0.0 does not exist on npm, breaking fresh installs)

---

## [v1.2.0] — 2026-06-22

### Added
- 3 new themes: Phantom (red HUD), Cyber (neon violet), Arctic (bioluminescent teal)
- DB composite indexes on `flights(user_id, parse_status)` and `flights(user_id, created_at)`
- Vite manual chunk splitting: vendor / charts / maps bundles
- Apache `no-cache` header on `index.html` to prevent stale SPA after builds
- API cache headers: telemetry (1h), stats (2m), flight list (30s)
- GPS preview capped at 500 points for faster flight detail load
- GitHub repo: https://github.com/v-ice/Flightlog (public)

### Fixed
- Black screen caused by missing `useAuthStore` import in App.jsx
- API 404 after `--emptyOutDir` build — resolved by `docker compose restart app`
- Build changes silently ignored due to wrong Docker volume name (`uavlogbook_v3_web_dist` vs `uavlogbook_web_dist`)

### Removed
- FlightManager / delete flight UI (reverted per design decision)

---

## [v1.1.0] — 2026-06-20

### Added
- UAV fleet database with per-aircraft specs (fixed wing, recon, strike variants)
- Aircraft maintenance log
- Recon photo gallery with deduplication
- Aircraft cover photo upload
- Leaflet map with satellite/terrain/streets tile layers, direction arrows, fullscreen button
- FPV video sync overlay (VideoSync component)
- Module visibility and ordering saved per user (`/api/v1/prefs`)
- Share tokens — 30-day public flight links

### Changed
- Responsive UI overhaul
- Theme system with layout variants (default, hud, terminal, magazine)
