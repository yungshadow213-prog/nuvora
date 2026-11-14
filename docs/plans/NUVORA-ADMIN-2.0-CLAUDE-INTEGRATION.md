# Nuvora Admin 2.0 + Claude integration

Status: implementation branch / review required  
Branch: `redesign/nuvora-admin-2-0-claude-v2`

## Scope

This change refreshes the overall Nuvora Admin and the Skin Studio interface, then applies the shared visual system to the Home, Clothing and Games storefront studios. It is a presentation and integration layer, not a catalog reset or a data migration.

The current editor capabilities and application functions are retained. The branch adds one shared stylesheet and one shared Claude UI script, and extends the existing Worker with authenticated Claude endpoints.

## Interface work

- Reorganized the main admin into a stronger workspace shell with a dark forest navigation rail, clearer section grouping, responsive navigation, dashboard hierarchy, catalog cards and status surfaces.
- Reworked the Skin Studio shell into a persistent editor toolbar, dedicated left workspace/navigation and section outline, central storefront canvas, and contextual inspector.
- Preserved the existing device previews, zoom/full-screen controls, history controls, page selection, section operations, media library, products, categories/brands, global design settings, draft saving and publishing flows.
- Applied the shared visual system to the Home, Clothing and Games studios while keeping their individual storefront settings and catalog separation.

## Claude integration

Claude is added alongside the existing Gemini workflows:

1. **Admin assistant** — a contextual chat surface mounted in the main admin, Skin Studio, and the other storefront studio. It receives only a small snapshot of the visible workspace and the administrator's prompt.
2. **Skin Care product-guide preparation** — reads an exact Amazon URL through Nuvora's existing Amazon listing reader, then asks Claude to prepare source-conscious guide fields. It does not invent complementary-product IDs, and it does not save or publish.
3. **Catalog copy polishing** — prepares a revised title, description and feature list from the facts already entered in a product form. Available in the general product editor and the Home/Clothing/Games product form.

All Claude requests run in the Worker. The Anthropic key is never placed in browser code. Every route checks the existing Nuvora admin permission before sending a request to Anthropic and has request-size and rate limits. Gemini image generation, Gemini copy generation and Gemini skincare-guide preparation remain available.

## Cloudflare configuration required

The API integration is implemented but will report as not configured until the secret is added to the **nuvora** Worker:

- Add a Worker secret named `ANTHROPIC_API_KEY` containing the Anthropic API key.
- Optional non-secret variable: `ANTHROPIC_MODEL`. When omitted, the Worker defaults to `claude-sonnet-5-5`.
- Do not put the key in `wrangler.jsonc`, HTML, JavaScript, GitHub, the storefront, Supabase client settings, or a chat message.

After setting the secret, redeploy the Worker from the approved branch/release process and use **System status** to confirm that both the admin session and Claude connection report correctly. The branch itself has not been deployed.

## Preservation constraints

- No product, category, collection, media, customer or order rows are migrated or rewritten by this change.
- No Skin Care client-storefront repository is modified here.
- Gemini remains in place.
- The exact Skin Care retailer CTA remains `Check price on Amazon`.
- No Skin Care product-price field is introduced.
- Draft and published configuration remain separate; Claude does not auto-save, auto-publish, merge or deploy.

## Verification and remaining release gates

Static checks in GitHub Actions cover Worker and inline-script syntax, stylesheet/entrypoint wiring, admin authorization on Claude routes, current-model configuration and the continued presence of Gemini and the Skin Studio save/publish paths.

Still required after the secret is configured:
- Authenticated browser check of the admin dashboard, Skin Studio and all three other studios at desktop and mobile widths.
- Real Claude chat, copy-polish and Amazon-backed product-guide requests.
- Check failure messages for missing/invalid Anthropic credentials and provider errors.
- Confirm that prepared fields remain unsaved until the administrator saves the draft.
- Exercise existing editor operations: page changes, add/remove/reorder sections, media, product placement, draft save/reopen and explicit publish read-back.
- Confirm published storefront output and preview parity.

A passing syntax or dry-run workflow is not proof of authenticated runtime behavior or a production deployment. Do not merge or deploy until the remaining release gates are satisfied.
