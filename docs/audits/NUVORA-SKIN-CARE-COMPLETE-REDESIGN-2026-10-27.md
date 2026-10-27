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

A live production browser inspection on 27 October 2026 covered the public storefront at desktop width. The homepage had a clear header and hero, product cards, category browsing, editorial content and a footer. Issues observed included very small footer links and a very small “Content studio” link. Production was still showing the retired routine-finder section at the time of inspection; the existing unmerged storefront feature PR contains the public-render exclusion for that legacy section. The deployed site cannot demonstrate this redesign until changes are authorized for release.

A complete mobile-browser pass and authenticated editor workflow pass have not yet been completed.

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
- [x] Latest Skin Care production build passed on redesign commit `5fb8cf7f4221169c6e8b6eb67118c4bcf178bc50` (GitHub Actions run #171).
- [x] Latest Admin PR check passed all 9 jobs after the navigation, modal, contrast and regression-guard updates (GitHub Actions PR run #1623 on `bac7f49627e3d53fc2dd90ea29d5c7bcabf1bb53`).
- [x] Reviewed changed paths: Admin `admin.html`, CI workflow and audit doc; storefront `src/app.jsx` and `src/styles.css`. No catalog/data/database files or product records were changed in the redesign branches.

### Storefront desktop and mobile
- [ ] Header, mobile menu and search overlay open/close without being clipped.
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
