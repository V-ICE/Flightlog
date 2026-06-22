# UAVLogBook — Full Stack UAV Flight Log Platform

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    cPanel Hosting                        │
│  ┌──────────────────┐    ┌──────────────────────────┐   │
│  │  PHP REST API    │    │   React Web App (SPA)    │   │
│  │  /public_html/   │    │   /public_html/app/      │   │
│  │  api/            │    │   (built static files)   │   │
│  └────────┬─────────┘    └──────────────────────────┘   │
│           │                                              │
│  ┌────────▼──────────────────────────────┐              │
│  │          MySQL Database               │              │
│  │  users / flights / telemetry /        │              │
│  │  parsed_logs / annotations            │              │
│  └───────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────┘
         ▲                        ▲
         │  REST API (HTTPS)      │  REST API (HTTPS)
         │                        │
┌────────┴──────┐       ┌─────────┴────────┐
│  React Native │       │  React Native    │
│  iOS App      │       │  Android App     │
└───────────────┘       └──────────────────┘
```

## Supported Log Formats

| Format | Extension | Source | Parser |
|--------|-----------|--------|--------|
| ArduPilot DataFlash | .BIN | ArduPilot/APM | Binary self-describing |
| MAVLink Telemetry | .tlog | Mission Planner, QGC | Binary MAVLink packets |
| PX4 ULog | .ulg / .ulog | PX4/Pixhawk | Binary ULog protocol |
| DJI TXT | .txt | DJI GO/Fly/Pilot | Binary (reverse-engineered) |
| DJI CSV | .csv | Litchi, DJI exports | Comma-separated |
| Generic CSV | .csv | Any GCS with CSV export | AI-detected columns |
| GPX | .gpx | Any GPS logger | XML/GPS standard |
| KML/KMZ | .kml/.kmz | Google Earth exports | XML path |
| Betaflight Blackbox | .bbl / .csv | Betaflight | Text/CSV |
| INAV Blackbox | .bbl | INAV | Text (Blackbox format) |

## Modules / Views (all toggleable)

- **Map View** — 2D/3D flight path on Leaflet map
- **Attitude** — Roll/Pitch/Yaw over time
- **Altitude Profile** — Baro + GPS altitude
- **Speed** — Ground speed, air speed, vertical rate
- **Battery** — Voltage, current, remaining %
- **GPS Quality** — Satellites, HDOP, fix type
- **Vibration / IMU** — Accelerometer, gyro data
- **RC Input** — Channel values over time
- **Events Timeline** — Mode changes, warnings, errors
- **3D Flight Replay** — Animated 3D path
- **Statistics Panel** — Flight summary cards

## Quick Install

1. Run `install_server.sh` on your cPanel hosting via SSH
2. Open the web app and configure your API URL
3. Build mobile apps with your API URL in `.env`

---
## Components

- `/server` — PHP REST API (cPanel compatible)
- `/web` — React web application
- `/mobile` — React Native app (iOS + Android)
- `/installer` — Automated install scripts
- `/docs` — Full API documentation
