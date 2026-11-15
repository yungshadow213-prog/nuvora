-- Nuvora Autopilot phase one: private, store-scoped AI approval queue.
-- Catalogue changes are performed only by the authenticated Cloudflare Worker.
-- Browser roles cannot access this table directly.

create table if not exists public.nuvora_ai_operations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid,
  store_key text not null check (store_key in ('skin','clothing','games','home')),
  action_type text not null check (action_type in ('fill_store_description')),
  product_id uuid not null references public.products(id) on delete cascade,
  title text not null,
  rationale text not null default '',
  proposed_patch jsonb not null default '{}'::jsonb,
  before_state jsonb not null default '{}'::jsonb,
  model text,
  status text not null default 'pending'
    check (status in ('pending','applied','rejected','rolled_back','failed','stale')),
  created_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  applied_at timestamptz,
  error text
);

create index if not exists nuvora_ai_operations_store_status_created_idx
  on public.nuvora_ai_operations (store_key, status, created_at desc);
create index if not exists nuvora_ai_operations_product_created_idx
  on public.nuvora_ai_operations (product_id, created_at desc);

alter table public.nuvora_ai_operations enable row level security;
revoke all on table public.nuvora_ai_operations from anon, authenticated;
grant select, insert, update, delete on table public.nuvora_ai_operations to service_role;

notify pgrst, 'reload schema';
