-- Persist the full Skin Studio guide and cross-product recommendation fields.
-- Idempotent for existing installations; existing product rows and values are preserved.
alter table public.products
  add column if not exists benefits text,
  add column if not exists skin_types text,
  add column if not exists skin_concerns text,
  add column if not exists recommended_product_ids jsonb not null default '[]'::jsonb,
  add column if not exists recommendation_reason text;
