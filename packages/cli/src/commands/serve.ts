import net from 'net'
import path from 'path'
import {
  initServerRuntime,
  configureStaticAssets,
  setupStaticAssets,
  startServer,
  disposeServerRuntime,
} from '@the-thing/server'

interface ServeOptions {
  port: number
  webDir?: string
}

function findFreePort(preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(preferred, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo
      server.close(() => resolve(addr.port))
    })
    server.on('error', () => {
      if (preferred === 0) return reject(new Error('Cannot find a free port'))
      const fallback = net.createServer()
      fallback.listen(0, '127.0.0.1', () => {
        const addr = fallback.address() as net.AddressInfo
        fallback.close(() => resolve(addr.port))
      })
      fallback.on('error', reject)
    })
  })
}

function resolveWebDir(webDir?: string): string | null {
  if (webDir) return path.resolve(webDir)

  // Portable mode: look for web/ relative to the executable
  const exeDir = path.dirname(process.execPath)
  const portableWebDir = path.join(exeDir, 'web')
  try {
    const fs = require('fs')
    if (fs.existsSync(path.join(portableWebDir, 'index.html'))) {
      return portableWebDir
    }
  } catch {}

  return null
}

export default async function serve(options: ServeOptions) {
  const port = await findFreePort(options.port)

  const webDir = resolveWebDir(options.webDir)
  if (webDir) {
    configureStaticAssets(webDir)
  }

  await initServerRuntime()

  if (webDir) {
    setupStaticAssets()
  }

  startServer(port)

  // Structured signals for Tauri sidecar protocol
  console.log(`THETHING_PORT=${port}`)
  console.log('THETHING_READY')

  if (webDir) {
    console.log(`[Serve] http://localhost:${port} (API + Web)`)
  } else {
    console.log(`[Serve] http://localhost:${port} (API only)`)
  }

  const shutdown = async () => {
    console.log('[Serve] Shutting down...')
    await disposeServerRuntime()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
