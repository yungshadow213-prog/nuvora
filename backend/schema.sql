create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  is_admin boolean not null default false,
  role text,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists role text;

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(), name text not null unique, slug text not null unique, description text,
  created_at timestamptz not null default now()
);
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique, description text,
  published boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique,
  kind text not null check (kind in ('shop','find','learn')), description text, features text, brand text, image_url text, image_urls jsonb not null default '[]'::jsonb, availability text,
  display_price numeric, currency text default 'NGN', destination_url text, retailer text, provider text, region text,
  category_id uuid references public.categories(id), collection_id uuid references public.collections(id), why_we_picked_it text,
  featured boolean not null default false, trending boolean not null default false, top_pick boolean not null default false,
  published boolean not null default false, shopify_product_id text, shopify_variant_id text,
  amazon_asin text, amazon_source_url text,
  source_type text not null default 'manual',
  sourcinbox_product_url text,
  sourcinbox_product_id text,
  supplier_cost numeric,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), amazon_last_synced timestamptz
);

alter table public.products add column if not exists features text;
alter table public.products add column if not exists brand text;
alter table public.products add column if not exists image_urls jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists availability text;
alter table public.products add column if not exists source_sku text;
alter table public.products add column if not exists amazon_last_synced timestamptz;
alter table public.products add column if not exists source_type text not null default 'manual';
alter table public.products add column if not exists sourcinbox_product_url text;
alter table public.products add column if not exists sourcinbox_product_id text;
alter table public.products add column if not exists supplier_cost numeric;

-- Amazon merchandising fields captured by the best-effort product-page importer.
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

create table if not exists public.saved_products (
  user_id uuid references auth.users(id) on delete cascade, product_id uuid references public.products(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(user_id,product_id)
);
create table if not exists public.cart_items (
  user_id uuid references auth.users(id) on delete cascade, product_id uuid references public.products(id) on delete cascade,
  quantity integer not null default 1 check(quantity>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(user_id,product_id)
);

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.collections enable row level security;
alter table public.products enable row level security;
alter table public.saved_products enable row level security;
alter table public.cart_items enable row level security;

create policy "published products public" on public.products for select using (published=true);
create policy "published categories public" on public.categories for select using (true);
create policy "published collections public" on public.collections for select using (published=true);
create policy "own profile read" on public.profiles for select using (auth.uid()=id);
create policy "own profile update" on public.profiles for update using (auth.uid()=id) with check(auth.uid()=id);
create policy "own saved all" on public.saved_products for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy "own cart all" on public.cart_items for all using(auth.uid()=user_id) with check(auth.uid()=user_id);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.profiles(id,display_name) values(new.id,coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1))) on conflict(id) do nothing; return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- After creating your own account, promote that account once from the Supabase SQL editor:
-- update public.profiles set is_admin=true where id='YOUR-USER-UUID';


create table if not exists public.store_settings (
  id boolean primary key default true,
  store_name text not null default 'Nuvora',
  store_description text,
  support_email text,
  currency text not null default 'NGN',
  timezone text not null default 'Africa/Lagos',
  default_region text default 'NG',
  affiliate_disclosure text,
  shipping_policy text,
  returns_policy text,
  maintenance_mode boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint one_store_settings check (id = true)
);
insert into public.store_settings(id) values(true) on conflict(id) do nothing;
alter table public.store_settings enable row level security;
create policy "public store settings read" on public.store_settings for select using (true);

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  caption text not null,
  platform text not null check (platform in ('pinterest','instagram','facebook','tiktok','x')),
  product_id uuid references public.products(id) on delete set null,
  destination_url text,
  image_url text,
  status text not null default 'draft' check (status in ('draft','ready','published')),
  created_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.social_posts enable row level security;

-- Product image storage (admin uploads). The bucket is public so published product images can be served by the CDN.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public=true;

drop policy if exists "nuvora product images admin insert" on storage.objects;
create policy "nuvora product images admin insert" on storage.objects for insert to authenticated
with check (bucket_id='product-images' and exists (select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true));
drop policy if exists "nuvora product images admin update" on storage.objects;
create policy "nuvora product images admin update" on storage.objects for update to authenticated
using (bucket_id='product-images' and exists (select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true))
with check (bucket_id='product-images' and exists (select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true));
drop policy if exists "nuvora product images admin delete" on storage.objects;
create policy "nuvora product images admin delete" on storage.objects for delete to authenticated
using (bucket_id='product-images' and exists (select 1 from public.profiles p where p.id=auth.uid() and p.is_admin=true));


create table if not exists public.analytics_events (
  id bigint generated by default as identity primary key,
  event_name text not null,
  product_id uuid references public.products(id) on delete set null,
  session_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.analytics_events enable row level security;
drop policy if exists "public analytics event insert" on public.analytics_events;
create policy "public analytics event insert" on public.analytics_events for insert to anon, authenticated with check (char_length(event_name) between 1 and 80);

-- Refresh PostgREST's schema cache after applying this migration.
notify pgrst, 'reload schema';
