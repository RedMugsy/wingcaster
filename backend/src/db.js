/**
 * Public DAL barrel.
 *
 * Re-exports the Postgres-only, async-only persistence facade. Business code may
 * continue importing from this file; the actual implementation lives in
 * `backend/src/persistence/`.
 */

export {
  configure,
  loadDb,
  closeDb,
  getDb,
  findAll,
  findOne,
  insert,
  update,
  remove,
  query,
  transaction,
} from './persistence/index.js'
