# Audio Switcher

Minimal audio output switcher for Windows. teenage engineering inspired design.

```
 Vertical                     Horizontal
┌──────────────────────┐     ┌──────────────────────┐
│  🔊 AUDIO OUT        │     │ 🔊  [🎧][🎧][🖥][🔊] │
├──────────────────────┤     └──────────────────────┘
│  🎧 Headphones       │ ←
│  🎧 Headset          │
│  🖥 HDMI Monitor     │
│  🔊 Speakers         │
└──────────────────────┘
```

## Features

- 1-click audio output switching
- **Vertical / Horizontal layout** switchable (icon-only compact mode)
- Device type icons (speaker, headphones, headset, HDMI, digital, bluetooth)
- Hover tooltips in horizontal mode
- Device filtering (show/hide specific devices)
- Always on top (optional)
- System tray integration
- Global hotkey (Alt+A by default)
- Auto-start with Windows
- Single instance (second launch focuses existing window)
- Frameless, draggable window
- Minimal, dark UI

## Prerequisites

### 1. Install Node.js

Download and install from: https://nodejs.org/ (LTS version recommended)

### 2. Install AudioDeviceCmdlets PowerShell Module

Open PowerShell **as Administrator** and run:

```powershell
Install-Module -Name AudioDeviceCmdlets -Force
```

If prompted about an untrusted repository, type `Y` to confirm.

## Setup

```bash
# Clone or download this folder, then:
cd audio-switcher

# Install dependencies
npm install

# Run the app
npm start
```

## Build

```bash
# Build portable .exe (no installation required)
npm run build

# Build installer
npm run build:installer
```

The output will be in the `dist` folder.

### Releases

Pushing a version tag triggers an automated build and GitHub Release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The portable `.exe` and installer are attached to the release for download.

## Usage

- **Click** on a device to switch audio output
- **Drag** the title bar to move the window
- **Alt+A** to show/hide the window
- **Layout button** to switch between vertical and horizontal mode
- **Settings button** to show/hide specific devices
- **Right-click** the tray icon for options:
  - Always on Top
  - Start with Windows
  - Start Minimized

## Troubleshooting

### "AudioDeviceCmdlets not found"

Make sure you installed the module in PowerShell as Administrator:

```powershell
Install-Module -Name AudioDeviceCmdlets -Force
```

### No devices showing

1. Check that audio devices are connected
2. Open Windows Sound settings to verify devices are enabled
3. Click the refresh button in the app

### Hotkey not working

- Make sure no other app is using Alt+A
- The app must be running (check system tray)

## Customization

Edit `src/main.js` to change:
- Default hotkey (search for `hotkey: 'Alt+A'`)
- Window size
- Other default settings

Edit `src/index.html` to change:
- Colors (CSS variables at the top)
- Fonts
- Layout
- Device icon mappings (`getDeviceIcon` function)

## License

MIT
