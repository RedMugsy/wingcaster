import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { findAgentForUser, findUserById } from './identity.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../../.env') })

function getJwtSecret() {
  const configuredSecret = process.env.JWT_SECRET
  if (configuredSecret) return configuredSecret

  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET environment variable is required in production')
    process.exit(1)
  }

  const fallbackSecret = 'dev-jwt-secret-change-me'
  console.warn('JWT_SECRET not set; using a development fallback secret')
  return fallbackSecret
}

const JWT_SECRET = getJwtSecret()

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch {
    return null
  }
}

export async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const token = authHeader.slice(7)
  const decoded = verifyToken(token)
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid token' })
  }

  let user
  let agent
  try {
    user = await findUserById(decoded.id)
    agent = user ? await findAgentForUser(user.id) : null
  } catch (err) {
    return next(err)
  }
  if (!user || !agent) {
    return res.status(401).json({ error: 'Account no longer exists' })
  }

  const tokenVersion = Number(decoded.token_version ?? 0)
  const userTokenVersion = Number(user.token_version ?? 0)
  if (tokenVersion !== userTokenVersion) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' })
  }

  req.user = {
    ...decoded,
    id: user.id,
    agent_id: agent.id,
    email: user.email,
    name: user.name,
    role: user.role || 'agent',
    platform_role: user.platform_role || null,
  }
  req.agent = agent
  next()
}
