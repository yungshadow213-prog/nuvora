-- Explicit catalogue ownership for records in the shared Nuvora products table.
-- Existing catalogue rows remain in the main store. Skin products are assigned only
-- when they are created or deliberately moved from the Skin Studio.
alter table public.products
  add column if not exists storefront_key text not null default 'main';

alter table public.products
  alter column storefront_key set default 'main';

update public.products
set storefront_key = 'main'
where storefront_key is null;

alter table public.products
  alter column storefront_key set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_storefront_key_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_storefront_key_check
      check (storefront_key in ('main', 'skin'));
  end if;
end $$;

create index if not exists products_storefront_key_created_at_idx
  on public.products (storefront_key, created_at desc);
