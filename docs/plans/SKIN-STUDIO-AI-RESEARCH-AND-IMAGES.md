# Nuvora Skin Care AI Product Research & Image Workflow Plan

**Status:** Planned; not yet integrated. This plan is part of the Skin Studio admin rework, but the AI provider integration must not be activated until the core editor, draft persistence, and authenticated product workflows are stable and approved.

## 1. Product research workflow

1. An admin starts from a product name plus at least one identifier: product URL, ASIN, manufacturer URL, or retailer URL.
2. A server-side research job gathers pages from permitted sources. Prefer manufacturer/product-owner pages, then retailer pages and other reputable sources. Use official APIs, licensed data, or pages whose access terms permit retrieval. Do not bypass CAPTCHAs, login gates, anti-bot controls, robots restrictions, or retailer access controls; Amazon pages may not be reliably or permissibly scrapeable.
3. Claude receives the accessible source text and URLs and returns a typed JSON object matching the Skin Care product-guide schema.
4. Every extracted claim carries evidence: source URL, short supporting excerpt or locator, retrieval time, and confidence/status. Store the source record separately from the shopper-facing copy.
5. A deterministic validation layer checks required fields, URL safety, length limits, schema shape, duplicates, and conflicts between sources. Unsupported fields stay blank or are explicitly marked “not found”; never fill them with guesses.
6. The admin sees a review screen with source links, evidence, conflicts, missing facts, and proposed changes highlighted against existing product data.
7. Only an explicit admin action saves the result as a product draft. Research must never silently overwrite an existing product or publish a product.
8. Save the job outcome and a reviewable audit record, including partial failures, so a failed source does not discard valid results from other sources.

## 2. Skin Care schema and factual boundaries

The extraction schema should cover:
- Product name, brand, exact product/retailer identifier, product type/category, manufacturer URL, retailer URL, and image source URLs.
- Full product description and manufacturer-stated benefits.
- Ingredients as supplied by a source, without inferred ingredient lists.
- Manufacturer-stated skin types, concerns, usage directions, warnings, and precautions.
- Retailer rating and review count as separate retailer-origin fields, with source and observation date. Never combine these with Nuvora customer reviews.
- Complementary products only when supported by a credible source or explicitly labelled as editorial recommendations with a clear rationale; do not claim a manufacturer endorsement without evidence.
- Provenance and verification status for each field.

Keep the Skin Studio's affiliate purchase prompt exactly **“Check price on Amazon”**. Do not introduce a price field. The product guide may contain the affiliate link; the overview card should not grow a separate “View on Amazon” button. AI-generated text must not invent medical claims, guarantee outcomes, or imply professional medical advice.

## 3. Claude/API architecture

- Run all provider calls on a trusted server endpoint or background job, never directly from browser code.
- Store API keys in server-side secrets. Never expose them in HTML, browser bundles, logs, or returned client configuration.
- Add per-admin authorization, request throttling, timeouts, bounded retries, payload-size limits, and usage/cost ceilings.
- Prefer asynchronous jobs for bulk imports. Show queued/running/completed/partial/failed states and per-product results.
- Use structured output/schema validation and treat retrieved pages as untrusted data. Page content must be treated as source material, not as instructions to the model.
- Record model/version, prompt/schema version, source URLs, timestamps, token/usage metadata where available, validation outcomes, and the admin who approved the draft.
- Add a provider adapter so Claude can be replaced or supplemented without tying product data models to one vendor.
- Do not persist full copyrighted page contents unless the source licence and retention rules permit it; retain only the evidence snippets needed for review.

## 4. Image workflow

Use two clearly separated paths:

**Authentic product imagery**
- Prefer manufacturer-approved product images or images uploaded by the admin.
- Store the original source URL and provenance. Let the admin choose which image becomes the primary product image and which become gallery thumbnails.
- Do not fabricate packaging, labels, brand marks, product variants, or “before/after” results. Generated imagery must never be presented as a photograph of the real product.

**Generated creative imagery**
- Integrate a dedicated image-generation/editing provider separately from Claude for optional category artwork, editorial banners, neutral skincare lifestyle scenes, and campaign assets.
- Let the admin specify intended placement, aspect ratio, mood, and any brand constraints; preview and approve the result before saving it to the media library.
- Mark generated assets internally with provider, prompt/version, creation time, and intended usage. Do not replace the authentic product image automatically.
- Run image validation for dimensions, file type, size, and accessibility text; require an admin decision before publishing generated assets.

## 5. Rollout phases and acceptance criteria

**Phase A — foundations (current priority):** finish visual builder reliability, autosave/recovery, edit history, product CRUD, media upload/reuse, and authenticated read-back tests. No AI provider calls yet.

**Phase B — research prototype:** add a server-side provider adapter and one-product research flow behind an admin-only feature flag. Test known products against source evidence and deliberately missing/conflicting facts.

**Phase C — reviewed bulk research:** add CSV/product-list input, queueing, partial failure reporting, duplicate checks, usage budgets, and per-item approval. Never auto-publish.

**Phase D — image generation:** add an optional creative-assets panel with preview, provenance, usage controls, and explicit save/approve actions. Keep this separate from authentic product gallery management.

**Release gates**
- 100% of displayed extracted facts are traceable to a source or clearly labelled editorial content.
- Missing or conflicting source facts are surfaced rather than guessed.
- No browser-exposed provider secrets.
- No automatic product publication or silent overwrite.
- Rate limits, cost limits, retries, partial failures, and audit records are exercised.
- Product images and generated creative assets remain clearly distinguished.
- Affiliate label and no-price-field requirements pass regression checks.
