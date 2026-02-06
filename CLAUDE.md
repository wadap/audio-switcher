# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
# Install dependencies
npm install

# Run the app in development
npm start

# Build portable executable (output: dist/AudioSwitcher-Portable.exe)
npm run build

# Build installer (output: dist/)
npm run build:installer
```

## CI/CD

- **Build CI**: Runs on push to `main`/`develop` and PRs to `main` (`.github/workflows/build.yml`)
- **Release**: Triggered by `v*` tags. Builds portable + installer, creates GitHub Release with artifacts (`.github/workflows/release.yml`)

```bash
# Create a release
git tag v1.0.0
git push origin v1.0.0
```

## Prerequisites

The app requires the AudioDeviceCmdlets PowerShell module to be installed:
```powershell
Install-Module -Name AudioDeviceCmdlets -Force
```

## Architecture

This is an Electron app for Windows that switches audio output devices using PowerShell.

### File Structure
- `src/main.js` - Main process: window management, tray, hotkeys, IPC handlers, PowerShell execution, single-instance lock
- `src/index.html` - Renderer: UI, device list, layout switching, device icons, tooltip (single-file with embedded CSS/JS)
- `.github/workflows/build.yml` - CI build workflow
- `.github/workflows/release.yml` - Release workflow (triggered by version tags)

### Key Technical Details

**Audio Device Control**: Uses the AudioDeviceCmdlets PowerShell module via `child_process.exec()`. Commands are executed directly (not via script files) with UTF-8 encoding. Device names may be in Japanese (e.g. ヘッドセット, ヘッドホン).

**Single Instance**: Uses `app.requestSingleInstanceLock()` to prevent multiple instances. Second instance focuses the existing window.

**Layout Modes**: Supports vertical (default, list view) and horizontal (compact, icon-only with tooltips) layouts. Switchable via UI button, persisted in settings.

**Device Icons**: Automatically determined from device name via `getDeviceIcon()`. Matches keywords in both English and Japanese (headset/ヘッドセット, headphone/ヘッドホン, HDMI, digital, bluetooth, etc.). Default icon is speaker.

**IPC Channels**:
- `get-audio-devices` - Lists playback devices via PowerShell
- `set-audio-device` - Sets default audio device by ID
- `get-settings` / `set-setting` - Persistent settings via electron-store
- `get-enabled-devices` / `set-enabled-devices` - Device visibility filter
- `get-known-devices` / `set-known-devices` - Tracks all seen devices (for new device detection)
- `get-layout` / `set-layout` - Layout mode (vertical/horizontal)
- `resize-window` - Dynamic window resize (width, height)
- `close-window` - Hide window to tray

**Settings Storage**: Uses `electron-store` with defaults in `src/main.js:6-17`. Settings include `alwaysOnTop`, `startMinimized`, `hotkey`, `windowPosition`, `autoLaunch`, `enabledDevices`, `knownDevices`, `layout`.

**Auto-start**: Implemented via Windows Registry (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`).

**Window Behavior**: Frameless, transparent, always-on-top by default. Close button hides to tray rather than quitting. Window size adjusts dynamically based on device count and layout mode.
