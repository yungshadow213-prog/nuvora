# Nuvora Skin Care + Skin Studio Complete Redesign

Date: 27 October 2026

## Purpose

Make Nuvora Skin Care easier to browse and make Nuvora Admin / Skin Studio easier to understand and operate. This is an interface redesign, not a catalog migration or product reset.

## User and product constraints

- Preserve all existing product records and their IDs, ASINs, retailer/Amazon destination URLs, brand/category assignments, descriptions, benefits, ingredients, skin guidance, usage/cautions, recommendations, ratings, publication states, and media references.
- Keep the Skin Studio purchase prompt exactly `Check price on Amazon`; do not introduce a Skin Studio product-price field.
- Keep retailer ratings separate from customer reviews.
- Show the complete provided product name and populated product-guide fields; do not fabricate missing product facts or arbitrarily truncate product content.
- Keep product cards minimal and send shoppers to the product guide for the full information and retailer destination.
- Public shoppers see published content; private editor drafts remain separate until publication is explicitly requested and verified.
- Do not merge or deploy these changes without explicit authorization.

## Baseline inspection

A live production browser inspection on 27 October 2026 covered desktop and a 390px mobile viewport. The homepage structure, category browsing, product cards and editorial content were visible and no horizontal overflow was reported. The audit found footer links and the “Content studio” link were too small, the footer tagline looked clipped, and product-guide “Save for later” / “Copy product link” controls had borderline tap targets. The redesign adds clearer footer typography, wrapping for the tagline, a larger Content studio target, and 44px minimum product-guide action targets. The deployed site cannot demonstrate these changes until release is authorized.

The live browser pass inspected the currently deployed baseline, not the unmerged redesign branch. The redesigned branch still needs its own browser verification and an authenticated editor workflow pass.

## Storefront redesign

- Establish a cohesive sage/forest-green and warm-neutral theme with consistent typography, borders, spacing, buttons, hover/focus states and page backgrounds.
- Refresh the homepage hero and category tiles, product cards, shop/search filters, result sorting and pagination.
- Present mobile category filters as a bottom sheet instead of squeezing a desktop sidebar into a narrow viewport.
- Improve product-guide hierarchy for description/overview, gallery, brand/type/category, retailer rating, availability when known, every populated guide field, retailer action, and related-product context.
- Keep the full product name visible rather than clamping it to an arbitrary line count.
- Refine brands, saved picks, journal index/articles, empty states and footer.
- Product cards and product guides try the existing product image sources in sequence when an image fails. Other remote-image areas have graceful fallback states; no substitute product facts or fake pack shots are generated.
- Keep the “Check price on Amazon” wording intact, with the exact retailer URL retained in the existing product record.

## Admin and Skin Studio redesign

- Use a calmer light/sage/forest palette and consistent readable typography.
- Group navigation into Workspace, Your storefronts, Catalog, Growth and System.
- Refresh dashboard cards, catalog actions, product library rows, health summaries, forms and settings surfaces.
- Bring product-edit and AI modals into the same visual design system rather than leaving dark, unrelated modal styling.
- Preserve the full-page Skin Studio layout. On desktop it uses the outline/library, storefront preview, and selected-item inspector; on narrower screens it switches to usable stacked panels.
- Improve save/publish status, panel scrolling, focus indicators, button states and mobile toolbar wrapping.

## Research sources

- Baymard Institute, “Product Page UX: 10 Pitfalls and Best Practices” (updated 18 March 2026): https://baymard.com/research-articles/current-state-ecommerce-product-page-ux
- Nielsen Norman Group, “UX Guidelines for Ecommerce Product Pages”: https://www.nngroup.com/articles/ecommerce-product-pages/
- W3C, Web Content Accessibility Guidelines (WCAG) 2.2: https://www.w3.org/TR/WCAG22/

The design applies their general recommendations for legible product information and images, reliable product browsing, visible interactive states and keyboard focus. This is not a claim of formal WCAG conformance.

## Verification and acceptance checklist

### Automated
- [x] Latest storefront redesign-contract checks and production build passed on head `e124347ffa7384cd8d076757f271f424d0012c01` (GitHub Actions run #179).
- [x] All 9 Admin checks passed on current head `d9b01c45e4bf1a1b1f8d6fe50a44a42676d10b85` (GitHub Actions run #1633), including editor JavaScript, release-contract, runtime, Wrangler dry-run and bundle checks.
- [x] Reviewed changed paths: Admin `admin.html`, CI workflow and audit doc; storefront `src/app.jsx`, `src/styles.css`, the CI workflow and `scripts/verify-redesign-contracts.mjs`. No catalog/data/database files or product records were changed in the redesign branches.
- [x] Added and passed automated storefront redesign contracts covering full product names, the populated product-guide fields, exact Amazon prompt, gallery fallbacks, the mobile filter dialog's keyboard/focus states, and the theme's core responsive/accessibility rules (run #177).

### Storefront desktop and mobile
- [ ] Verify redesigned header, mobile menu and search overlay open/close without clipping (production baseline had no horizontal overflow at 390px, but the redesign branch itself is not deployed).
- [ ] Shop category filter sheet opens/closes, selected filters and counts are accurate, search resets page, and pagination remains reachable.
- [ ] Product cards show image, full product name, brand, retailer rating and availability only when reliable.
- [ ] Product detail displays every populated text field without arbitrary truncation; gallery thumbnails change the main image; a failed image tries remaining existing sources before showing the fallback.
- [ ] Exact “Check price on Amazon” prompt and the original product-specific Amazon destination remain intact.
- [ ] Brands, journal pages, saved picks, no-results states and footer remain readable at mobile widths.
- [ ] Public homepage no longer renders the legacy routine-finder section once the coordinating storefront feature is released.

### Admin / Skin Studio
- [ ] Navigation groups work at desktop and mobile widths; focus is visible.
- [ ] Product editor, AI editor and other modals are visually consistent and scroll correctly.
- [ ] Authenticated browser tests verify product create/edit/save/publish without mutating or losing existing records.
- [ ] Skin Studio Save Draft, refresh/reopen recovery and Publish work; publish must be verified by reading the published config back.
- [ ] Add, delete, reorder, hide/show, image replace/remove, product placement/removal, upload and preview parity work end-to-end.

## Release state

This document records the intended acceptance bar, not completion of all tests. The redesign pull requests remain draft and unmerged. No production deployment or product-data write is included.
