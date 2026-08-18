# Stage 0 — four-agent split

**Date:** 2026-08-18
**Claimed by:** Agent A (this session) after user confirmation ("you pick — claim A")
**Repo:** `E:\Projects\WingCaster-restore` @ `16beece`
**Rule:** one writer per file. Do not edit another agent's deliverable; open a Decision Log entry instead.

| Agent | Owns | File(s) | Do not touch |
|---|---|---|---|
| **A (this session)** | Entity model + living decision-log scaffold | `A_ENTITY_MODEL.md`, `DECISION_LOG.md` (scaffold), this split | B–H body text |
| **B** | State machines + transaction matrix | `B_STATE_MACHINES.md`, `C_TRANSACTION_MATRIX.md` | A, D–H |
| **C** | Concurrency + idempotency | `D_CONCURRENCY.md`, `E_IDEMPOTENCY.md` | A–C, F–H |
| **D** | Reconciliation + accounting boundary + security | `F_RECONCILIATION.md`, `G_ACCOUNTING_BOUNDARY.md`, `H_SECURITY.md` | A–E |

## Coordination contract

1. **Table names and PK types in `A_ENTITY_MODEL.md` are the vocabulary.** Agents B–D reference those names; they do not invent parallel tables. If a machine or command needs a column A omitted, add a Decision Log row and leave a `<!-- OPEN: … -->` marker in your file — do not silently rename.
2. **`commercial.*` is frozen for new feature writes.** Dual-write / backfill is Stage 13. Stage 0 docs may map legacy → `fin.*` but must not propose new `commercial.*` columns as the system of record.
3. **Live P0s stay on the risk register.** Do not silently remediating `events.js`, pricing `update()` signatures, or `audit_log` grants in this stage. Scope them to the rebuild stage that owns the replacement surface (see `PRE_REBUILD_AUDIT_2026-08-17.md` Stage 0 resolution).
4. **Append-only Decision Log.** Anyone may append a dated row. Do not rewrite another agent's rationale.
5. **Audit trail.** Each agent appends a `### Stage 0 / Agent X` subsection under the audit's Stage 0 resolution. Do not delete original findings.

## Why this pairing

- A is the dependency for every other deliverable (FKs, lock keys, idempotency subjects).
- B+C describe *what moves* and *in what order*.
- D+E describe *how two writers don't corrupt it*.
- F+G+H describe *how we prove it, book it, and who may touch it*.

## Exit

Stage 0 is not done until the user has reviewed all eight deliverables. No `backend/src/fin/**` implementation until then.
