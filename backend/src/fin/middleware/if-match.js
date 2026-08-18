import express from 'express'
import { CATEGORY, FinError, finError } from '../errors.js'

export function parseIfMatch(header) {
  if (header == null || String(header).trim() === '') {
    const error = finError('PRECONDITION_REQUIRED', {
      category: CATEGORY.CONFLICT,
      httpStatus: 428,
    })
    throw error
  }
  const value = String(header).trim()
  if (value === '*') {
    throw finError('IF_MATCH_STAR_FORBIDDEN', {
      category: CATEGORY.CONFLICT,
      httpStatus: 412,
    })
  }
  if (/^W\//i.test(value)) {
    throw finError('IF_MATCH_WEAK_FORBIDDEN', {
      category: CATEGORY.CONFLICT,
      httpStatus: 412,
    })
  }
  const match = value.match(/^"(\d+)"$/)
  if (!match || Number(match[1]) < 1) {
    throw finError('IF_MATCH_MALFORMED', {
      category: CATEGORY.VALIDATION,
      httpStatus: 400,
    })
  }
  return Number(match[1])
}

export function requireIfMatch(req, res, next) {
  try {
    req.expectedVersion = parseIfMatch(req.get('If-Match'))
    next()
  } catch (error) {
    if (error instanceof FinError) {
      return res.status(error.httpStatus).json(error.toJSON())
    }
    next(error)
  }
}

export function sendPreconditionFailed(res, row) {
  res.set('ETag', `"${row.version}"`)
  return res.status(412).json({
    code: 'PRECONDITION_FAILED',
    category: CATEGORY.CONFLICT,
    retryable: true,
    current: row,
  })
}

export function setETag(res, version) {
  res.set('ETag', `"${version}"`)
}

/** Test-only demonstrator. Stage 4/10/12 own /api/admin/fin/**. */
export function createIfMatchDemoApp(pool) {
  const app = express()
  app.use(express.json())
  app.patch('/demo/fin/tenants/:id', requireIfMatch, async (req, res, next) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const locked = await client.query(
        `SELECT * FROM fin.tenants WHERE id = $1 FOR UPDATE`,
        [req.params.id],
      )
      if (!locked.rowCount) {
        await client.query('ROLLBACK')
        return res.status(404).json({ code: 'NOT_FOUND' })
      }
      const row = locked.rows[0]
      if (Number(row.version) !== req.expectedVersion) {
        await client.query('ROLLBACK')
        return sendPreconditionFailed(res, row)
      }
      const updated = await client.query(
        `UPDATE fin.tenants
            SET status = $3, updated_at = NOW()
          WHERE id = $1 AND version = $2
          RETURNING *`,
        [req.params.id, req.expectedVersion, req.body.status],
      )
      if (updated.rowCount === 0) {
        const current = await client.query(
          `SELECT * FROM fin.tenants WHERE id = $1`,
          [req.params.id],
        )
        await client.query('ROLLBACK')
        return sendPreconditionFailed(res, current.rows[0])
      }
      await client.query('COMMIT')
      setETag(res, updated.rows[0].version)
      return res.status(200).json(updated.rows[0])
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      next(error)
    } finally {
      client.release()
    }
  })
  return app
}
