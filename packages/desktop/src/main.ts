import { app, BrowserWindow } from 'electron';
import { fork, ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;

function isDev(): boolean {
  return !app.isPackaged;
}

function getStandaloneDir(): string {
  return path.join(process.resourcesPath, 'standalone');
}

function getDataDir(): string {
  return app.getPath('userData');
}

function getResourceRoot(): string {
  if (isDev()) {
    return path.resolve(__dirname, '..', '..', '..');
  }
  return path.dirname(app.getPath('exe'));
}

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

  const loadingPath = isDev()
    ? path.join(__dirname, '..', 'loading', 'index.html')
    : path.join(process.resourcesPath, 'loading', 'index.html');

  win.loadFile(loadingPath);
  win.once('ready-to-show', () => win.show());

  return win;
}

function startNextServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const standaloneDir = getStandaloneDir();
    const scriptPath = path.join(standaloneDir, 'start-standalone.js');
    const homeDir = os.homedir();

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      NODE_ENV: 'production',
      THETHING_DATA_DIR: getDataDir(),
      THETHING_RESOURCE_ROOT: getResourceRoot(),
      THETHING_HOME_DIR: homeDir,
      HOME: homeDir,
      USERPROFILE: homeDir,
    };

    serverProcess = fork(scriptPath, ['-p', '0'], {
      cwd: standaloneDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    let resolved = false;

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) console.log('[server]', line);
        const match = line.match(/^THETHING_PORT=(\d+)/);
        if (match && !resolved) {
          resolved = true;
          resolve(parseInt(match[1], 10));
        }
      }
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[server]', data.toString().trimEnd());
    });

    serverProcess.on('error', (err) => {
      console.error('[server] Failed to start:', err);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    serverProcess.on('exit', (code) => {
      console.log('[server] Exited with code:', code);
      serverProcess = null;
      if (!resolved) {
        resolved = true;
        reject(new Error(`Server exited with code ${code}`));
      }
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('Server startup timed out (30s)'));
      }
    }, 30000);
  });
}

function killServer(): void {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

app.whenReady().then(async () => {
  mainWindow = createWindow();

  if (isDev()) {
    mainWindow.loadURL('http://localhost:3000');
    return;
  }

  try {
    const port = await startNextServer();
    console.log(`[desktop] Next.js server ready on port ${port}`);
    mainWindow!.loadURL(`http://localhost:${port}`);
  } catch (err) {
    console.error('[desktop] Failed to start server:', err);
    mainWindow!.webContents.executeJavaScript(
      `document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:#111827;"><h2>Failed to start</h2><pre style="margin-top:12px;color:#dc2626;">${String(err)}</pre></div>'`
    );
  }
});

app.on('window-all-closed', () => {
  killServer();
  app.quit();
});

app.on('before-quit', () => {
  killServer();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
    if (isDev()) {
      mainWindow.loadURL('http://localhost:3000');
    }
  }
});
