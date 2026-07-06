import { app, BrowserWindow } from 'electron';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let serverPort: number | null = null;

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

function getBundledNodePath(): string | null {
  const exe = process.platform === 'win32' ? 'node.exe' : 'node';
  const bundledNode = path.join(process.resourcesPath, 'node', exe);
  return fs.existsSync(bundledNode) ? bundledNode : null;
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

  return win;
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

    const bundledNode = getBundledNodePath();
    const nodeExe = bundledNode || process.execPath;
    const useElectronAsNode = !bundledNode;

    const homeDir = os.homedir();
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      NODE_ENV: 'production',
      HOME: homeDir,
      USERPROFILE: homeDir,
      ...(useElectronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    };

    serverProcess = spawn(nodeExe, [scriptPath, '-p', '0'], {
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
  mainWindow = createWindow();

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
  killServer();
  app.quit();
});

app.on('before-quit', () => {
  killServer();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
    if (serverPort) {
      mainWindow!.loadURL(`http://127.0.0.1:${serverPort}`);
    }
  }
});
