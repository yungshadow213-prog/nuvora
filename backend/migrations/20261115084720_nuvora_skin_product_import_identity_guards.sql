create unique index if not exists nuvora_products_skin_amazon_asin_unique
  on public.products (amazon_asin)
  where storefront_key = 'skin' and amazon_asin is not null;

create unique index if not exists nuvora_products_skin_retailer_sku_unique
  on public.products (lower(retailer), source_sku)
  where storefront_key = 'skin' and retailer is not null and source_sku is not null;
