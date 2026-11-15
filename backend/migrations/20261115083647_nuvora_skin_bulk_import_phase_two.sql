create table if not exists public.nuvora_product_import_batches (
  id uuid primary key default gen_random_uuid(),
  store_key text not null default 'skin' check (store_key = 'skin'),
  status text not null default 'processing'
    check (status in ('processing','completed','partial','failed')),
  source_count integer not null default 0 check (source_count between 0 and 30),
  ready_count integer not null default 0 check (ready_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  imported_count integer not null default 0 check (imported_count >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  summary jsonb not null default '{}'::jsonb
);

create table if not exists public.nuvora_product_import_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.nuvora_product_import_batches(id) on delete cascade,
  store_key text not null default 'skin' check (store_key = 'skin'),
  source_url text not null,
  resolved_url text,
  retailer text,
  source_identity text,
  status text not null default 'ready'
    check (status in ('ready','needs_review','duplicate','failed','importing','imported','skipped')),
  proposed_product jsonb not null default '{}'::jsonb,
  quality_flags jsonb not null default '[]'::jsonb,
  duplicate_product_id uuid references public.products(id) on delete set null,
  imported_product_id uuid references public.products(id) on delete set null,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  imported_at timestamptz,
  unique(batch_id, source_url)
);

create index if not exists nuvora_import_batches_store_created_idx
  on public.nuvora_product_import_batches (store_key, created_at desc);
create index if not exists nuvora_import_items_store_status_created_idx
  on public.nuvora_product_import_items (store_key, status, created_at desc);
create index if not exists nuvora_import_items_batch_idx
  on public.nuvora_product_import_items (batch_id, created_at);
create index if not exists nuvora_import_items_identity_idx
  on public.nuvora_product_import_items (store_key, retailer, source_identity);
create index if not exists nuvora_import_items_duplicate_product_idx
  on public.nuvora_product_import_items (duplicate_product_id);
create index if not exists nuvora_import_items_imported_product_idx
  on public.nuvora_product_import_items (imported_product_id);

alter table public.nuvora_product_import_batches enable row level security;
alter table public.nuvora_product_import_items enable row level security;
revoke all on table public.nuvora_product_import_batches from anon, authenticated;
revoke all on table public.nuvora_product_import_items from anon, authenticated;
grant select, insert, update, delete on table public.nuvora_product_import_batches to service_role;
grant select, insert, update, delete on table public.nuvora_product_import_items to service_role;

notify pgrst, 'reload schema';
