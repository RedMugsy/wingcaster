/**
 * H §5 — admin mutation limiter. 10 requests / 5 minutes keyed on
 * req.user.id with req.ip fallback. Attach to every /api/admin/fin/*
 * mutation alongside writeGuards.
 */
import rateLimit from 'express-rate-limit'

export const adminMutationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id || req.ip || 'anonymous'),
  validate: false,
  skip: () => Boolean(process.env.VITEST),
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests, please try again later.',
      code: 'RATE_LIMITED',
    })
  },
})
