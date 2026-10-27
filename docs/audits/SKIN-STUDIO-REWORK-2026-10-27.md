# Skin Studio Admin Rework — 27 October 2026

## Scope

This work is in the main `yungshadow213-prog/nuvora` repository and is limited to Nuvora Admin / Skin Studio. The separate `client-store-platform` storefront repository is intentionally untouched. No merge, deployment, production configuration change, or authenticated live write test has been performed. Claude/product-research and image-generation integration remain paused.

## Implemented in the current review branch

- Reduced the default page-outline and inspector widths so the live storefront canvas has more room.
- Added controls to collapse/restore the page outline and selected-item inspector.
- Added a canvas-focus mode that hides both side panels and can be exited with Escape.
- Added mobile drawer behavior for the outline and inspector; the storefront preview starts expanded on narrow screens.
- Added Undo/Redo buttons and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Ctrl/Cmd+Y shortcuts. Common section, product placement/order, page, and category edits create grouped history snapshots; restoring a snapshot updates the draft editor and preview. Text-control history now captures the pre-edit state on focus, rather than incorrectly snapshotting after the input has already changed.
- Updated the Skin Studio product library to 10 products per page and added combined brand, category, publication-status, and known-availability filters alongside catalogue-wide search. Unknown availability stays distinct from known available/unavailable values.
- Added a Media tab to browse up to the first 1,000 uploaded images in the existing `product-images/skin-site` storage path with 24 images per page, search filenames without reloading storage per keystroke, copy public URLs, and apply an existing image to the selected section or custom category. It intentionally has no destructive delete control.
- Added a non-blocking publish preflight that warns about explicitly selected draft products, stale product references, empty manual product grids, and visible HTTP navigation/footer links. Admins can review warnings and choose whether to continue; it does not silently publish products.
- Fixed the iframe ready/load race: an early `nuvora-skin-studio-ready` message is recorded, the subsequent load handler does not re-open the waiting notice, and the timeout cannot incorrectly replace a ready state.
- Reset the ready flag and cancel stale timeouts when manually reloading the preview.
- Prevented Place on Page from selecting a hidden product grid as the destination; it now prefers a visible grid and can fall back to another visible grid or create one.
- Added release-contract checks for the preview handshake, timeout reset, canvas controls, and hidden-grid placement.

## Still to do

- Run the automated GitHub checks against the latest review-branch head and resolve any failures.
- Continue the larger visual-builder work: history/undo-redo, reliable draft recovery, faster in-preview selection, stronger direct-editing controls, product/media-library workflow, and publish preflight validation.
- Verify authenticated browser flows for product creation/editing, upload, save/reopen, section add/delete/reorder, product placement, and publish read-back. These require the authorized admin session and are not claimed as tested here.
- Keep Skin Care product requirements intact: no price field in the editor, purchase label exactly `Check price on Amazon`, retailer ratings separate from Nuvora reviews, complete product-guide information, and only published products exposed publicly.
- Added `docs/plans/SKIN-STUDIO-AI-RESEARCH-AND-IMAGES.md` covering Claude-backed product research, source evidence, admin approval, secure server-side provider calls, bulk processing, and a separate generated-creative workflow. AI integration remains planned, not active, until editor persistence and authenticated workflows are verified.

## Verification status

- The implementation revision `71fa2202ecc6b2ddcbfc7f0c8386f0acbc0f4f42` passed all 9 jobs in GitHub Actions run #1560, including admin/editor JavaScript syntax, release-contract audit, deep runtime audit, storefront JavaScript, and Cloudflare/Wrangler dry-run bundle checks.
- The later changes after that tested revision were documentation-only; no deployment or production write was performed.
- Authenticated browser verification remains outstanding. The broader rework is not complete.
