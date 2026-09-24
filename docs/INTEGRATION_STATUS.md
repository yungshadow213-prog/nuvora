[Uploading INTEGRATION_STATUS.md…]()
# Nuvora integration status

## Working in this build

- Supabase product catalog and admin authentication
- Product drafts, editing, publish/unpublish, delete
- Manual product entry
- Amazon importer when valid Amazon Creators API credentials are configured
- Product image URL gallery
- Custom product image upload to Supabase Storage
- Storefront search, category/type filtering, sorting
- Guest cart persistence
- Signed-in cart sync/merge
- Shopify checkout handoff when Shopify credentials + variants are configured
- Checkout-ready confirmation without falsely claiming payment/order completion
- CSV product import as drafts
- Server-side validation
- Basic in-memory per-IP API rate limiting
- Analytics events: page_view, search, filter_used, product_view, add_to_cart, retailer_click, checkout_started
- Admin analytics event counts
- SEO title/description/Open Graph metadata
- Existing settings, categories, collections, social drafts, and admin sign-out

## Requires user-side setup

1. Run `backend/NUVORA-NEXT-MIGRATION.sql` in Supabase if the earlier Nuvora migration is already installed.
2. For a fresh project, run `backend/schema.sql`.
3. Ensure the admin user's `profiles.is_admin` is true.
4. Amazon importer requires legitimate Amazon Creators API access and credentials.
5. Shopify checkout requires Storefront API credentials and products linked to Shopify variant IDs.

## Not implemented / intentionally not faked

- Amazon scraping to bypass Associates/Creators API access
- Fabricated order/payment confirmation
- Fake analytics numbers
- Automatic social-platform publishing without the platform credentials/API permissions
