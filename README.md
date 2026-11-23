# Nuvora

Nuvora is a multi-storefront platform with a shared admin system, separate storefront experiences and Supabase-backed catalogue data.

## Nuvora Women's Fashion

The former Skin Care Studio has been repurposed as **Nuvora Women's Fashion**. The customer-facing store and its editor are now organised around women's clothing, footwear, bags, jewellery and accessories.

The fashion catalogue starts empty. The original skincare catalogue contained no published or draft products, so there was nothing to remove. Other Nuvora catalogues and their records were left intact.

### Fashion categories

- **Clothing:** dresses, tops and blouses, shirts, trousers and jeans, skirts, co-ords, jumpsuits, knitwear, jackets and coats.
- **Shoes:** heels, flats, sneakers, boots and sandals.
- **Bags:** handbags, totes, crossbody and shoulder bags, clutches and evening bags.
- **Jewellery:** jewellery and watches.
- **Accessories:** sunglasses, belts, scarves and hair accessories.
- **More to wear:** activewear, loungewear, sleepwear and occasionwear.

### Product guides and editor

Fashion product records use the existing catalogue fields for product identity, category, retailer, destination URL, materials, available sizes, fit notes, style tags, occasions, care instructions, product images and curated outfit pairings.

The Women's Fashion Studio retains the visual storefront builder, draft/publish workflow, category editor, product image library, product list, analytics and page sections. The full-page editor remains available through the existing admin route `/admin/skin-studio`; its visible title and category system are now Women's Fashion.

The product guide is designed to show product information before sending the customer to the retailer. It does not show an internal product price. The retailer CTA uses the product's exact saved destination URL, when available. Nuvora may earn a commission from qualifying purchases through affiliate links.

### Product sourcing and AI

The editor supports manual product entry, image uploads, CSV drafts and retailer-link research where the retailer page can be read by the configured source importer. Amazon is optional; the fashion catalogue is not restricted to Amazon UK. Retailer links, names and product details should be reviewed before saving or publishing.

Nuvora's text AI uses the Cloudflare Workers AI binding named `AI`. The optional Worker variable `NUVORA_AI_MODEL` selects the model; the code has a default model. No Claude or Anthropic API key is required for the fashion product assistant.

AI-generated descriptions and classifications are proposals, not verified retailer claims. The editor should leave unsupported material composition, fabric percentages, sizes, measurements, fit claims and care instructions blank. Review product facts before saving or publishing.

## Storefront and admin architecture

- Admin repository: `yungshadow213-prog/nuvora`
- Customer storefront repository: `yungshadow213-prog/client-store-platform`
- Supabase-backed published product catalogues
- Draft and publish states for products and storefront layouts
- Retailer links and affiliate handoff
- Product image URLs and custom uploads through Supabase Storage
- Bulk CSV import, with imported records kept as drafts pending review
- Store analytics and activity events
- SEO metadata and dynamic product title/description updates
- Separate store experiences managed through the shared admin

The customer storefront is maintained in the separate client repository. Admin editor changes should not be used as a reason to modify that client repository beyond the explicit Nuvora storefront conversion.

## Supabase

For a fresh database, run `backend/schema.sql`. For a database already on the previous Nuvora schema, review and run the applicable additive migration, including `backend/NUVORA-NEXT-MIGRATION.sql`.

The Women's Fashion Studio reuses the existing store configuration and product fields to avoid a destructive schema replacement. Legacy internal field names and the existing Studio route remain in place for compatibility; the visible editor and customer-facing labels are fashion-oriented.

Published storefront configuration is read from the existing public settings endpoint. Draft layout settings remain private until an administrator publishes them. Do not put the Supabase service-role key in frontend code, GitHub files or chat.

## Amazon is optional

Nuvora does not bypass Amazon Associates/Creators API requirements. If legitimate Amazon API access is not configured, use manual entry, custom image uploads, CSV import or another retailer source supported by the importer. Use only valid affiliate links and comply with each retailer's programme terms.

## Run locally

1. Extract the repository.
2. Run `START-NUVORA.bat`.
3. On the first run only, enter the Supabase service-role/secret key when prompted if it is not already saved on this PC.
4. Nuvora starts and opens automatically.
5. Do not open `admin.html` directly from the filesystem.

The launcher stores local configuration outside the project folder at `%APPDATA%\\Nuvora\\.env`. Keep that file private. Use `OPEN-ENV.bat` for local service configuration; never commit secrets.

## Experience Studio

The Experience Studio is available in Nuvora Admin at `/admin/experiences`. Its customer-facing modules have been adapted for fashion discovery: product comparison, Style Finder, Fashion Finder, Outfit Planner, Materials Guide, similar finds, outfit pairings, recently viewed, fashion search, style details, saved preferences, Fashion Assistant and saved outfit edits.

The Experience Studio continues to use the existing store configuration namespace internally so that the migration preserves the current admin/API and customer data architecture.
