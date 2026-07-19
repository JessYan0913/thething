import { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain } from 'electron';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let serverPort: number | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function isDev(): boolean {
  return !app.isPackaged;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getAgentDir(): string {
  if (isDev()) {
    return path.join(__dirname, '..', 'vendor', 'agent');
  }
  return path.join(process.resourcesPath, 'agent');
}

function getAppDir(): string {
  return path.resolve(__dirname, '..', '..', '..', 'packages', 'app');
}

function getRootDir(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

function getDataDir(): string {
  return app.getPath('userData');
}

function getLogFile(): string {
  return path.join(getDataDir(), 'server.log');
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function logToFile(message: string): void {
  try {
    fs.appendFileSync(getLogFile(), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// IPC Handlers
// ---------------------------------------------------------------------------

function setupIpcHandlers(): void {
  ipcMain.handle('dialog:showOpenDialog', async (_event, options) => {
    if (!mainWindow) {
      return { canceled: true, filePaths: [] };
    }
    return dialog.showOpenDialog(mainWindow, options);
  });
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'The Thing',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const loadingPath = path.join(__dirname, '..', 'loading', 'index.html');

  win.loadFile(loadingPath);
  win.once('ready-to-show', () => win.show());

  // 窗口关闭时隐藏到托盘而不是退出
  win.on('close', (event) => {
    // 如果应用正在退出，则正常关闭
    if (isQuitting) {
      return;
    }
    
    // 否则隐藏窗口
    event.preventDefault();
    win.hide();
  });

  return win;
}

// ---------------------------------------------------------------------------
// Tray (System Tray)
// ---------------------------------------------------------------------------

function createTrayIcon(): Electron.NativeImage {
  // 使用应用 logo 作为托盘图标
  const iconPath = path.join(__dirname, '..', 'icons', '128x128.png');
  
  if (!fs.existsSync(iconPath)) {
    console.error('[desktop] Tray icon not found:', iconPath);
    return nativeImage.createEmpty();
  }
  
  const icon = nativeImage.createFromPath(iconPath);
  const resized = icon.resize({ width: 22, height: 22 });
  
  // macOS: 设置为模板图像，系统自动适配深色/浅色模式
  if (process.platform === 'darwin') {
    resized.setTemplateImage(true);
  }
  
  return resized;
}

function createTray(): void {
  console.log('[desktop] Creating tray...');
  
  const trayIcon = createTrayIcon();
  console.log('[desktop] Tray icon created, size:', trayIcon.getSize());
  
  tray = new Tray(trayIcon);
  console.log('[desktop] Tray created successfully');
  
  // 设置托盘工具提示
  tray.setToolTip('The Thing - 运行中');
  
  // 显示通知，确认托盘创建成功
  if (process.platform === 'darwin') {
    // macOS使用通知中心
    console.log('[desktop] Tray icon should now be visible in menu bar');
  } else {
    // Windows使用气球通知
    tray.displayBalloon({
      title: 'The Thing',
      content: '应用已最小化到系统托盘',
    });
  }
  
  // 创建上下文菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        console.log('[desktop] Tray menu: Show main window');
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        console.log('[desktop] Tray menu: Quit');
        // 退出前清理
        killServer();
        app.quit();
      },
    },
  ]);
  
  // 设置上下文菜单
  tray.setContextMenu(contextMenu);
  
  // 点击托盘图标时显示/隐藏主窗口
  tray.on('click', () => {
    console.log('[desktop] Tray clicked');
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
        console.log('[desktop] Window hidden');
      } else {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        console.log('[desktop] Window shown');
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Network utilities
// ---------------------------------------------------------------------------

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to get port')));
      }
    });
    server.on('error', reject);
  });
}

function waitForServer(url: string, timeout = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryConnect = () => {
      http.get(url, (res) => {
        res.resume();
        resolve();
      }).on('error', () => {
        if (Date.now() - start > timeout) {
          reject(new Error(`Server at ${url} did not respond within ${timeout / 1000}s`));
          return;
        }
        setTimeout(tryConnect, 500);
      });
    };
    tryConnect();
  });
}

// ---------------------------------------------------------------------------
// Server process — spawn next dev (dev) or standalone server (prod)
// ---------------------------------------------------------------------------

function startDevServer(): Promise<number> {
  return new Promise(async (resolve, reject) => {
    try {
      const port = await findFreePort();
      const rootDir = getRootDir();
      const appDir = getAppDir();
      const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        PORT: String(port),
        HOSTNAME: '127.0.0.1',
      };

      console.log(`[desktop] Starting dev server on port ${port}...`);

      serverProcess = spawn(pnpmCmd, [
        '--dir', appDir,
        'exec', 'next', 'dev',
        '-H', '127.0.0.1',
        '-p', String(port),
      ], {
        cwd: rootDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      serverProcess.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) console.log('[next]', line);
        }
      });

      serverProcess.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString().trimEnd();
        if (msg) console.error('[next]', msg);
      });

      serverProcess.on('error', (err) => {
        console.error('[desktop] Dev server failed:', err);
        reject(err);
      });

      serverProcess.on('exit', (code) => {
        console.log('[next] Exited with code:', code);
        serverProcess = null;
      });

      // Wait for server to be ready
      await waitForServer(`http://127.0.0.1:${port}`);
      resolve(port);
    } catch (err) {
      reject(err);
    }
  });
}

function startProductionServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const agentDir = getAgentDir();
    const scriptPath = path.join(agentDir, 'start-standalone.js');

    const homeDir = os.homedir();
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      NODE_ENV: 'production',
      HOME: homeDir,
      USERPROFILE: homeDir,
      ELECTRON_RUN_AS_NODE: '1',
    };

    serverProcess = spawn(process.execPath, [scriptPath, '-p', '0'], {
      cwd: agentDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let resolved = false;

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          console.log('[server]', line);
          logToFile(`[stdout] ${line}`);
        }
        const match = line.match(/^THETHING_PORT=(\d+)/);
        if (match && !resolved) {
          resolved = true;
          resolve(parseInt(match[1], 10));
        }
      }
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trimEnd();
      console.error('[server]', msg);
      logToFile(`[stderr] ${msg}`);
    });

    serverProcess.on('error', (err) => {
      console.error('[server] Failed to start:', err);
      logToFile(`[error] ${err}`);
      if (!resolved) { resolved = true; reject(err); }
    });

    serverProcess.on('exit', (code) => {
      console.log('[server] Exited with code:', code);
      logToFile(`[exit] code=${code}`);
      serverProcess = null;
      if (!resolved) { resolved = true; reject(new Error(`Server exited with code ${code}`)); }
    });

    setTimeout(() => {
      if (!resolved) { resolved = true; reject(new Error('Server startup timed out (30s)')); }
    }, 30000);
  });
}

function startServer(): Promise<number> {
  if (isDev()) return startDevServer();
  return startProductionServer();
}

function killServer(): void {
  if (serverProcess) {
    const pid = serverProcess.pid;
    if (pid) {
      try {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          process.kill(-pid, 'SIGTERM');
        }
      } catch {
        serverProcess.kill();
      }
    } else {
      serverProcess.kill();
    }
    serverProcess = null;
  }
}

// ---------------------------------------------------------------------------
// Error display
// ---------------------------------------------------------------------------

function showError(message: string): void {
  mainWindow?.webContents.executeJavaScript(
    `document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:#111827;"><h2>Failed to start</h2><pre style="margin-top:12px;color:#dc2626;">${message.replace(/</g, '&lt;')}</pre></div>'`
  );
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  setupIpcHandlers();
  mainWindow = createWindow();
  createTray();

  try {
    serverPort = await startServer();
    console.log(`[desktop] Server ready on port ${serverPort}`);
    mainWindow!.loadURL(`http://127.0.0.1:${serverPort}`);
  } catch (err) {
    console.error('[desktop] Failed to start:', err);
    showError(String(err));
  }
});

app.on('window-all-closed', () => {
  // 在macOS上，关闭所有窗口不应该退出应用，而是隐藏到托盘
  // 在其他平台上，也隐藏到托盘而不是退出
  // 注意：服务器进程继续在后台运行
  console.log('[desktop] All windows closed, app stays in tray');
});

app.on('before-quit', () => {
  isQuitting = true;
  killServer();
});

app.on('activate', () => {
  // 在macOS上，点击Dock图标时重新显示窗口
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
    if (serverPort) {
      mainWindow!.loadURL(`http://127.0.0.1:${serverPort}`);
    }
  }
});
