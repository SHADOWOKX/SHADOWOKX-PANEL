# Code signing policy

Free code signing provided by SignPath.io, certificate by SignPath Foundation.

## Project

Shadowokx Panel is an open-source desktop utility for Windows and Linux that displays ChatGPT Codex usage information and optional local weather.

Repository: https://github.com/SHADOWOKX/SHADOWOKX-PANEL

License: GPL-3.0-or-later

## Team roles

### Authors / Committers

- SHADOWOKX

### Reviewers

- SHADOWOKX

Changes submitted by external contributors are reviewed before being merged.

### Signing Approvers

- SHADOWOKX

Official release signing requests must be explicitly approved before signing.

## Build and release process

Windows release artifacts are built from the public source repository using GitHub Actions.

Only artifacts produced from the official repository and approved release workflow are eligible for code signing.

## Privacy policy

Shadowokx Panel does not collect telemetry or analytics and does not operate a developer-controlled backend.

Codex usage information is obtained through the user's locally installed and signed-in Codex client and is processed locally.

If the optional weather feature is enabled, the configured location is sent over HTTPS to the Open-Meteo geocoding and weather APIs in order to retrieve weather information.

Shadowokx Panel does not send Codex credentials, passwords, authentication tokens, or Codex usage information to Open-Meteo or to the project maintainer.

Open-Meteo is an external service and is subject to its own privacy policy.
