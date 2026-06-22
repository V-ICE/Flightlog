# UAVLogBook — Documentation

All installation guides are in this folder as PDF files.

## Which guide do you need?

| Your situation | Guide |
|----------------|-------|
| Installing on **cPanel shared hosting** | `UAVLogBook_Install_Guide.pdf` |
| Installing with **Docker on any PC** (Windows / macOS / Linux overview) | `UAVLogBook_PC_Docker_Install.pdf` |
| Installing with **Docker on Ubuntu** server or desktop | `UAVLogBook_Ubuntu_Docker_Install.pdf` |
| Installing with **Docker** (generic — all platforms, includes Nginx SSL) | `UAVLogBook_Docker_Install.pdf` |
| Installing on **Synology DS412+** via Docker | `UAVLogBook_Synology_DS412_Docker.pdf` |
| **Upgrading the RAM** in a Synology DS412+ | `DS412_RAM_Upgrade_Guide.pdf` |

## Quick decision tree

```
Do you have a web hosting account (cPanel)?
  └── YES → UAVLogBook_Install_Guide.pdf

Do you want to run Docker?
  ├── On Ubuntu (server or desktop)
  │     └── UAVLogBook_Ubuntu_Docker_Install.pdf
  ├── On Windows or macOS
  │     └── UAVLogBook_PC_Docker_Install.pdf
  └── On Synology DS412+
        ├── First: DS412_RAM_Upgrade_Guide.pdf  (if you have 1 GB RAM)
        └── Then:  UAVLogBook_Synology_DS412_Docker.pdf
```

## What each guide covers

### UAVLogBook_Install_Guide.pdf
Complete cPanel hosting install — PHP REST API, MySQL database, React web app build,
React Native mobile app (iOS + Android), Skyline .skylog format spec, FPV video sync setup.

### UAVLogBook_Ubuntu_Docker_Install.pdf  ← Start here for Ubuntu
- Install Docker Engine on Ubuntu 20.04 / 22.04 / 24.04
- Install Docker Compose v2
- User groups, auto-start on boot (systemd service)
- Development mode with hot reload
- Production mode with Nginx + free SSL (Let's Encrypt)
- Firewall setup (ufw)
- Backup, restore, update, troubleshooting

### UAVLogBook_PC_Docker_Install.pdf
- Install Docker Desktop on Windows, macOS, Linux
- Dev mode (hot reload, Xdebug, MySQL exposed)
- Production mode with and without SSL
- Xdebug VS Code configuration
- Full command reference

### UAVLogBook_Docker_Install.pdf
- Full stack reference (all platforms)
- Container and volume architecture
- Nginx production config with rate limiting and SSL
- All Makefile commands with docker compose equivalents

### UAVLogBook_Synology_DS412_Docker.pdf
- Purpose-built for DSM 6.2, Docker 20.10, kernel 3.10
- Uses mariadb:10.6 and php:7.4-apache (confirmed compatible)
- docker-compose v1 syntax (hyphen, not space)
- Manual setup and automated install script

### DS412_RAM_Upgrade_Guide.pdf
- Compatible RAM modules (community-confirmed list)
- Full disassembly with 10 technical illustrations
- Step-by-step reassembly checklist
- Troubleshooting guide
