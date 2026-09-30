-- SourcinBox product-source support
alter table public.products add column if not exists source_type text not null default 'manual';
alter table public.products add column if not exists sourcinbox_product_url text;
alter table public.products add column if not exists sourcinbox_product_id text;
alter table public.products add column if not exists supplier_cost numeric;

create index if not exists products_source_type_idx on public.products(source_type);
create index if not exists products_sourcinbox_product_id_idx on public.products(sourcinbox_product_id);
