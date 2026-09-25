ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS shopify_variants jsonb NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';

ALTER TABLE public.cart_items
  ADD COLUMN IF NOT EXISTS variant_id text;

NOTIFY pgrst, 'reload schema';
