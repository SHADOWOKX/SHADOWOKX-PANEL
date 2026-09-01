# Shadowokx Panel

A lightweight GNOME Shell panel for checking Codex usage and local weather from one place.

Release `2.3.3`.

## Features

- Codex weekly and five-hour limits
- Token activity and seven-day history
- Local weather, UV, hourly forecast, and sunrise/sunset
- Custom themes, colors, density, and panel width
- Cached data during temporary connection failures
- No telemetry or analytics

## Requirements

- Ubuntu 26.04.1 LTS
- GNOME Shell 50.x
- Wayland
- GJS 1.88 or newer

## Install

Clone the repository, open its directory, and run:

```bash
./install.sh
```

Log out and back in, then enable the extension:

```bash
gnome-extensions enable shadow-panel@shadowokx
```

Open preferences:

```bash
gnome-extensions prefs shadow-panel@shadowokx
```

## Update

Pull the latest changes and run the installer again:

```bash
git pull
./install.sh
```

Log out and back in to load the updated extension.

## Uninstall

```bash
./uninstall.sh
```

## Development

Run the project checks:

```bash
./scripts/check.sh
```

Build the installable package:

```bash
./scripts/package.sh
```

## Privacy

Shadowokx Panel uses the signed-in local Codex client for usage data and Open-Meteo for weather. It does not read Codex credentials or include telemetry.

## Contributors

- [SHADOWOKX](https://github.com/SHADOWOKX) — creator and maintainer

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
