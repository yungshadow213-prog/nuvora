-- Nuvora Skin product enrichment fields
-- Safe to run on an existing Nuvora Supabase products table.
alter table public.products add column if not exists ingredients text;
alter table public.products add column if not exists usage_instructions text;
alter table public.products add column if not exists product_warnings text;
alter table public.products add column if not exists product_size text;

comment on column public.products.ingredients is 'Ingredient information explicitly provided by the product source; not AI-invented.';
comment on column public.products.usage_instructions is 'Product directions explicitly provided by the source/manufacturer.';
comment on column public.products.product_warnings is 'Warnings or cautions explicitly provided by the source/manufacturer.';
comment on column public.products.product_size is 'Product size or format explicitly provided by the source.';
