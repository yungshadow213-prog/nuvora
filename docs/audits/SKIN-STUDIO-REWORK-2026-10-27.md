# Skin Studio Admin and Skin Care Storefront Audit — 27 October 2026

## Status and scope

This work spans two open, unmerged pull requests:
- Admin and Worker: `yungshadow213-prog/nuvora`, [PR #161](https://github.com/yungshadow213-prog/nuvora/pull/161).
- Customer storefront: `yungshadow213-prog/client-store-platform`, [PR #29](https://github.com/yungshadow213-prog/client-store-platform/pull/29).

No PR was merged. The storefront's Cloudflare deployment steps were skipped. Automated build/bundle checks do not establish that authenticated editing, publication, or the production storefront has been tested end to end.

## Concrete defects found and addressed in review branches

1. **Section deletion and legacy sections**
   - The storefront preview previously normalized configuration in a way that could hide the legacy routine-finder section before its preview controls were rendered. The editor could therefore show a section in the preview but not offer a reliable way to remove it from the page outline.
   - The storefront preview now retains legacy sections for editor selection; the admin has explicit delete controls in the page outline and preview, including a fallback for legacy sections without stable IDs.
   - Must still verify in an authenticated browser that deleting a legacy section removes it from the draft, survives refresh/reopen, and remains removed after publish.

2. **Preview vs published storefront**
   - Preview intentionally uses the private draft and can show draft products/edits; the public storefront uses the published configuration and published catalog. Saving a draft alone must not change the public store.
   - The admin publish path sends the current configuration, reads it back, compares the result, and verifies that the private draft was cleared. This path still requires an authenticated end-to-end browser test and public-page read-back.
   - If the live storefront remains unchanged after Save Draft, that is expected. If it remains unchanged after a confirmed Publish, treat that as a defect and verify the published settings and storefront response; do not infer success from the preview alone.

3. **Product description fields were collapsed by the public API**
   - The Worker could replace the original product description with the editorial/store description when constructing public product data. This meant one field could hide the other.
   - The public API now passes the original product description and the editorial overview as separate fields, allowing the guide to display both when they differ.

4. **Additional product images could be dropped**
   - Public product normalization previously preferred `image_urls` whenever it existed, ignoring additional images in source/gallery/media fields.
   - The Worker now merges the primary image, `image_urls`, `source_image_urls`, additional/gallery/product images, and legacy media entries before deduplicating.
   - The storefront maps supported image sources and renders selectable thumbnails; its active image resets when the gallery changes and can recover after an image-load error.
   - Must still verify that every uploaded image is saved, returned by the public API, visible as a thumbnail, and selectable on a real product.

5. **Product guide presentation**
   - The storefront review branch now renders every populated product-information field without an arbitrary list slice and does not invent filler product facts when fields are empty.
   - The guide separates the overview from full description, displays populated benefits/features, skin concerns, ingredients, usage, warnings/precautions and size, and distinguishes explicitly curated pairings from general related-category suggestions.
   - Must still inspect representative products with long descriptions, multiline ingredients, several images, and curated recommendations in the real storefront.

## Other Skin Studio work in PR #161

- Wider preview canvas, collapsible page outline/inspector, canvas-focus mode and mobile side drawers.
- Undo/Redo controls and keyboard shortcuts; grouped history and pre-edit snapshots for common section/product changes.
- Product library pagination (10 per page), search and combined brand/category/publication/known-availability filters.
- Media library for existing Skin Studio storage images: browse, search, paginate, copy URLs, and apply existing media without deleting stored files.
- Account-scoped, tab-local unsaved-edit recovery, cleared only after verified save/publish of the current state.
- Publish preflight warnings for empty manual grids, draft products, stale product references and visible HTTP navigation/footer links.
- Preview iframe ready/load race and stale-timeout handling; product placement avoids hidden grids.
- Claude-backed research and generated-creative plan exists at `docs/plans/SKIN-STUDIO-AI-RESEARCH-AND-IMAGES.md`; provider integrations are not active.

## Automated verification

- Admin/Worker latest reviewed head: `281c2550570cce0f77de4ec72c55fea841e89c60`. GitHub Actions run #1606 completed with all 9 jobs successful: Worker syntax, admin/editor JS, storefront JS audit, release-contract audit, deep runtime audit, and Wrangler/Cloudflare dry-run bundle checks.
- Storefront latest reviewed head: `6ac0d40a8325a720fca115d69f72998b0fba6e30`. GitHub Actions run #163 passed the production build; the Cloudflare production-bundle validation passed. The deploy steps were skipped.
- No authenticated browser session was used to verify product CRUD, save/reopen, section deletion, image upload, draft-to-published parity, or public-page read-back.

## Remaining work before calling it finished

1. Use the authorized admin session to test section deletion (including the stubborn legacy section), save/reopen, section add/reorder, and preview reload.
2. Test a real product with long full descriptions, every information field, multiple uploaded images, and recommendations; verify admin save → public API response → storefront product guide.
3. Test image replacement through draft save, then explicit publish, and verify the actual public storefront uses the new image/configuration.
4. Confirm preview and live storefront use the same published layout after publishing, while preserving intentional draft/public separation.
5. Fix any failures found by those browser tests. Do not merge or deploy until explicitly approved.
6. Only then activate Claude/API integrations; the editor's save and publication workflow must be reliable first.
