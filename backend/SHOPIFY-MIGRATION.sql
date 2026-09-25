-- Nuvora Shopify product sync migration
-- Run once in Supabase SQL Editor.
alter table public.products
  add column if not exists shopify_product_id text;

alter table public.products
  add column if not exists shopify_variant_id text;

create index if not exists products_shopify_product_id_idx
  on public.products(shopify_product_id);
