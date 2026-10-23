-- Nuvora Skin Studio: persist private site-builder drafts separately from the live layout.
-- Additive and safe to apply repeatedly; existing published settings and product/customer rows are untouched.
alter table public.store_settings
  add column if not exists skin_site_draft jsonb;

-- Refresh the PostgREST schema cache so the authenticated admin API can read/write the new column.
notify pgrst, 'reload schema';
