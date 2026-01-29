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

## Prerequisites

The app requires the AudioDeviceCmdlets PowerShell module to be installed:
```powershell
Install-Module -Name AudioDeviceCmdlets -Force
```

## Architecture

This is an Electron app for Windows that switches audio output devices using PowerShell.

### File Structure
- `src/main.js` - Main process: window management, tray, hotkeys, IPC handlers, PowerShell execution
- `src/index.html` - Renderer: UI and device list management (single-file with embedded CSS/JS)

### Key Technical Details

**Audio Device Control**: Uses the AudioDeviceCmdlets PowerShell module via `child_process.exec()`. Commands are executed directly (not via script files) with UTF-8 encoding.

**IPC Channels**:
- `get-audio-devices` - Lists playback devices via PowerShell
- `set-audio-device` - Sets default audio device by ID
- `get-settings` / `set-setting` - Persistent settings via electron-store

**Settings Storage**: Uses `electron-store` with defaults in `src/main.js:6-14`. Settings include `alwaysOnTop`, `startMinimized`, `hotkey`, `windowPosition`, `autoLaunch`.

**Auto-start**: Implemented via Windows Registry (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`).

**Window Behavior**: Frameless, transparent, always-on-top by default. Close button hides to tray rather than quitting.
