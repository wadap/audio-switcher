# Audio Switcher

Minimal audio output switcher for Windows. teenage engineering inspired design.

```
┌──────────────────────────┐
│  🔊 AUDIO OUT            │
├──────────────────────────┤
│  ● Headphones            │  ← Active
│  ○ Speakers              │
│  ○ USB DAC               │
└──────────────────────────┘
```

## Features

- 1-click audio output switching
- Always on top (optional)
- System tray integration
- Global hotkey (Alt+A by default)
- Auto-start with Windows
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

## Build Executable

```bash
# Build portable .exe (no installation required)
npm run build

# Build installer
npm run build:installer
```

The output will be in the `dist` folder.

## Usage

- **Click** on a device to switch audio output
- **Drag** the title bar to move the window
- **Alt+A** to show/hide the window
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

## License

MIT
# audio-switcher
