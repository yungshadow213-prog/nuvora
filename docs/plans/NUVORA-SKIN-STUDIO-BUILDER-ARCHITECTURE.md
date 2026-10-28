# Nuvora Skin Care Studio — Shopify-Style Builder Architecture

Status: implementation blueprint for `rebuild/skin-studio-shopify-style-workspace`  
Scope: Nuvora Admin / Skin Studio in `yungshadow213-prog/nuvora`; the separate customer storefront remains `yungshadow213-prog/client-store-platform`.  
Release rule: no merge, deployment, or production data mutation without explicit authorization.

## Product definition

Build a professionally organized store-management platform with Shopify's information architecture and visual-editor interaction model, adapted to an affiliate skincare storefront. The editor must manage the real Nuvora Skin storefront configuration; it must not become a disconnected mockup tool.

## Information architecture

### Global admin navigation

Keep the main Nuvora Admin and the Skin Studio distinct. The studio is a full-page workspace, not a popup. Keep non-Skin-Care stores and the customer-facing storefront out of this change.

### Skin Studio workspace groups

1. **Storefront**
   - Theme editor: page selector, ordered section tree, reusable blocks, live preview, selected-element inspector.
   - Pages: create, rename, edit URL handle and description, choose page template, duplicate, draft/publish status.
2. **Catalog**
   - Products: search, pagination, status and metadata filters, create/edit, media, affiliate destination, product-guide fields.
   - Categories and brands: separate discovery dimensions; manual and rule-based collections when supported by the current data model.
3. **Content**
   - Media library: search, pagination, reusable existing uploads, alt text and image placement; replacing/removing a reference must not delete a stored file unless the user explicitly requests file deletion.
   - Editorial pages and journal content as the storefront's supported data model permits.
4. **Design & navigation**
   - Global palette and colour schemes, typography, layout, buttons, cards, responsive defaults, header, menus, announcement bar, footer, social links, SEO defaults and supported custom styling.
5. **Publishing and recovery**
   - Draft state, explicit publish, discard, save status, unsaved-change warning, undo/redo, recovery, history and release checks.

### Editor shell

- **Top bar:** store/page context, device preview, undo/redo, preview, save draft, discard and publish. Keep destructive and publish actions visually distinct.
- **Left panel:** grouped workspace navigation; within Theme editor, a page outline and searchable section/block library.
- **Canvas:** the actual storefront rendering, with desktop/tablet/mobile widths, zoom, refresh, full-screen, click-to-select and inline text editing where supported.
- **Inspector:** settings for the selected section/block/product; global settings live in a separate clearly labelled accordion/workspace. Never show unrelated settings together.
- **Responsive behavior:** retain access to the canvas and use usable drawers/stacked panels on narrow screens. Touch targets should be at least 44px where practical.

## Affiliate-first product rules

- No manual price, compare-at price, cost, tax, checkout, inventory quantity or payment controls in the Skin Care product editor unless the business model explicitly changes.
- Use the exact purchase prompt **Check price on Amazon** and preserve each product's saved retailer destination URL.
- Keep retailer/original ratings separate from Nuvora customer reviews.
- Product cards remain minimal; full product information belongs in product guides.
- Preserve complete provided product names and populated descriptions, benefits, ingredients, skin types, concerns, volume, routine step, usage, precautions and recommendations. Do not invent product facts or arbitrarily truncate content.
- Product catalogue membership and page placement are separate. Removing a product from a section must not delete the catalogue record; deleting a media reference must not silently delete the underlying upload.
- Draft products and page changes stay private. The public storefront reads published content only.
- Product identity must not rely on title alone; distinct ASINs or retailer URLs can represent distinct products.

## Feature roadmap and priorities

### P0 — Builder and affiliate-store launch foundation

**Editor**
- Live storefront preview; desktop/tablet/mobile controls, zoom, refresh and full-screen.
- Page selector for supported page types; clear page/template context.
- Section tree: add from a categorized/searchable library, reorder, duplicate, delete, hide/show, lock/unlock; support nested blocks where the section type permits.
- Blocks: add, reorder, duplicate and delete, with sensible per-section limits.
- Select an element in the preview and open the relevant inspector settings.
- Save draft, explicit publish, discard draft, visible unsaved state, save/error feedback and confirmation by reading persisted state back.
- Undo/redo and keyboard shortcuts; preserve edits during refresh/network interruption with a recoverable local snapshot.
- Link picker and rich-text editing for supported content fields.
- Clear page-level and global design-settings separation.

**Global design and shell**
- Palette tokens and section colour schemes; heading/body fonts and size/weight/line-height controls.
- Buttons, form controls, content width, gutters, section spacing, grid gaps, radii, borders and shadows.
- Logo, favicon and social-share image settings where supported.
- Header, navigation menu, announcement bar and footer settings.
- Product-card image ratio, layout and hover behavior without adding price fields.
- Section controls for background, overlay, content width, alignment, padding, gaps, borders, radius, shadows, device visibility and responsive layout.
- Keyboard focus, visible interactive states, reduced-motion behavior and meaningful image alt text.

**Page sections**
- Hero/banner with image, copy, up to two links, positioning, overlay, height and mobile image.
- Featured collection/product, product grid/carousel, category list.
- Rich text, image-with-text, columns, spacer, divider and newsletter.
- Universal section/block settings and responsive preview.

**Affiliate catalog and discovery**
- Product create/edit with title, full description, media, brand/vendor, product type, category, tags, status, ASIN/retailer identity and affiliate destination.
- Skincare custom fields: ingredients, skin types, concerns, volume, shelf life when supplied, routine step, usage, warnings and patch-test note.
- Image gallery with deduplicated sources and selectable thumbnails.
- Search, pagination, product status filters, category and brand organization.
- Manual product groups/collections with stable ordering; only implement automated rules for fields that are actually persisted and queryable.
- Product guide links and affiliate prompt follow the affiliate-first rules above.

**Storefront essentials**
- Header/search/navigation, collection/category grids, product-guide templates, About/Contact/FAQ/policy pages, search results and 404.
- Sorting, filters, pagination and mobile-friendly filter presentation where the public storefront supports the data.
- SEO title, meta description, URL handle, canonical/structured data and image alt text for supported page types.

### P1 — Quality and growth

- Version history with restore, theme duplication/rollback, scheduled publishing and expiring/password-protected preview links.
- Page templates per supported type and assignable product/collection templates.
- Media folders, bulk upload, crop/focal point, replace-file workflow, usage tracking, video and SVG where secure/renderable.
- Dynamic sources from product/category/page fields.
- Mega menus, predictive search enhancements, search history/popular terms, mobile bottom navigation.
- Announcement rotations/scheduling, countdown and page-specific visibility.
- Advanced collection rules, exclusions, nested collections and collection SEO.
- Product quick view, wishlist, reviews and moderation, complementary products, recently viewed, skincare routines/bundles, ingredient glossary, skin-type/concern discovery, quiz and before/after gallery using only permitted genuine images.
- Bulk product editing and CSV import/export, duplicate product, product templates, redirects, newsletter/customer email list and analytics based on real events.
- Accessibility contrast warnings, separate mobile typography/spacing controls, animations with reduced-motion support, social links and cookie banner.
- Staff roles, audit log, privacy tools and integration/API foundations only when the backend contract is ready.

### P2 — Advanced platform features

- Comments, simultaneous multi-user editing, role-based section permissions.
- AI copy/design assistance and generated blocks; keep AI/provider integrations paused until saving and publishing are reliable.
- Sandboxed custom code and theme code editor, theme import/export, marketplace, A/B testing.
- Advanced visual effects, per-market content, multi-store operations, workflow automation and headless storefront APIs.
- Optional cart/checkout/payment/order features only if Nuvora deliberately evolves beyond affiliate referrals. These are not part of the Skin Care affiliate builder MVP.

## Data ownership and boundaries

- Existing Supabase product records and IDs remain authoritative for catalogue data.
- Published `skin_site_config` is the public layout source; `skin_site_draft` is private editor state.
- The preview uses the current draft and may display draft product placements. The public storefront must not expose draft-only products or layout changes.
- Product details and media fields must be preserved by the admin/Worker API; no silent field collapsing.
- The existing `client-store-platform` repository owns the customer-facing Skin Care presentation. Admin changes should integrate through the documented configuration/API contract, not duplicate the storefront implementation.
- Do not invent database columns, assume a migration has been applied, or write to production while building. Any schema change needs a separately reviewed migration and compatibility plan.

## Required acceptance gates

1. **Organization:** each control has one clear workspace; no duplicate or unrelated settings scattered across panels; labels and interaction patterns remain consistent.
2. **Product integrity:** create/edit/save/reopen preserves the product ID, ASIN, affiliate URL, all populated guide fields, ratings and media references.
3. **Layout integrity:** add/delete/duplicate/reorder/hide/show/lock sections and edit blocks; changes survive draft save and reopen.
4. **Preview parity:** the iframe reflects the current draft, selected elements map to the correct inspector, and hidden sections cannot receive new visible placements accidentally.
5. **Publication safety:** draft saves never change the public site; publish is only reported successful after reading the published config back and confirming it matches.
6. **Media safety:** all saved gallery images return through the API and can be selected; replacing/removing an image reference does not delete the stored file.
7. **Responsive/accessibility:** desktop and mobile layouts remain usable; keyboard focus is visible, controls have labels, and no horizontal overflow is introduced.
8. **Automated verification:** syntax, release-contract, runtime and Cloudflare bundle/dry-run checks pass for the proposed branch.
9. **Browser verification:** authenticated admin workflow and public storefront read-back are completed before declaring the feature finished.
10. **Release control:** no merge or deployment without explicit authorization.

## Current build slice

This branch begins by making the editor's left-side workspace navigation explicit and grouped into Storefront, Catalog and Content, with Design & navigation clearly separated. It builds on the existing three-panel editor and existing save/publish implementation rather than replacing working product data or creating a parallel editor. The roadmap above is the acceptance map for subsequent implementation slices.


## Implementation log — 28 October 2026

### Completed in the current workspace slice

- Grouped Skin Studio navigation into **Storefront**, **Catalog**, **Content**, and a distinct **Design** workspace.
- Made Design & navigation a dedicated editor mode instead of leaving global settings mixed into the selected-element inspector.
- When Design is active, the section/content list and Add action are hidden; the shared settings controls occupy the inspector area, and the active workspace is marked accessibly.
- Returning to Theme editor or another workspace restores the normal selection inspector and closes the global-settings mode.
- Added a searchable section outline with a live matching count while preserving each section's original reorder, duplicate, lock, visibility and delete actions.
- Reorganized selected-section settings into clearly separated Content, Appearance, and Section behaviour groups, with dedicated primary/secondary button labels and links for hero/editorial sections and a direct lock-position control.
- Fixed the editor's Ctrl/Cmd+S shortcut so it saves the private draft even when focus is inside a form field; it prevents the browser's Save Page dialog and does not publish implicitly.
- Kept the current affiliate data model and the customer storefront repository unchanged.

### Still outstanding

This is an incremental UI-architecture slice, not completion of the full specification. Continue in priority order: validate the editor workspace in an authenticated browser; finish section/block authoring and template coverage; audit product/category/media workflows; verify draft persistence and publish read-back; then expand global design controls and storefront feature coverage. Automated and authenticated browser checks remain required before this PR can be considered release-ready.

### Implementation log — 28 October 2026 (publish-safety pass)

- Added a single in-flight publish guard so repeated clicks or duplicate invocation cannot start concurrent Skin Studio publish requests.
- Prevented manual draft-save requests and newly queued autosaves from racing with the publish operation. This matters because publishing clears the private draft; a late autosave could otherwise recreate stale draft data immediately after publication.
- Kept the existing publish read-back verification: the UI only reports success after fetching settings again and confirming the published configuration matches and the private draft is cleared.
- Re-fetched the updated branch and validated the complete inline JavaScript with a syntax compile check. This is a static check, not authenticated browser or live API verification.

### Implementation log — 28 October 2026 (preview edit history)

- Added undo-history snapshots before preview-driven removal of a product from a section, insertion of a text block, and adjustment of supported image focal-position coordinates.
- These actions already updated the draft and refreshed the preview; now they also participate in the editor's undo/redo model so accidental canvas changes can be reversed consistently.
- Re-fetched admin.html from the feature branch and compiled its complete inline JavaScript successfully with new Function. Targeted source assertions confirmed the history hooks and publish/draft concurrency guards are present.
- These are static source checks only. The authenticated preview bridge and API persistence still require browser-based acceptance testing.
