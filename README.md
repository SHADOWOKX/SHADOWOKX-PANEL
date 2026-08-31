# Shadowokx Panel

A lightweight panel I built to monitor Codex usage and weather from one place.

## Features

- Codex weekly limit and reset time
- Lifetime token usage
- Local 7-day activity graph
- Idle / Steady / Peak usage state
- Weather, UV, hourly forecast, sunrise/sunset
- Themes and custom accent colors
- No telemetry or analytics

## Platforms

### Linux
Native GNOME Shell extension.

Tested on:
- Ubuntu 26.04.1
- GNOME Shell 50
- Wayland

Designed to work on other Linux distributions using supported GNOME versions.

### Windows
Native Windows version built with C#, .NET 8, and WinUI 3.

It uses a system tray popup instead of the GNOME top bar.

## Install on Linux

```bash
./install.sh
gnome-extensions enable shadow-panel@shadowokx


