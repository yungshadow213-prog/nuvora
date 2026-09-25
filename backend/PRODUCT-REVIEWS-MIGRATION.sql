-- Nuvora product reviews
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
create policy "public can read reviews" on public.product_reviews
  for select using (true);

drop policy if exists "users can create own reviews" on public.product_reviews;
create policy "users can create own reviews" on public.product_reviews
  for insert with check (auth.uid() = user_id);

drop policy if exists "users can update own reviews" on public.product_reviews;
create policy "users can update own reviews" on public.product_reviews
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users can delete own reviews" on public.product_reviews;
create policy "users can delete own reviews" on public.product_reviews
  for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';
