-- Compatibility migration for an existing Nuvora database.
-- Safe to run repeatedly. Adds product fields that newer Nuvora admin/import
-- workflows use without changing or deleting review/customer data.

alter table public.products add column if not exists why_we_picked_it text;
alter table public.products add column if not exists best_for text;
alter table public.products add column if not exists skip_if text;
alter table public.products add column if not exists last_checked_at timestamptz;
alter table public.products add column if not exists featured boolean not null default false;
alter table public.products add column if not exists trending boolean not null default false;
alter table public.products add column if not exists top_pick boolean not null default false;
alter table public.products add column if not exists provider text;
alter table public.products add column if not exists region text;
alter table public.products add column if not exists category_id uuid references public.categories(id);
alter table public.products add column if not exists collection_id uuid references public.collections(id);
alter table public.products add column if not exists shopify_product_id text;
alter table public.products add column if not exists shopify_variant_id text;
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
