-- Nuvora schema repair: additive only.
-- Safe to run on an existing Supabase project. This does NOT remove or modify
-- customer accounts, product_reviews, saved_products, cart_items, or auth data.

alter table if exists public.products add column if not exists why_we_picked_it text;
alter table if exists public.products add column if not exists best_for text;
alter table if exists public.products add column if not exists skip_if text;
alter table if exists public.products add column if not exists last_checked_at timestamptz;
alter table if exists public.products add column if not exists featured boolean not null default false;
alter table if exists public.products add column if not exists trending boolean not null default false;
alter table if exists public.products add column if not exists top_pick boolean not null default false;
alter table if exists public.products add column if not exists updated_at timestamptz not null default now();
alter table if exists public.products add column if not exists source_sku text;
alter table if exists public.products add column if not exists amazon_current_price numeric;
alter table if exists public.products add column if not exists amazon_list_price numeric;
alter table if exists public.products add column if not exists amazon_discount_percent numeric;
alter table if exists public.products add column if not exists amazon_deal_text text;
alter table if exists public.products add column if not exists amazon_rating numeric;
alter table if exists public.products add column if not exists amazon_review_count integer;
alter table if exists public.products add column if not exists amazon_bought_past_month text;
alter table if exists public.products add column if not exists amazon_badges jsonb not null default '[]'::jsonb;
alter table if exists public.products add column if not exists amazon_shipping_text text;
alter table if exists public.products add column if not exists amazon_tax_text text;
alter table if exists public.products add column if not exists amazon_variations jsonb not null default '[]'::jsonb;
alter table if exists public.products add column if not exists source_related_products jsonb not null default '[]'::jsonb;
alter table if exists public.products add column if not exists source_image_urls jsonb not null default '[]'::jsonb;
alter table if exists public.products add column if not exists shopify_variants jsonb not null default '[]'::jsonb;

create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  title text,
  body text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, user_id)
);

alter table public.product_reviews enable row level security;
drop policy if exists "public can read reviews" on public.product_reviews;
create policy "public can read reviews" on public.product_reviews for select using (true);
drop policy if exists "users can create own reviews" on public.product_reviews;
create policy "users can create own reviews" on public.product_reviews for insert with check (auth.uid() = user_id);
drop policy if exists "users can update own reviews" on public.product_reviews;
create policy "users can update own reviews" on public.product_reviews for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "users can delete own reviews" on public.product_reviews;
create policy "users can delete own reviews" on public.product_reviews for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';
