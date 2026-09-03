# Shadowokx Panel

A lightweight cross-platform panel for checking **ChatGPT Codex usage** and **local weather** from one place.

- Weekly and 5-hour Codex limits
- Token activity and history
- Local weather and hourly forecast
- Native Linux and Windows interfaces
- No telemetry or analytics

## Windows 11

### [Download the latest Windows Setup (x64)](https://github.com/SHADOWOKX/SHADOWOKX-PANEL/releases/latest/download/ShadowokxPanel-Setup-x64.exe)

Download the Setup, open it, and install. It is self-contained and does not require the .NET SDK, Visual Studio, or administrator privileges.

### Screenshots

Click any screenshot to open the original-resolution PNG.

#### Codex usage

<p align="center">
  <a href="assets/windows-codex.png">
    <img src="assets/windows-codex.png" alt="Shadowokx Panel Codex view on Windows" width="562">
  </a>
</p>

#### Weather

<p align="center">
  <a href="assets/windows-weather.png">
    <img src="assets/windows-weather.png" alt="Shadowokx Panel Weather view on Windows" width="548">
  </a>
</p>

#### Windows system tray

<p align="center">
  <a href="assets/windows-tray.png">
    <img src="assets/windows-tray.png" alt="Shadowokx Panel Windows system tray icon" width="250">
  </a>
</p>

> The current Windows build is unsigned, so SmartScreen may show an **Unknown publisher** warning.

[Windows source and documentation](https://github.com/SHADOWOKX/SHADOWOKX-PANEL/tree/windows-port)

## Linux (GNOME)

Tested on Ubuntu 26.04.1, GNOME Shell 50 and Wayland.

```bash
git clone https://github.com/SHADOWOKX/SHADOWOKX-PANEL.git
cd SHADOWOKX-PANEL
./install.sh
```

Log out and back in once, then enable the extension:

```bash
gnome-extensions enable shadow-panel@shadowokx
```

### Screenshots

Click any screenshot to open the original-resolution PNG.

#### Codex usage

<p align="center">
  <a href="assets/linux-codex.png">
    <img src="assets/linux-codex.png" alt="Shadowokx Panel Codex usage view on Linux GNOME" width="444">
  </a>
</p>

#### Weather

<p align="center">
  <a href="assets/linux-weather.png">
    <img src="assets/linux-weather.png" alt="Shadowokx Panel weather view on Linux GNOME" width="443">
  </a>
</p>

#### GNOME top bar

<p align="center">
  <a href="assets/linux-tray.png">
    <img src="assets/linux-tray.png" alt="Shadowokx Panel indicators in the Linux GNOME top bar" width="137">
  </a>
</p>

## Privacy

Shadowokx Panel uses the signed-in local Codex client for usage data and Open-Meteo for weather. It does not read Codex credentials or include telemetry.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
