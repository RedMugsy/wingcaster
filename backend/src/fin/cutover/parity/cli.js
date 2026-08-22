/**
 * Stage 13c operator entry point. Not an HTTP route.
 *
 *   node backend/src/fin/cutover/parity/cli.js --tick hourly
 *   node backend/src/fin/cutover/parity/cli.js --tick daily
 *   node backend/src/fin/cutover/parity/cli.js --attest --burn-in-days 30
 */
import { loadDb } from '../../../db.js'
import { BusinessClock } from '../../clock.js'
import { BURN_IN_DAYS_DEFAULT, computeAttestation, signAttestation } from './attestation.js'
import { runDailyRollup, runHourlyTick } from './orchestrator.js'

function parseArgs(argv) {
  const out = {
    tick: null,
    attest: false,
    environment: 'LIVE',
    burnInDays: BURN_IN_DAYS_DEFAULT,
    day: null,
    batchSize: 1000,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]
    if (token === '--tick') { out.tick = next; i += 1 }
    else if (token === '--attest') { out.attest = true }
    else if (token === '--environment') { out.environment = next; i += 1 }
    else if (token === '--burn-in-days') { out.burnInDays = Number(next) || BURN_IN_DAYS_DEFAULT; i += 1 }
    else if (token === '--day') { out.day = next; i += 1 }
    else if (token === '--batch-size') { out.batchSize = Number(next) || 1000; i += 1 }
  }
  return out
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (!args.tick && !args.attest) {
    console.error('usage: --tick hourly|daily | --attest [--burn-in-days 30]')
    process.exitCode = 1
    return { ok: false, reason: 'MISSING_ACTION' }
  }
  await loadDb()
  const now = BusinessClock.now()
  if (args.tick === 'hourly') {
    const result = await runHourlyTick({
      environment: args.environment, now, batchSize: args.batchSize,
    })
    console.log(JSON.stringify(result, null, 2))
    return result
  }
  if (args.tick === 'daily') {
    const result = await runDailyRollup({
      environment: args.environment, day: args.day, now, batchSize: args.batchSize,
    })
    console.log(JSON.stringify(result, null, 2))
    return result
  }
  if (args.attest) {
    const computed = await computeAttestation(null, {
      environment: args.environment,
      burnInDays: args.burnInDays,
      now,
    })
    if (!computed.eligible) {
      console.log(JSON.stringify({ ok: false, reason: 'ATTESTATION_NOT_ELIGIBLE', ...computed }, null, 2))
      process.exitCode = 1
      return { ok: false, reason: 'ATTESTATION_NOT_ELIGIBLE', ...computed }
    }
    const signed = await signAttestation({
      environment: args.environment,
      burnInDays: args.burnInDays,
      actor: { actorType: 'USER', actorEmail: process.env.FIN_ATTEST_EMAIL || 'operator@fin.local' },
      now,
    })
    console.log(JSON.stringify(signed, null, 2))
    return signed
  }
  console.error('usage: --tick hourly|daily | --attest [--burn-in-days 30]')
  process.exitCode = 1
  return { ok: false, reason: 'UNKNOWN_ACTION' }
}

const invoked = process.argv[1]
  && String(process.argv[1]).replaceAll('\\', '/').includes('cutover/parity/cli')
if (invoked) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
