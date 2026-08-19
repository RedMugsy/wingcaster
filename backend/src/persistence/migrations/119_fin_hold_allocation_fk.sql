-- Stage 6 — defer lot_allocations.hold_id so AuthorizeHold can insert
-- the draw allocation before the hold row, then COMMIT both (DL-085).
-- Additive: same FK, DEFERRABLE INITIALLY DEFERRED. No new columns.
-- GRANT INSERT/UPDATE on limit_counters: C §5.2 cache bump (A §5.6).
-- Stage 1 only granted SELECT (no writer yet).

ALTER TABLE fin.lot_allocations
  DROP CONSTRAINT lot_allocations_hold_id_fkey;

ALTER TABLE fin.lot_allocations
  ADD CONSTRAINT lot_allocations_hold_id_fkey
    FOREIGN KEY (hold_id) REFERENCES fin.holds(id)
    DEFERRABLE INITIALLY DEFERRED;

GRANT SELECT, INSERT, UPDATE ON fin.limit_counters TO fin_app_role;
