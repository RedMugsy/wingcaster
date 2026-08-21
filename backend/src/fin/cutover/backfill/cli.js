/**
 * Stage 13b operator entry point. Not an HTTP route. Not called from tests.
 *
 *   node backend/src/fin/cutover/backfill/cli.js \
 *     --source commercial.usage_events --since 2024-01-01 --until 2024-02-01
 */
import { loadDb } from '../../../db.js'
import { runBackfill } from './orchestrator.js'

function parseArgs(argv) {
  const out = { source: null, since: null, until: null, environment: 'LIVE', batchSize: 500 }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]
    if (token === '--source') { out.source = next; i += 1 }
    else if (token === '--since') { out.since = next; i += 1 }
    else if (token === '--until') { out.until = next; i += 1 }
    else if (token === '--environment') { out.environment = next; i += 1 }
    else if (token === '--batch-size') { out.batchSize = Number(next) || 500; i += 1 }
  }
  return out
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (!args.source) {
    console.error('usage: --source commercial.usage_events|commercial.ledger_entries [--since ISO] [--until ISO]')
    process.exitCode = 1
    return { ok: false, reason: 'MISSING_SOURCE' }
  }
  await loadDb()
  const result = await runBackfill({
    environment: args.environment,
    source: args.source,
    sinceOverride: args.since,
    untilOverride: args.until,
    batchSize: args.batchSize,
  })
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
  return result
}

const invoked = process.argv[1]
  && String(process.argv[1]).replaceAll('\\', '/').includes('cutover/backfill/cli')
if (invoked) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
