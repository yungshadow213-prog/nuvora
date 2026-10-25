-- Restore owner-scoped access for the signed-in account's saved products and cart.
-- These tables had RLS enabled without policies, which blocked the storefront's
-- authenticated sync/upsert/delete flows. Users can only access rows bearing their own auth.uid().
ALTER TABLE public.saved_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nuvora_saved_products_own_all" ON public.saved_products;
CREATE POLICY "nuvora_saved_products_own_all"
  ON public.saved_products
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "nuvora_cart_items_own_all" ON public.cart_items;
CREATE POLICY "nuvora_cart_items_own_all"
  ON public.cart_items
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
