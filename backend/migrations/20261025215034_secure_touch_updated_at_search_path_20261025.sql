-- Pin the timestamp trigger helper to a trusted search path.
-- The guard keeps fresh installs safe if this optional helper is not present.
DO $$
BEGIN
  IF to_regprocedure('public.touch_updated_at()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.touch_updated_at() SET search_path = pg_catalog, public';
  END IF;
END
$$;
