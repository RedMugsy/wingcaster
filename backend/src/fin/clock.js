/**
 * BusinessClock (A §1 / spec §68). Commands stamp this value; they never
 * DEFAULT CURRENT_TIMESTAMP on economic-effect columns. Tests inject `now`.
 */
export const BusinessClock = {
  now() {
    return new Date().toISOString()
  },
}
