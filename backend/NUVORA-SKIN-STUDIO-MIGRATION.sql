-- Nuvora Skin Studio: additive-only schema extension.
-- Safe to apply repeatedly. Does not drop or rewrite existing product/customer records.
alter table public.products
  add column if not exists benefits text,
  add column if not exists skin_types text,
  add column if not exists skin_concerns text,
  add column if not exists ingredients text,
  add column if not exists usage_instructions text,
  add column if not exists product_warnings text,
  add column if not exists product_size text,
  add column if not exists recommended_product_ids jsonb not null default '[]'::jsonb,
  add column if not exists recommendation_reason text;

alter table public.store_settings
  add column if not exists skin_site_config jsonb not null default '{
    "version": 1,
    "template": "soft-editorial",
    "accentColor": "#66745f",
    "productGuideTemplate": "editorial",
    "productGuideFields": {"benefits": true, "skinTypes": true, "concerns": true, "ingredients": true, "usage": true, "warnings": true, "recommendations": true},
    "announcement": "THOUGHTFUL FINDS FOR YOUR EVERYDAY ROUTINE · MADE SIMPLE",
    "heroEyebrow": "The everyday skin edit",
    "heroTitle": "Care that feels like you.",
    "heroDescription": "Skincare and beauty finds, thoughtfully collected for real routines. Explore useful essentials without the overwhelm.",
    "heroImage": "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?auto=format&fit=crop&w=1800&q=85",
    "heroButtonLabel": "Explore the edit",
    "approachEyebrow": "A gentler way to discover",
    "approachTitle": "Good finds. Clear choices.",
    "approachBody": "Nuvora Skin is a focused corner of Nuvora for skincare and beauty discoveries. We aim to make browsing simpler with clear product details and direct links to the retailer. Always check the retailer’s ingredient list, product directions, and suitability for your own skin before buying.",
    "footerNote": "Affiliate disclosure: Some links may be affiliate links. If you buy through them, Nuvora may earn a commission at no extra cost to you. Retailer prices, availability, ingredients, and product claims can change; confirm details on the retailer’s site.",
    "sections": [
      {"id":"hero","type":"hero","visible":true,"title":"Care that feels like you."},
      {"id":"edit","type":"product-grid","visible":true,"title":"What’s in the edit","filter":"all","columns":4},
      {"id":"approach","type":"editorial","visible":true,"title":"Good finds. Clear choices."}
    ]
  }'::jsonb;


-- Backfill new presentation settings into the existing singleton without replacing custom values.
update public.store_settings
set skin_site_config = skin_site_config || jsonb_build_object(
  'accentColor', coalesce(skin_site_config->>'accentColor', '#66745f'),
  'productGuideTemplate', coalesce(skin_site_config->>'productGuideTemplate', 'editorial'),
  'productGuideFields',
    '{"benefits":true,"skinTypes":true,"concerns":true,"ingredients":true,"usage":true,"warnings":true,"recommendations":true}'::jsonb
    || coalesce(skin_site_config->'productGuideFields', '{}'::jsonb)
)
where id = true;

alter table public.store_settings
  alter column skin_site_config set default '{
    "version": 1,
    "template": "soft-editorial",
    "accentColor": "#66745f",
    "productGuideTemplate": "editorial",
    "productGuideFields": {"benefits": true, "skinTypes": true, "concerns": true, "ingredients": true, "usage": true, "warnings": true, "recommendations": true},
    "announcement": "THOUGHTFUL FINDS FOR YOUR EVERYDAY ROUTINE · MADE SIMPLE",
    "heroEyebrow": "The everyday skin edit",
    "heroTitle": "Care that feels like you.",
    "heroDescription": "Skincare and beauty finds, thoughtfully collected for real routines. Explore useful essentials without the overwhelm.",
    "heroImage": "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?auto=format&fit=crop&w=1800&q=85",
    "heroButtonLabel": "Explore the edit",
    "approachEyebrow": "A gentler way to discover",
    "approachTitle": "Good finds. Clear choices.",
    "approachBody": "Nuvora Skin is a focused corner of Nuvora for skincare and beauty discoveries. We aim to make browsing simpler with clear product details and direct links to the retailer. Always check the retailer’s ingredient list, product directions, and suitability for your own skin before buying.",
    "footerNote": "Affiliate disclosure: Some links may be affiliate links. If you buy through them, Nuvora may earn a commission at no extra cost to you. Retailer prices, availability, ingredients, and product claims can change; confirm details on the retailer’s site.",
    "sections": [
      {"id":"hero","type":"hero","visible":true,"title":"Care that feels like you."},
      {"id":"edit","type":"product-grid","visible":true,"title":"What’s in the edit","filter":"all","columns":4},
      {"id":"approach","type":"editorial","visible":true,"title":"Good finds. Clear choices."}
    ]
  }'::jsonb;

notify pgrst, 'reload schema';
