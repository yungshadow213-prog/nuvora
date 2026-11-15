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
  read("backend/migrations/20261115073400_nuvora_skin_catalogue_storefront_key.sql")
]);

assert.ok(worker.includes("storefront_key=eq.'+(url.searchParams.get('storefront')==='beauty'||url.searchParams.get('storefront')==='skin'?'skin':'main')"), "Worker public product API must filter by explicit storefront key.");
assert.ok(server.includes("storefront_key=eq.'+(u.searchParams.get('storefront')==='beauty'||u.searchParams.get('storefront')==='skin'?'skin':'main')"), "Node public product API must match Worker storefront filtering.");
assert.ok(!worker.includes("const titleIsSkincare="), "Worker must not infer Skin catalogue membership from product text.");
assert.ok(!server.includes("const productText=[p.name,p.brand,p.description,p.features,p.store_description]"), "Node server must not infer Skin catalogue membership from product text.");

assert.ok(admin.includes("String(product?.storefront_key||'main').trim().toLowerCase()==='skin'"), "Skin Studio must rely on explicit product ownership.");
assert.ok(admin.includes("storefront_key:window.skinCareImportMode?'skin':String(currentProduct?.storefront_key||'main')"), "Skin product saves must assign the Skin storefront key.");
assert.ok(admin.includes("filter(product=>isSkinProduct(product)&&placedIds.has(String(product.id)))"), "Skin Studio preview must receive only explicitly assigned and placed Skin products.");
assert.ok(admin.includes('id="skin-studio-expanded-canvas"'), "Skin Studio must use the expanded-canvas workspace styles.");
assert.ok(admin.includes("--nv-studio-sidebar-width") && admin.includes("grid-template-columns:minmax(240px,var(--nv-studio-sidebar-width,268px))"), "The preview layout must support a wider adjustable canvas.");

assert.ok(layout.includes('setAttribute("role","separator")'), "Sidebar resize handle must expose an accessible separator role.");
assert.ok(layout.includes('event.key==="ArrowLeft"||event.key==="ArrowRight"'), "Sidebar resize handle must support keyboard resizing.");
assert.ok(layout.includes("nuvora-skin-studio-sidebar-width"), "Sidebar width must persist between editor visits.");

assert.ok(schema.includes("storefront_key text not null default 'main'"), "Fresh schema must include storefront ownership.");
assert.ok(migration.includes("check (storefront_key in ('main', 'skin'))"), "Migration must restrict catalogue keys to supported shared catalogues.");
console.log("Nuvora Skin Studio catalogue isolation and expanded-preview checks passed.");
