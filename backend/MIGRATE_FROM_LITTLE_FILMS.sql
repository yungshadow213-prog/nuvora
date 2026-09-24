-- Nuvora migration for an existing Little Films Supabase project.
-- Run this once in Supabase SQL Editor, then promote your account with the final statement.

create extension if not exists pgcrypto;

-- Keep the existing Little Films profiles table compatible with Nuvora admin auth.
alter table if exists public.profiles add column if not exists is_admin boolean not null default false;
alter table if exists public.profiles add column if not exists role text;

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
  kind text not null default 'shop' check (kind in ('shop','find','learn')), description text, features text, brand text, image_url text, image_urls jsonb not null default '[]'::jsonb, availability text,
  display_price numeric, currency text default 'NGN', destination_url text, retailer text, provider text, region text,
  category_id uuid references public.categories(id), collection_id uuid references public.collections(id), why_we_picked_it text,
  featured boolean not null default false, trending boolean not null default false, top_pick boolean not null default false,
  published boolean not null default false, shopify_product_id text, shopify_variant_id text,
  amazon_asin text, amazon_source_url text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), amazon_last_synced timestamptz
);

alter table public.products add column if not exists features text;
alter table public.products add column if not exists brand text;
alter table public.products add column if not exists image_urls jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists availability text;
alter table public.products add column if not exists amazon_last_synced timestamptz;
create table if not exists public.saved_products (
  user_id uuid references auth.users(id) on delete cascade, product_id uuid references public.products(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(user_id,product_id)
);
create table if not exists public.cart_items (
  user_id uuid references auth.users(id) on delete cascade, product_id uuid references public.products(id) on delete cascade,
  quantity integer not null default 1 check(quantity>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(user_id,product_id)
);
create table if not exists public.store_settings (
  id boolean primary key default true, store_name text not null default 'Nuvora', store_description text, support_email text,
  currency text not null default 'NGN', timezone text not null default 'Africa/Lagos', default_region text default 'NG',
  affiliate_disclosure text, shipping_policy text, returns_policy text, maintenance_mode boolean not null default false,
  updated_at timestamptz not null default now(), constraint one_store_settings check(id=true)
);
insert into public.store_settings(id) values(true) on conflict(id) do nothing;
create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(), title text not null, caption text not null,
  platform text not null check(platform in ('pinterest','instagram','facebook','tiktok','x')),
  product_id uuid references public.products(id) on delete set null, destination_url text, image_url text,
  status text not null default 'draft' check(status in ('draft','ready','published')), created_by uuid references auth.users(id) on delete set null,
  published_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), amazon_last_synced timestamptz
);

alter table public.products add column if not exists features text;
alter table public.products add column if not exists brand text;
alter table public.products add column if not exists image_urls jsonb not null default '[]'::jsonb;
alter table public.products add column if not exists availability text;
alter table public.products add column if not exists amazon_last_synced timestamptz;

alter table public.categories enable row level security;
alter table public.collections enable row level security;
alter table public.products enable row level security;
alter table public.saved_products enable row level security;
alter table public.cart_items enable row level security;
alter table public.store_settings enable row level security;
alter table public.social_posts enable row level security;

-- Public storefront reads.
drop policy if exists "published products public" on public.products;
create policy "published products public" on public.products for select to anon, authenticated using (published=true);
drop policy if exists "published categories public" on public.categories;
create policy "published categories public" on public.categories for select to anon, authenticated using (true);
drop policy if exists "published collections public" on public.collections;
create policy "published collections public" on public.collections for select to anon, authenticated using (published=true);
drop policy if exists "public store settings read" on public.store_settings;
create policy "public store settings read" on public.store_settings for select to anon, authenticated using (true);

-- The Node backend uses the Supabase service-role key for admin writes, so these admin policies are optional for the browser.
-- Keep the service-role key server-side only.

-- IMPORTANT: replace this UUID with your own authenticated user's UUID.
-- update public.profiles set is_admin=true where id='YOUR-USER-UUID';

-- Nuvora product image storage. Run this section if you want Admin image uploads.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public=true;

drop policy if exists "nuvora product images admin insert" on storage.objects;
create policy "nuvora product images admin insert" on storage.objects for insert to authenticated
with check (bucket_id='product-images' and exists (select 1 from public.profiles p where p.id=auth.uid() and (p.is_admin=true or coalesce(p.role,'')='admin')));
drop policy if exists "nuvora product images admin update" on storage.objects;
create policy "nuvora product images admin update" on storage.objects for update to authenticated
using (bucket_id='product-images' and exists (select 1 from public.profiles p where p.id=auth.uid() and (p.is_admin=true or coalesce(p.role,'')='admin')))
with check (bucket_id='product-images' and exists (select 1 from public.profiles p where p.id=auth.uid() and (p.is_admin=true or coalesce(p.role,'')='admin')));
drop policy if exists "nuvora product images admin delete" on storage.objects;
create policy "nuvora product images admin delete" on storage.objects for delete to authenticated
using (bucket_id='product-images' and exists (select 1 from public.profiles p where p.id=auth.uid() and (p.is_admin=true or coalesce(p.role,'')='admin')));

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
