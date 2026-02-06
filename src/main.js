const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, nativeTheme } = require('electron');
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
    layout: 'vertical' // 'vertical' or 'horizontal'
  }
});

let mainWindow;
let tray;
let isQuitting = false;

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

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide',
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: store.get('alwaysOnTop'),
      click: (item) => {
        store.set('alwaysOnTop', item.checked);
        mainWindow.setAlwaysOnTop(item.checked);
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
  ]);

  tray.setToolTip('Audio Switcher');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // テーマ変更時にアイコンを更新
  nativeTheme.on('updated', () => {
    tray.setImage(createTrayIcon());
  });
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

function registerHotkey() {
  const hotkey = store.get('hotkey');
  
  globalShortcut.unregisterAll();
  
  try {
    globalShortcut.register(hotkey, () => {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (error) {
    console.error('Failed to register hotkey:', error);
  }
}

// IPC handlers
ipcMain.handle('get-audio-devices', async () => {
  return new Promise((resolve) => {
    // PowerShellスクリプトファイルを使わずにコマンドを直接実行
    const psCommand = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
      $ErrorActionPreference = 'Stop';
      try {
        Import-Module 'C:\\Program Files\\WindowsPowerShell\\Modules\\AudioDeviceCmdlets\\3.1.0.2\\AudioDeviceCmdlets.dll' -ErrorAction Stop;
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
          // JSONの部分だけを抽出（PowerShellの余計な出力を除去）
          const jsonMatch = stdout.match(/\{.*\}/s);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            resolve(result);
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
});

ipcMain.handle('set-audio-device', async (event, deviceId) => {
  return new Promise((resolve) => {
    const psCommand = `Import-Module 'C:\\Program Files\\WindowsPowerShell\\Modules\\AudioDeviceCmdlets\\3.1.0.2\\AudioDeviceCmdlets.dll' -ErrorAction Stop; Set-AudioDevice -ID '${deviceId}'; Write-Output 'OK'`;
    
    exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${psCommand}"`,
      { shell: true },
      (error, stdout) => {
        if (error) {
          resolve({ success: false, error: error.message });
          return;
        }
        resolve({ success: true });
      }
    );
  });
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
  mainWindow.setSize(width, height);
});

ipcMain.handle('get-layout', () => {
  return store.get('layout');
});

ipcMain.handle('set-layout', (event, layout) => {
  store.set('layout', layout);
  return true;
});

// 排他制御: 2つ目のインスタンスが起動されたら既存ウィンドウをフォーカス
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // App lifecycle
  app.whenReady().then(() => {
    createWindow();
    createTray();
    registerHotkey();
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
