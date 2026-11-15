import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const [worker, server, admin, layout, schema, migration] = await Promise.all([
  read("worker.js"),
  read("api/server.js"),
  read("admin.html"),
  read("admin-layout-v2.js"),
  read("backend/schema.sql"),
  read("backend/migrations/20261115073356_nuvora_skin_catalogue_storefront_key.sql")
]);

assert.ok(worker.includes("storefront_key=eq.'+(url.searchParams.get('storefront')==='beauty'||url.searchParams.get('storefront')==='skin'?'skin':'main')"), "Worker public product API must filter by explicit storefront key.");
assert.ok(server.includes("storefront_key=eq.'+(u.searchParams.get('storefront')==='beauty'||u.searchParams.get('storefront')==='skin'?'skin':'main')"), "Node public product API must match Worker storefront filtering.");
assert.ok(!worker.includes("const titleIsSkincare="), "Worker must not infer Skin catalogue membership from product text.");
assert.ok(!server.includes("const productText=[p.name,p.brand,p.description,p.features,p.store_description]"), "Node server must not infer Skin catalogue membership from product text.");

assert.ok(admin.includes("String(product?.storefront_key||'main').trim().toLowerCase()==='skin'"), "Skin Studio must rely on explicit product ownership.");
assert.ok(admin.includes("storefront_key:window.skinCareImportMode?'skin':String(currentProduct?.storefront_key||'main')"), "Skin product saves must assign the Skin storefront key.");
assert.ok(admin.includes("filter(product=>placedIds.has(String(product.id))&&isSkinProduct(product))"), "Skin Studio preview must receive only explicitly assigned and placed Skin products.");
assert.ok(admin.includes('id="skin-studio-expanded-canvas"'), "Skin Studio must use the expanded-canvas workspace styles.");
assert.ok(admin.includes("--nv-studio-sidebar-width") && admin.includes("grid-template-columns:minmax(240px,var(--nv-studio-sidebar-width,268px))"), "The preview layout must support a wider adjustable canvas.");

assert.ok(layout.includes('setAttribute("role","separator")'), "Sidebar resize handle must expose an accessible separator role.");
assert.ok(layout.includes('event.key==="ArrowLeft"||event.key==="ArrowRight"'), "Sidebar resize handle must support keyboard resizing.");
assert.ok(layout.includes("nuvora-skin-studio-sidebar-width"), "Sidebar width must persist between editor visits.");

assert.ok(schema.includes("storefront_key text not null default 'main'"), "Fresh schema must include storefront ownership.");
assert.ok(migration.includes("check (storefront_key in ('main', 'skin'))"), "Migration must restrict catalogue keys to supported shared catalogues.");

const [autopilotWorker, autopilotRouter, autopilotPage, autopilotMigration] = await Promise.all([
  read("worker.js"),
  read("worker-router.js"),
  read("ai-manager.html"),
  read("backend/migrations/20261115081209_nuvora_autopilot_phase_one.sql")
]);

assert.ok(autopilotRouter.includes('url.pathname === "/admin/ai-manager"'), "The AI Manager must be routed by the active Worker entry point.");
assert.ok(autopilotRouter.includes('/ai-manager.html'), "The AI Manager route must serve its dashboard asset.");
assert.ok(admin.includes("window.location.href='/admin/ai-manager'"), "Nuvora Admin must expose an AI Manager navigation link.");
assert.ok(autopilotPage.includes("/api/admin/ai/manager/audit"), "The dashboard must call the authenticated Skin Care audit API.");
assert.ok(autopilotPage.includes("/api/admin/ai/manager/prepare"), "The dashboard must expose AI copy preparation.");
assert.ok(autopilotPage.includes("proposed_patch.store_description"), "The approval UI must display the exact description proposed by AI.");
assert.ok(autopilotPage.includes("Undo change"), "The approval UI must expose rollback for applied changes.");

assert.ok(autopilotWorker.includes("storefront_key=eq.skin&order=created_at.desc&limit=1000"), "Autopilot audit must read only the Skin Care catalogue.");
assert.ok(autopilotWorker.includes("storefront_key=eq.skin&order=created_at.desc&limit=1000"), "Autopilot preparation must read only the Skin Care catalogue.");
assert.ok(autopilotWorker.includes("&store_key=eq.skin&limit=1"), "Operation lookup must be scoped to the Skin Care store.");
assert.ok(autopilotWorker.includes("&storefront_key=eq.skin&or=(store_description.is.null,store_description.eq.)"), "Approvals must only fill an empty description on a Skin Care product.");
assert.ok(autopilotWorker.includes("&storefront_key=eq.skin&store_description=eq.'+encodeURIComponent(description)"), "Rollback must be scoped to Skin Care and protect newer product edits.");
assert.ok(autopilotWorker.includes("['approve','reject','rollback']"), "The operation API must restrict state transitions to explicit actions.");
assert.ok(autopilotWorker.includes("operation.action_type!=='fill_store_description'"), "Only the explicitly implemented action type may be applied.");
assert.ok(autopilotWorker.includes("Main-store products were excluded from this audit."), "The audit must state the catalogue isolation boundary.");
assert.ok(autopilotMigration.includes("alter table public.nuvora_ai_operations enable row level security"), "The AI approval queue must have RLS enabled.");
assert.ok(autopilotMigration.includes("revoke all on table public.nuvora_ai_operations from anon, authenticated"), "Browser roles must not receive direct approval queue access.");


const [importWorker, importPage, importQueueMigration, identityGuardMigration] = await Promise.all([
  read("worker.js"),
  read("ai-manager.html"),
  read("backend/migrations/20261115083647_nuvora_skin_bulk_import_phase_two.sql"),
  read("backend/migrations/20261115084720_nuvora_skin_product_import_identity_guards.sql")
]);

assert.ok(importWorker.includes("/api/admin/ai/import/prepare"), "The dedicated Skin Care import preparation endpoint must exist.");
assert.ok(importWorker.includes("/api/admin/ai/import/items'&&request.method==='GET'"), "The Skin Care import review queue endpoint must exist.");
assert.ok(importWorker.includes("store_key:'skin'") && importWorker.includes("storefront_key:'skin'"), "Every staged batch and created product must be explicitly assigned to Skin Care.");
assert.ok(importWorker.includes("&storefront_key=eq.skin&amazon_asin=eq."), "Amazon duplicate checks must be scoped to Skin Care.");
assert.ok(importWorker.includes("&storefront_key=eq.skin&source_sku=eq."), "Non-Amazon duplicate checks must be scoped to Skin Care.");
assert.ok(importWorker.includes("Draft customer-facing copy once per batch"), "The importer must prepare customer copy from source facts.");
assert.ok(importWorker.includes("Do not invent or infer ingredient concentrations"), "AI product copy must prohibit unsupported skincare claims.");
assert.ok(importWorker.includes("product.published=false"), "Approved imports must remain unpublished drafts.");
assert.ok(importWorker.includes("['ready','needs_review'].includes(item.status)"), "Import approvals must reject concurrent or already-importing items.");
assert.ok(importWorker.includes("Use a public HTTPS product link."), "Source imports must reject non-HTTPS URLs.");
assert.ok(importWorker.includes("isDisplayableProductImage(value)") && importWorker.includes("test(String(value))"), "Imported product images must use HTTPS.");
assert.ok(importPage.includes("id=\"importUrls\""), "AI Manager must provide a bulk product-link input.");
assert.ok(importPage.includes("normalizeSourceLinks"), "AI Manager must normalise pasted product URLs.");
assert.ok(importPage.includes("/api/admin/ai/import/prepare"), "AI Manager must call the isolated preparation endpoint.");
assert.ok(importPage.includes("Add as draft"), "AI Manager must require an explicit draft-creation action.");
assert.ok(importPage.includes("Nuvora copy:"), "AI Manager must preview generated customer-facing copy.");
assert.ok(importQueueMigration.includes("store_key text not null default 'skin' check (store_key = 'skin')"), "Import queue rows must be Skin Care-only.");
assert.ok(importQueueMigration.includes("alter table public.nuvora_product_import_items enable row level security"), "Import queue must have RLS enabled.");
assert.ok(importQueueMigration.includes("revoke all on table public.nuvora_product_import_items from anon, authenticated"), "Browser roles must not read import queue records directly.");
assert.ok(identityGuardMigration.includes("where storefront_key = 'skin' and amazon_asin is not null"), "Skin Care ASIN duplicates must be blocked by a database unique index.");
assert.ok(identityGuardMigration.includes("where storefront_key = 'skin' and retailer is not null and source_sku is not null"), "Skin Care retailer/SKU duplicates must be blocked by a database unique index.");
assert.ok(importWorker.includes("const seenBatchIdentities=new Map()"), "Duplicate ASIN/SKU identities must be detected within the same import batch.");
assert.ok(importWorker.includes("const skinCategorySlug=String(product.skin_category_slug||'other-skincare').slice(0,100)"), "Approved product category must be retained from the Skin Studio classification.");
assert.ok(importWorker.includes("productCategoryMap[String(created.id)]=skinCategorySlug"), "Approval must sync the collection assignment into the private Skin Studio draft.");
assert.ok(importWorker.includes("refreshSkinImportBatch(env,item.batch_id)"), "Approvals and dismissals must refresh their batch counters.");
assert.ok(importPage.includes("Nuvora copy: "), "The generated customer-facing copy must be visible for review.");
assert.ok(importPage.includes("import-store-copy"), "Generated store copy must be visually distinct from retailer source copy.");


console.log("Nuvora Skin Studio isolation and Autopilot safeguards passed.");
