-- Stage 9 follow-up — fix latent JCS boolean typo in Stage 1 migration 107.
-- Postgres jsonb_typeof() returns 'boolean' (not 'bool'). The Stage 1
-- function's 'bool' branch was dead; any audit payload containing a
-- JSON boolean RAISEd 'unknown jsonb type boolean'. Stage 9 periods
-- writeStatus was the first caller to hit it. DL-130.
-- CREATE OR REPLACE is idempotent; no schema change; existing rows unaffected.

CREATE OR REPLACE FUNCTION fin.json_canonical(j JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  k TEXT;
  parts TEXT[] := ARRAY[]::TEXT[];
  i INTEGER;
BEGIN
  IF j IS NULL OR jsonb_typeof(j) = 'null' THEN
    RETURN 'null';
  ELSIF jsonb_typeof(j) = 'boolean' THEN
    RETURN j::text;
  ELSIF jsonb_typeof(j) = 'number' THEN
    RETURN j::text;
  ELSIF jsonb_typeof(j) = 'string' THEN
    RETURN to_json(j #>> '{}')::text;
  ELSIF jsonb_typeof(j) = 'array' THEN
    IF jsonb_array_length(j) = 0 THEN
      RETURN '[]';
    END IF;
    FOR i IN 0 .. jsonb_array_length(j) - 1 LOOP
      parts := parts || fin.json_canonical(j -> i);
    END LOOP;
    RETURN '[' || array_to_string(parts, ',') || ']';
  ELSIF jsonb_typeof(j) = 'object' THEN
    FOR k IN SELECT key FROM jsonb_object_keys(j) AS key ORDER BY key
    LOOP
      parts := parts || (to_json(k)::text || ':' || fin.json_canonical(j -> k));
    END LOOP;
    RETURN '{' || array_to_string(parts, ',') || '}';
  END IF;
  RAISE EXCEPTION 'unknown jsonb type %', jsonb_typeof(j);
END;
$$;
