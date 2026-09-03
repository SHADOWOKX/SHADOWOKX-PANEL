# Shadowokx Panel for Windows

A native Windows 11 notification-area companion for Codex usage and local weather. It is built with C#, .NET 8, WinUI 3, and the Windows App SDK—without embedding a browser or injecting into Explorer.

## Download

### [Download the latest Windows Setup (x64)](https://github.com/SHADOWOKX/SHADOWOKX-PANEL/releases/latest/download/ShadowokxPanel-Setup-x64.exe)

For most users, `ShadowokxPanel-Setup-x64.exe` is the only file needed. It installs for the current user and includes the required runtime files, so Visual Studio, the .NET SDK, and administrator privileges are not required.

- [View all releases and SHA-256 checksums](https://github.com/SHADOWOKX/SHADOWOKX-PANEL/releases)
- [Download the latest portable ZIP](https://github.com/SHADOWOKX/SHADOWOKX-PANEL/releases/latest/download/ShadowokxPanel-Portable-x64.zip)

Windows may show an **Unknown publisher** or Microsoft Defender SmartScreen warning while community releases are unsigned. Download only from the official release page and verify the file against `checksums.txt`.

## Install

1. Download `ShadowokxPanel-Setup-x64.exe`.
2. Open the downloaded file.
3. Complete the installer.
4. Launch **Shadowokx Panel** from the Start menu.

The app stays in the notification area when its popup is closed. Use **Exit** from the tray menu to stop it completely. To remove it, open **Settings → Apps → Installed apps**.

## Requirements

- Windows 11 22H2 or newer recommended
- x64 processor for the Setup download
- Codex installed and signed in for account usage data
- Internet access for Open-Meteo Weather

## Features

- Codex weekly and five-hour limits, reset information, and lifetime token usage
- Seven-day local activity history and usage graph
- Current weather, hourly forecast, rain, UV, high/low, sunrise, and sunset
- Native notification-area icon and compact taskbar-free popup
- Multiple native themes, accent choices, and density options
- No telemetry or analytics

## Source layout

- `windows-port` contains the native Windows implementation.
- `main` remains the Linux/GNOME implementation.
- Release downloads are published on the shared [GitHub Releases page](https://github.com/SHADOWOKX/SHADOWOKX-PANEL/releases).

For architecture details, privacy information, troubleshooting, developer commands, portable installation, and the release checklist, see the [complete Windows documentation](windows/README.md).

## Development

On Windows 11 with the .NET 8 SDK and Inno Setup 6 installed:

```powershell
cd windows
.\scripts\test.ps1
.\scripts\release.ps1 -Configuration Release -Runtime win-x64
```

The validated release files are written to `windows\artifacts\release`.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
