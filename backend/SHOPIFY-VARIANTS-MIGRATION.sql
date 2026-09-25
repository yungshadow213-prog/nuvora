ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS shopify_variants jsonb NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrST, 'reload schema';