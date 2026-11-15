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

console.log("Nuvora Skin Studio isolation and Autopilot safeguards passed.");
