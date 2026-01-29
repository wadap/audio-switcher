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
    enabledDevices: null // null = all devices enabled, array = specific device IDs
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
  
  mainWindow = new BrowserWindow({
    width: 280,
    height: 400,
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
  // システムテーマに応じたアイコンを生成
  // ダークモード（タスクバーが暗い）→ 白いアイコン
  // ライトモード（タスクバーが明るい）→ 黒いアイコン
  const isDark = nativeTheme.shouldUseDarkColors;
  const iconColor = isDark ? '#ffffff' : '#000000';

  const size = 16;
  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 5 L5 5 L8 2 L8 14 L5 11 L3 11 Z" fill="${iconColor}"/>
      <path d="M10 4.5 Q12.5 8 10 11.5" stroke="${iconColor}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M12 2.5 Q16 8 12 13.5" stroke="${iconColor}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    </svg>
  `;

  return nativeImage.createFromBuffer(Buffer.from(svg), { width: size, height: size });
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

ipcMain.on('resize-window', (event, height) => {
  const [width] = mainWindow.getSize();
  mainWindow.setSize(width, height);
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
