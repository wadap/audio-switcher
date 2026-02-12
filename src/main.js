const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, nativeTheme, screen } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const Store = require('electron-store');

const store = new Store({
  defaults: {
    alwaysOnTop: true,
    startMinimized: false,
    hotkey: 'Alt+A',
    windowPosition: null,
    autoLaunch: false,
    enabledDevices: null, // null = all devices enabled, array = specific device IDs
    knownDevices: [], // all device IDs ever seen, used to detect truly new devices
    layout: 'vertical', // 'vertical' or 'horizontal'
    miniBarMode: false,
    miniBarPosition: null
  }
});

let mainWindow;
let miniBarWindow;
let tooltipWindow;
let tray;
let isQuitting = false;
let cachedDevices = [];
let cachedEnabledIds = null;

// Shared helper: parse device name
function parseDeviceNameMain(name) {
  const match = name.match(/^(.+?)\s*\((.+)\)\s*$/);
  if (match) {
    return { type: match[1].trim(), hardware: match[2].trim() };
  }
  return { type: name, hardware: '' };
}

// Shared helper: fetch audio devices via PowerShell
function fetchAudioDevices() {
  return new Promise((resolve) => {
    const psCommand = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
      $ErrorActionPreference = 'Stop';
      try {
        Import-Module AudioDeviceCmdlets -ErrorAction Stop;
        $devices = Get-AudioDevice -List | Where-Object { $_.Type -eq 'Playback' };
        $default = Get-AudioDevice -Playback;
        $result = @{ devices = @($devices | ForEach-Object { @{ id = $_.ID; name = $_.Name; isDefault = ($_.ID -eq $default.ID) } }) };
        ConvertTo-Json $result -Compress -Depth 5
      } catch {
        Write-Output ('{"devices":[],"error":"' + $_.Exception.Message.Replace('"', "'").Replace('\\', '/') + '"}')
      }
    `.replace(/\n/g, ' ').trim();

    exec(`chcp 65001 >nul && powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${psCommand.replace(/"/g, '\\"')}"`,
      { encoding: 'utf8', shell: 'cmd.exe' },
      (error, stdout, stderr) => {
        if (error) {
          console.error('Error getting devices:', error);
          console.error('stderr:', stderr);
          resolve({ devices: [], error: error.message });
          return;
        }
        try {
          const jsonMatch = stdout.match(/\{.*\}/s);
          if (jsonMatch) {
            resolve(JSON.parse(jsonMatch[0]));
          } else {
            resolve({ devices: [], error: 'No JSON output from PowerShell' });
          }
        } catch (e) {
          console.error('Parse error:', e, 'stdout:', stdout);
          resolve({ devices: [], error: 'Failed to parse device list: ' + stdout.substring(0, 100) });
        }
      }
    );
  });
}

// Ensure AudioDeviceCmdlets is installed (for dev start and portable; installer does this separately)
// 管理者不要: -Scope CurrentUser でユーザー単位にインストール。NuGet を先に入れて対話を避ける。
function ensureAudioDeviceCmdlets() {
  if (process.platform !== 'win32') return Promise.resolve();
  return new Promise((resolve) => {
    const ps = [
      '$ErrorActionPreference = "Stop"',
      'if (!(Get-PackageProvider -Name NuGet -ErrorAction SilentlyContinue)) { Install-PackageProvider -Name NuGet -Force -Scope CurrentUser | Out-Null }',
      'if (!(Get-Module -ListAvailable -Name AudioDeviceCmdlets)) { Install-Module -Name AudioDeviceCmdlets -Force -Scope CurrentUser }'
    ].join('; ');
    exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${ps.replace(/"/g, '\\"')}"`,
      { shell: true },
      (error) => {
        if (error) console.error('AudioDeviceCmdlets install check failed:', error.message);
        resolve();
      }
    );
  });
}

// Shared helper: switch audio device via PowerShell
function switchAudioDeviceMain(deviceId) {
  return new Promise((resolve) => {
    const psCommand = `Import-Module AudioDeviceCmdlets -ErrorAction Stop; Set-AudioDevice -ID '${deviceId}'; Write-Output 'OK'`;
    exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${psCommand}"`,
      { shell: true },
      (error) => {
        resolve({ success: !error });
      }
    );
  });
}

// Windows自動起動の設定
function setAutoLaunch(enable) {
  const appPath = app.getPath('exe');
  const AutoLaunch = require('child_process');
  
  if (enable) {
    exec(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "AudioSwitcher" /t REG_SZ /d "${appPath}" /f`);
  } else {
    exec(`reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "AudioSwitcher" /f`);
  }
  store.set('autoLaunch', enable);
}

function createWindow() {
  const savedPosition = store.get('windowPosition');
  const layout = store.get('layout');
  const isHorizontal = layout === 'horizontal';
  
  mainWindow = new BrowserWindow({
    width: isHorizontal ? 300 : 280,
    height: isHorizontal ? 140 : 400,
    x: savedPosition?.x,
    y: savedPosition?.y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: store.get('alwaysOnTop'),
    skipTaskbar: true,
    show: !store.get('startMinimized'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('src/index.html');

  // ウィンドウ位置を保存
  mainWindow.on('moved', () => {
    const [x, y] = mainWindow.getPosition();
    store.set('windowPosition', { x, y });
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Audio Switcher');

  rebuildTrayMenu();

  tray.on('click', () => {
    if (store.get('miniBarMode')) {
      if (miniBarWindow && miniBarWindow.isVisible()) {
        miniBarWindow.hide();
      } else if (miniBarWindow) {
        miniBarWindow.show();
      }
    } else {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  // テーマ変更時にアイコンを更新
  nativeTheme.on('updated', () => {
    tray.setImage(createTrayIcon());
  });
}

async function rebuildTrayMenu() {
  // Fetch fresh device list if cache is empty
  if (cachedDevices.length === 0) {
    const result = await fetchAudioDevices();
    if (!result.error) {
      cachedDevices = result.devices;
      cachedEnabledIds = store.get('enabledDevices');
    }
  }

  // Filter to enabled devices
  let displayDevices = cachedDevices;
  if (cachedEnabledIds !== null) {
    displayDevices = cachedDevices.filter(d => cachedEnabledIds.includes(d.id));
  }

  // Build device menu items
  const deviceMenuItems = displayDevices.map(device => {
    const parsed = parseDeviceNameMain(device.name);
    return {
      label: parsed.type,
      type: 'radio',
      checked: device.isDefault,
      click: async () => {
        const result = await switchAudioDeviceMain(device.id);
        if (result.success) {
          cachedDevices.forEach(d => d.isDefault = (d.id === device.id));
          rebuildTrayMenu();
          // Notify renderer windows to refresh
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('refresh-devices');
          }
          if (miniBarWindow && !miniBarWindow.isDestroyed()) {
            miniBarWindow.webContents.send('refresh-devices');
          }
        }
      }
    };
  });

  const template = [
    ...deviceMenuItems,
    { type: 'separator' },
    {
      label: 'Show/Hide',
      click: () => {
        if (store.get('miniBarMode')) {
          if (miniBarWindow && miniBarWindow.isVisible()) {
            miniBarWindow.hide();
          } else if (miniBarWindow) {
            miniBarWindow.show();
          }
        } else {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      }
    },
    {
      label: 'Mini Bar Mode',
      type: 'checkbox',
      checked: store.get('miniBarMode'),
      click: (item) => {
        if (item.checked) switchToMiniBarMode();
        else switchToNormalMode();
      }
    },
    { type: 'separator' },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: store.get('alwaysOnTop'),
      click: (item) => {
        store.set('alwaysOnTop', item.checked);
        if (mainWindow) mainWindow.setAlwaysOnTop(item.checked);
      }
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: store.get('autoLaunch'),
      click: (item) => {
        setAutoLaunch(item.checked);
      }
    },
    {
      label: 'Start Minimized',
      type: 'checkbox',
      checked: store.get('startMinimized'),
      click: (item) => {
        store.set('startMinimized', item.checked);
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ];

  const contextMenu = Menu.buildFromTemplate(template);
  tray.setContextMenu(contextMenu);
}

function createTrayIcon() {
  // システムテーマに応じたアイコンを読み込み（PNG アセット）
  // ダークモード（タスクバーが暗い）→ 白いアイコン
  // ライトモード（タスクバーが明るい）→ 黒いアイコン
  const isDark = nativeTheme.shouldUseDarkColors;
  const filename = isDark ? 'tray-icon-dark.png' : 'tray-icon-light.png';
  const iconPath = path.join(app.getAppPath(), 'assets', filename);
  return nativeImage.createFromPath(iconPath);
}

// Mini Bar
function createMiniBar() {
  const savedPosition = store.get('miniBarPosition');

  miniBarWindow = new BrowserWindow({
    width: 200,
    height: 42,
    x: savedPosition?.x,
    y: savedPosition?.y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: true,
    opacity: 0.3,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  miniBarWindow.loadFile('src/mini-bar.html');

  miniBarWindow.on('moved', () => {
    if (miniBarWindow.isDestroyed()) return;
    const [x, y] = miniBarWindow.getPosition();
    store.set('miniBarPosition', { x, y });
    snapToEdges(miniBarWindow);
  });

  miniBarWindow.on('closed', () => {
    miniBarWindow = null;
    if (tooltipWindow && !tooltipWindow.isDestroyed()) {
      tooltipWindow.close();
      tooltipWindow = null;
    }
  });
}

function snapToEdges(win) {
  if (win.isDestroyed()) return;
  const bounds = win.getBounds();
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const workArea = display.workArea;
  const threshold = 20;
  let snapped = false;

  if (Math.abs(bounds.x - workArea.x) < threshold) {
    bounds.x = workArea.x;
    snapped = true;
  } else if (Math.abs((bounds.x + bounds.width) - (workArea.x + workArea.width)) < threshold) {
    bounds.x = workArea.x + workArea.width - bounds.width;
    snapped = true;
  }

  if (Math.abs(bounds.y - workArea.y) < threshold) {
    bounds.y = workArea.y;
    snapped = true;
  } else if (Math.abs((bounds.y + bounds.height) - (workArea.y + workArea.height)) < threshold) {
    bounds.y = workArea.y + workArea.height - bounds.height;
    snapped = true;
  }

  if (snapped) {
    win.setBounds(bounds);
    store.set('miniBarPosition', { x: bounds.x, y: bounds.y });
  }
}

let opacityTimer = null;
function animateOpacity(win, target) {
  if (!win || win.isDestroyed()) return;
  if (opacityTimer) {
    clearInterval(opacityTimer);
    opacityTimer = null;
  }
  const current = win.getOpacity();
  const steps = 5;
  const stepDuration = 30;
  const delta = (target - current) / steps;
  let step = 0;

  opacityTimer = setInterval(() => {
    step++;
    if (step >= steps || win.isDestroyed()) {
      clearInterval(opacityTimer);
      opacityTimer = null;
      if (!win.isDestroyed()) win.setOpacity(target);
      return;
    }
    win.setOpacity(current + delta * step);
  }, stepDuration);
}

function switchToMiniBarMode() {
  store.set('miniBarMode', true);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  if (!miniBarWindow || miniBarWindow.isDestroyed()) {
    createMiniBar();
  } else {
    miniBarWindow.show();
  }
  rebuildTrayMenu();
}

function switchToNormalMode() {
  store.set('miniBarMode', false);
  if (tooltipWindow && !tooltipWindow.isDestroyed()) {
    tooltipWindow.close();
    tooltipWindow = null;
  }
  if (miniBarWindow && !miniBarWindow.isDestroyed()) {
    miniBarWindow.close();
    miniBarWindow = null;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
  rebuildTrayMenu();
}

function registerHotkey() {
  const hotkey = store.get('hotkey');

  globalShortcut.unregisterAll();

  try {
    globalShortcut.register(hotkey, () => {
      if (store.get('miniBarMode')) {
        if (miniBarWindow && !miniBarWindow.isDestroyed() && miniBarWindow.isVisible()) {
          miniBarWindow.hide();
        } else if (miniBarWindow && !miniBarWindow.isDestroyed()) {
          miniBarWindow.show();
        }
      } else {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });
  } catch (error) {
    console.error('Failed to register hotkey:', error);
  }
}

// IPC handlers
ipcMain.handle('get-audio-devices', async () => {
  let result = await fetchAudioDevices();
  if (result.error && result.error.includes('AudioDeviceCmdlets')) {
    await Promise.race([
      ensureAudioDeviceCmdlets(),
      new Promise((r) => setTimeout(r, 90000))
    ]);
    result = await fetchAudioDevices();
  }
  if (!result.error) {
    cachedDevices = result.devices;
    cachedEnabledIds = store.get('enabledDevices');
  }
  return result;
});

ipcMain.handle('set-audio-device', async (event, deviceId) => {
  const result = await switchAudioDeviceMain(deviceId);
  if (result.success) {
    cachedDevices.forEach(d => d.isDefault = (d.id === deviceId));
    rebuildTrayMenu();
  }
  return result;
});

ipcMain.handle('get-settings', () => {
  return {
    alwaysOnTop: store.get('alwaysOnTop'),
    startMinimized: store.get('startMinimized'),
    hotkey: store.get('hotkey'),
    autoLaunch: store.get('autoLaunch')
  };
});

ipcMain.handle('set-setting', (event, key, value) => {
  store.set(key, value);
  
  if (key === 'alwaysOnTop') {
    mainWindow.setAlwaysOnTop(value);
  } else if (key === 'hotkey') {
    registerHotkey();
  } else if (key === 'autoLaunch') {
    setAutoLaunch(value);
  }
  
  return true;
});

ipcMain.on('close-window', () => {
  mainWindow.hide();
});

ipcMain.handle('get-enabled-devices', () => {
  return store.get('enabledDevices');
});

ipcMain.handle('set-enabled-devices', (event, deviceIds) => {
  store.set('enabledDevices', deviceIds);
  cachedEnabledIds = deviceIds;
  rebuildTrayMenu();
  return true;
});

ipcMain.handle('get-known-devices', () => {
  return store.get('knownDevices');
});

ipcMain.handle('set-known-devices', (event, deviceIds) => {
  store.set('knownDevices', deviceIds);
  return true;
});

ipcMain.on('resize-window', (event, width, height) => {
  // setSize does not work on resizable:false + transparent windows on Windows.
  // Use setBounds with setResizable workaround.
  const bounds = mainWindow.getBounds();
  mainWindow.setResizable(true);
  mainWindow.setBounds({ x: bounds.x, y: bounds.y, width, height });
  mainWindow.setResizable(false);
});

ipcMain.handle('get-layout', () => {
  return store.get('layout');
});

ipcMain.handle('set-layout', (event, layout) => {
  store.set('layout', layout);
  return true;
});

// Mini bar IPC handlers
ipcMain.on('mini-bar-hover', (event, isHovering) => {
  if (!miniBarWindow || miniBarWindow.isDestroyed()) return;
  animateOpacity(miniBarWindow, isHovering ? 1.0 : 0.3);
});

ipcMain.on('mini-bar-resize', (event, width, height) => {
  if (!miniBarWindow || miniBarWindow.isDestroyed()) return;
  const bounds = miniBarWindow.getBounds();
  miniBarWindow.setResizable(true);
  miniBarWindow.setBounds({ x: bounds.x, y: bounds.y, width, height });
  miniBarWindow.setResizable(false);
});

ipcMain.on('mini-bar-context-menu', () => {
  if (!miniBarWindow || miniBarWindow.isDestroyed()) return;
  const menu = Menu.buildFromTemplate([
    { label: 'Switch to Normal Mode', click: () => switchToNormalMode() },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]);
  menu.popup({ window: miniBarWindow });
});

// Tooltip window for mini bar
ipcMain.on('mini-bar-tooltip-show', (event, data) => {
  if (!miniBarWindow || miniBarWindow.isDestroyed()) return;

  const barBounds = miniBarWindow.getBounds();
  // Calculate screen-space position of the hovered element
  const screenX = barBounds.x + data.elementRect.x;
  const screenY = barBounds.y + data.elementRect.y;
  const elemCenterX = screenX + data.elementRect.width / 2;

  const tipWidth = 200;
  const tipHeight = 42;

  if (!tooltipWindow || tooltipWindow.isDestroyed()) {
    tooltipWindow = new BrowserWindow({
      width: tipWidth,
      height: tipHeight,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });
    tooltipWindow.loadFile('src/mini-bar-tooltip.html');
    tooltipWindow.setIgnoreMouseEvents(true);
    tooltipWindow.once('ready-to-show', () => {
      tooltipWindow.webContents.send('set-tooltip-content', data);
      // Position above the bar, centered on element
      const x = Math.round(elemCenterX - tipWidth / 2);
      const y = Math.round(screenY - tipHeight - 8);
      tooltipWindow.setBounds({ x, y, width: tipWidth, height: tipHeight });
      tooltipWindow.showInactive();
    });
  } else {
    tooltipWindow.webContents.send('set-tooltip-content', data);
    const x = Math.round(elemCenterX - tipWidth / 2);
    const y = Math.round(screenY - tipHeight - 8);
    tooltipWindow.setBounds({ x, y, width: tipWidth, height: tipHeight });
    if (!tooltipWindow.isVisible()) {
      tooltipWindow.showInactive();
    }
  }
});

ipcMain.on('mini-bar-tooltip-hide', () => {
  if (tooltipWindow && !tooltipWindow.isDestroyed()) {
    tooltipWindow.hide();
  }
});

ipcMain.on('switch-to-mini-bar', () => {
  switchToMiniBarMode();
});

// 排他制御: 2つ目のインスタンスが起動されたら既存ウィンドウをフォーカス
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (store.get('miniBarMode')) {
      if (miniBarWindow && !miniBarWindow.isDestroyed()) {
        miniBarWindow.show();
      }
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // App lifecycle
  app.whenReady().then(() => {
    ensureAudioDeviceCmdlets(); // バックグラウンドで実行（ブロックしない）
    createWindow();
    createTray();
    registerHotkey();

    if (store.get('miniBarMode')) {
      mainWindow.hide();
      createMiniBar();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}
