-- Nuvora enrichment compatibility migration.
-- This migration only adds missing optional product fields. It does not drop
-- products, reviews, profiles, saved products, carts, or customer data.
alter table public.products add column if not exists why_we_picked_it text;
alter table public.products add column if not exists best_for text;
alter table public.products add column if not exists skip_if text;
alter table public.products add column if not exists source_sku text;
alter table public.products add column if not exists amazon_current_price numeric;
alter table public.products add column if not exists amazon_list_price numeric;
alter table public.products add column if not exists amazon_discount_percent numeric;
alter table public.products add column if not exists amazon_deal_text text;
alter table public.products add column if not exists amazon_rating numeric;
alter table public.products add column if not exists amazon_review_count integer;
alter table public.products add column if not exists amazon_bought_past_month text;
alter table public.products add column if not exists amazon_badges jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists amazon_shipping_text text;
alter table public.products add column if not exists amazon_tax_text text;
alter table public.products add column if not exists amazon_variations jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists source_related_products jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists source_image_urls jsonb not null default '[]'::jsonb;
notify pgrst, 'reload schema';
