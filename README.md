# Nuvora

Nuvora is a real storefront + private admin system backed by Supabase. The existing storefront design is preserved; this build focuses on working data, product management, cart behavior, security, import tooling, SEO, and analytics.

## Important: you do NOT need to re-enter keys every time

The launcher stores your local Nuvora configuration outside the project folder at:

`%APPDATA%\Nuvora\.env`

When you extract a fresh Nuvora ZIP, `START-NUVORA.bat` automatically restores that saved configuration into the new project folder. Your secret key is **not included in the ZIP**.

You only need to enter the Supabase service-role/secret key once on this Windows PC. Never paste that secret into ChatGPT, frontend code, GitHub, or a public file.

## What is included

- Supabase-backed published product catalog (no fake catalog data)
- Admin product workspace: manual product entry and Amazon API workflow when credentials are available
- Product image URLs + custom image uploads through Supabase Storage
- Multiple product images with preview/removal
- Storefront search, category/type filtering, and price/name sorting
- Guest cart persistence in localStorage
- Signed-in cart sync/merge with Supabase
- Shopify checkout handoff when Shopify is configured
- Truthful checkout-ready confirmation; Nuvora does not claim an order is paid until the retailer confirms it
- Bulk CSV import (up to 500 rows per batch), always imported as drafts
- Server-side product validation
- Basic per-IP API rate limiting
- Analytics event collection and an Admin analytics view
- SEO metadata and dynamic product title/description updates
- Existing Admin settings, social drafts, categories, collections, publish/unpublish, and sign-out

## Amazon is optional

Nuvora does not bypass Amazon Associates/Creators API requirements. If Amazon credentials are not configured, use manual entry, custom uploads, CSV import, or another authorized retailer integration. The Amazon importer becomes available after legitimate API access is configured.

## Supabase migration

If you already ran the previous Nuvora migration, run:

`backend/NUVORA-NEXT-MIGRATION.sql`

For a fresh database, run `backend/schema.sql` instead.

## Run

1. Extract the ZIP anywhere on your PC.
2. Run `START-NUVORA.bat`.
3. On the first run only, enter your Supabase service-role/secret key when prompted if it is not already saved on this PC.
4. Nuvora starts and opens automatically.
5. Future fresh ZIP extractions reuse `%APPDATA%\Nuvora\.env` automatically.
6. Do not open `admin.html` directly from the filesystem.

Use `OPEN-ENV.bat` if you later need to configure Shopify or legitimate Amazon credentials. Changes made to a populated local `.env` are retained in the normal project folder; keep that folder private.

If a secret was exposed previously, rotate it in Supabase and use the new secret locally.
