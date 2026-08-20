-- Stage 8 — link holds ↔ facility_reservations (authorize hybrid shortfall).
-- hold_id on reservations was UUID-without-FK in 181 to avoid a cycle with holds.

ALTER TABLE fin.facility_reservations
  ADD CONSTRAINT facility_reservations_hold_id_fkey
  FOREIGN KEY (hold_id) REFERENCES fin.holds(id);

ALTER TABLE fin.holds
  ADD COLUMN facility_reservation_id UUID REFERENCES fin.facility_reservations(id);

COMMENT ON COLUMN fin.holds.facility_reservation_id IS
  'Stage 8 hybrid authorize: OPEN facility reservation covering the prepaid shortfall.';
