/**
 * Runtime allowlist of columns Postgres computes itself (GENERATED
 * ALWAYS AS ... STORED).
 *
 * These MUST be stripped from INSERT/UPDATE column lists — supplying
 * any value (including NULL) triggers Postgres error 428C9:
 *   "cannot insert a non-DEFAULT value into column X"
 *
 * The generic Postgres adapter consults this map before generating SQL.
 * Add entries here whenever a migration introduces a new generated
 * column; the mapper is not sufficient defense on its own because
 * downstream mapper edits routinely re-add columns without checking.
 *
 * Schema key is `<schema>.<table>` for schema-qualified lookups.
 */
export const GENERATED_COLUMNS_BY_TABLE = {
  'public.properties': ['geom'],
}

export function generatedColumnsFor(schema, table) {
  return GENERATED_COLUMNS_BY_TABLE[`${schema}.${table}`] || []
}
