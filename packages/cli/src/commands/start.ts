// ============================================================
// Start Command - Start the HTTP server and open browser
// ============================================================

import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import net from 'net'
import { getDataDirConfig, ensureDataDirSubdirs } from '../lib/data-dir'
import { writeServerLock, isServerRunning, deleteServerLock } from '../lib/server-manager'
import { startServer, configureStaticAssets, setupStaticAssets } from '@the-thing/server'
import { configureDatabase, initPermissions, initConnectorGateway } from '@the-thing/core'

// 环境变量: THETHING_CONNECTORS_DIR
// 允许用户自定义 connectors 配置目录
const DEFAULT_CONNECTORS_DIR = process.env.THETHING_CONNECTORS_DIR

export interface StartOptions {
  port?: string
  noOpen?: boolean
  dataDir?: string
}

/**
 * Check if a port is available
 */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false)
      } else {
        // Other errors (permission denied, etc.) - treat as unavailable
        resolve(false)
      }
    })
    server.once('listening', () => {
      server.close()
      resolve(true)
    })
    server.listen(port)
  })
}

/**
 * Find an available port starting from the given port
 * @param startPort - Starting port number
 * @param maxAttempts - Maximum number of ports to try
 * @returns The first available port
 */
async function findAvailablePort(startPort: number, maxAttempts: number = 10): Promise<number> {
  const triedPorts: number[] = []
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    triedPorts.push(port)
    if (await isPortAvailable(port)) {
      return port
    }
  }
  throw new Error(`No available port found in range ${triedPorts.join(', ')}. Try a different --port option.`)
}

/**
 * Find the web static assets directory
 * Priority:
 * 1. packages/web/dist (monorepo development)
 * 2. dist/web (npm package - same directory as CLI code)
 * 3. web/ adjacent to executable (portable mode - SEA)
 * 4. web/ in current directory (portable mode - cwd)
 */
function findWebAssetsDir(): string | null {
  // Try monorepo path (packages/web/dist)
  const monorepoPath = path.resolve(__dirname, '../../../web/dist')
  if (fs.existsSync(monorepoPath) && fs.existsSync(path.join(monorepoPath, 'index.html'))) {
    return monorepoPath
  }

  // Try npm package path (dist/web - same directory as bundled CLI)
  // When installed via npm, __dirname is node_modules/@the-thing/cli/dist
  const npmPackagePath = path.resolve(__dirname, 'web')
  if (fs.existsSync(npmPackagePath) && fs.existsSync(path.join(npmPackagePath, 'index.html'))) {
    return npmPackagePath
  }

  // Try SEA portable mode (web/ adjacent to executable)
  // In SEA mode, process.execPath points to the executable
  const execDir = path.dirname(process.execPath)
  const seaPortablePath = path.join(execDir, 'web')
  if (fs.existsSync(seaPortablePath) && fs.existsSync(path.join(seaPortablePath, 'index.html'))) {
    return seaPortablePath
  }

  // Try cwd portable mode (web/ in current directory)
  const cwdPortablePath = path.resolve(process.cwd(), 'web')
  if (fs.existsSync(cwdPortablePath) && fs.existsSync(path.join(cwdPortablePath, 'index.html'))) {
    return cwdPortablePath
  }

  return null
}

export default async function start(options: StartOptions): Promise<void> {
  const startPort = parseInt(options.port || '3456', 10)
  const dataDirPath = options.dataDir

  // Get data directory config
  const dataDirConfig = getDataDirConfig(dataDirPath)
  ensureDataDirSubdirs(dataDirConfig)

  // Check if server is already running
  if (isServerRunning(dataDirConfig.lockPath)) {
    console.log(chalk.yellow('Server is already running.'))
    console.log(chalk.gray(`  Use 'thething status' to see details.`))
    console.log(chalk.gray(`  Use 'thething stop' to stop it.`))
    return
  }

  // Find available port
  let port: number
  try {
    port = await findAvailablePort(startPort)
    if (port !== startPort) {
      console.log(chalk.yellow(`Port ${startPort} is in use, using port ${port} instead.`))
    }
  } catch (error) {
    console.error(chalk.red(`Failed to find available port starting from ${startPort}.`))
    console.log(chalk.gray(`  Try specifying a different port with --port option.`))
    return
  }

  // Configure database
  console.log(chalk.blue('Initializing database...'))
  configureDatabase({ dataDir: dataDirConfig.dataDir })

  // Initialize permissions and connector gateway
  await initPermissions().catch(err => console.error(chalk.red('[Permissions] Init failed:', err)))

  // Determine connectors directory:
  // 1. THETHING_CONNECTORS_DIR environment variable (highest priority)
  // 2. connectors/ in current working directory (if exists)
  // 3. connectors/ in data directory (fallback)
  const cwdConnectorsDir = path.join(process.cwd(), 'connectors')
  const dataConnectorsDir = path.join(dataDirConfig.dataDir, 'connectors')

  let connectorsDir: string
  if (DEFAULT_CONNECTORS_DIR) {
    connectorsDir = DEFAULT_CONNECTORS_DIR
  } else if (fs.existsSync(cwdConnectorsDir)) {
    connectorsDir = cwdConnectorsDir
  } else {
    connectorsDir = dataConnectorsDir
  }

  console.log(chalk.blue('Initializing connector gateway...'))
  console.log(chalk.gray(`  Connectors directory: ${connectorsDir}`))
  await initConnectorGateway({ enableInbound: true, configDir: connectorsDir }).catch(err => console.error(chalk.red('[ConnectorGateway] Init failed:', err)))

  // Find and configure static assets
  const webAssetsDir = findWebAssetsDir()
  if (webAssetsDir) {
    configureStaticAssets(webAssetsDir)
    setupStaticAssets()
    console.log(chalk.green(`Static assets configured from: ${webAssetsDir}`))
  } else {
    console.log(chalk.yellow('No web static assets found.'))
    console.log(chalk.gray(`  Run 'pnpm build:web' to build the frontend.`))
    console.log(chalk.gray(`  The server will only expose API endpoints.`))
  }

  // Write lock file
  writeServerLock(dataDirConfig.lockPath, {
    port,
    pid: process.pid,
    startedAt: Date.now(),
    dataDir: dataDirConfig.dataDir,
  })

  // Start server
  console.log(chalk.green(`Starting server on port ${port}...`))

  startServer(port)

  console.log(chalk.green(`Server running at http://localhost:${port}`))
  if (webAssetsDir) {
    console.log(chalk.gray(`  Web UI: http://localhost:${port}`))
  }
  console.log(chalk.gray(`  API: http://localhost:${port}/api/*`))
  console.log(chalk.gray(`  Health: http://localhost:${port}/health`))
  console.log(chalk.gray(`  Data directory: ${dataDirConfig.dataDir}`))

  // Open browser (unless --no-open)
  if (!options.noOpen && webAssetsDir) {
    console.log(chalk.blue('Opening browser...'))
    try {
      // Dynamic import for ESM compatibility
      const openModule = await import('open')
      await openModule.default(`http://localhost:${port}`)
    } catch {
      console.log(chalk.yellow('Could not open browser. Please open manually:'))
      console.log(chalk.gray(`  http://localhost:${port}`))
    }
  } else if (!options.noOpen && !webAssetsDir) {
    console.log(chalk.yellow('Cannot open browser - no web UI available.'))
    console.log(chalk.gray(`  Run 'pnpm build:web' to build the frontend.`))
  }

  console.log(chalk.gray('Press Ctrl+C to stop the server.'))

  // Keep process running
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\nStopping server...'))
    deleteServerLock(dataDirConfig.lockPath)
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    console.log(chalk.yellow('\nStopping server...'))
    deleteServerLock(dataDirConfig.lockPath)
    process.exit(0)
  })
}