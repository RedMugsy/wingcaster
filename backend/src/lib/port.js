import net from 'net'

const DEFAULT_PORT = 3001
const DEFAULT_PORT_SCAN_RANGE = 10

async function isPortAvailable(port) {
  return await new Promise((resolve) => {
    const server = net.createServer()

    server.once('error', () => {
      resolve(false)
    })

    server.once('listening', () => {
      server.close(() => resolve(true))
    })

    server.listen(port)
  })
}

export async function resolveServerPort(argv = process.argv, env = process.env, options = {}) {
  const args = Array.isArray(argv) ? argv : []
  const portFlagIndex = args.findIndex((arg) => arg === '--port')
  const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : DEFAULT_PORT_SCAN_RANGE
  const portChecker = typeof options.isPortAvailable === 'function' ? options.isPortAvailable : isPortAvailable

  let preferredPort = DEFAULT_PORT

  if (portFlagIndex !== -1) {
    const portValue = args[portFlagIndex + 1]
    if (portValue) {
      const parsedPort = Number.parseInt(portValue, 10)
      if (Number.isInteger(parsedPort) && parsedPort > 0) {
        preferredPort = parsedPort
      }
    }
  } else {
    const envPort = env.PORT
    if (envPort) {
      const parsedEnvPort = Number.parseInt(envPort, 10)
      if (Number.isInteger(parsedEnvPort) && parsedEnvPort > 0) {
        preferredPort = parsedEnvPort
      }
    }
  }

  for (let offset = 0; offset <= maxRetries; offset += 1) {
    const candidatePort = preferredPort + offset
    try {
      if (await portChecker(candidatePort)) {
        return candidatePort
      }
    } catch {
      // Continue scanning if the availability probe fails for an unexpected reason.
    }
  }

  return preferredPort
}
