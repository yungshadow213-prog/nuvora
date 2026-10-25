-- Add the optional product type used by Skin Studio's reviewed product taxonomy.
-- Safe for existing installations and repeatable during schema synchronization.
alter table public.products
  add column if not exists product_type text;
