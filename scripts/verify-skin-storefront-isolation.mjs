import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [worker, server, admin, wrapper, aiManager, editor, experienceStudio, schema, ownershipMigration] = await Promise.all([
  read("worker.js"),
  read("api/server.js"),
  read("admin.html"),
  read("beauty.html"),
  read("ai-manager.html"),
  read("edit-product.html"),
  read("experience-studio.html"),
  read("backend/schema.sql"),
  read("backend/migrations/20261115073356_nuvora_skin_catalogue_storefront_key.sql")
]);

// The legacy database/API key remains "skin" for compatibility; all customer-
// facing surfaces and all new product-management flows are Women's Fashion.
assert.ok(worker.includes("const isSkinStorefront=storefront==='beauty'||storefront==='skin'"), "Worker must normalize the legacy women's-fashion catalogue aliases.");
assert.ok(worker.includes("storefront_key=eq.'+(isSkinStorefront?'skin':'main')"), "Public catalogue requests must filter by explicit storefront ownership.");
assert.ok(server.includes("storefront_key=eq.'+(u.searchParams.get('storefront')==='beauty'||u.searchParams.get('storefront')==='skin'?'skin':'main')"), "Node API catalogue requests must use the same explicit storefront ownership.");
assert.ok(!worker.includes("const titleIsSkincare="), "Catalogue ownership must not be inferred from product titles.");

assert.ok(worker.includes("url.pathname==='/fashion'") || worker.includes("url.pathname)){$"), "Worker must route the women's-fashion storefront.");
assert.ok(worker.includes("url.pathname==='/admin/womens-fashion'"), "Worker must route the Women's Fashion Studio.");
assert.ok(worker.includes("legacyUrl.pathname=legacyUrl.pathname.replace(/^\\/beauty(?=\\/|$)/,'/fashion')"), "The old /beauty route must redirect to /fashion.");
assert.ok(worker.includes("You are the Nuvora Women’s Fashion shopping assistant."), "The customer assistant must use fashion-specific guidance.");
assert.ok(worker.includes("Prepare structured fields for a women’s fashion product editor."), "AI product preparation must use a fashion-specific prompt.");
assert.ok(worker.includes("const allowedSkinCategories=['dresses','tops-blouses','shirts','trousers-jeans'"), "AI classification must use the new fashion taxonomy.");
assert.ok(worker.includes("product.published=false"), "New AI-prepared catalogue items must remain unpublished drafts.");
assert.ok(worker.includes("storefront_key:'skin'"), "Fashion intake must preserve the current internal storefront ownership key.");

assert.ok(admin.includes("String(product?.storefront_key||'main').trim().toLowerCase()==='skin'"), "Fashion Studio must rely on explicit catalogue ownership.");
assert.ok(admin.includes("storefront_key:window.skinCareImportMode?'skin':String(currentProduct?.storefront_key||'main')"), "Fashion product saves must persist to the existing isolated catalogue key.");
assert.ok(admin.includes("document.getElementById('pfSource').value='web'"), "New fashion products must default to retailer-neutral source entry.");
assert.ok(admin.includes("document.getElementById('pfRetailer').value=''"), "New fashion products must not be forced to Amazon.");
assert.ok(admin.includes("Paste a product URL from any supported retailer"), "Product intake must accept product links from supported retailers.");
assert.ok(admin.includes("Could not open the women’s fashion product form:"), "Fashion Studio must show a useful Add Product error.");
assert.ok(admin.includes("filter(product=>isSkinProduct(product)&&(product.published===true||placedIds.has(String(product.id))))"), "Fashion Studio preview must preserve storefront ownership and draft placement rules.");

for (const label of [
  "Materials & fabric composition",
  "Fit & sizing notes",
  "Style tags / aesthetics",
  "Occasions / where to wear",
  "Garment care notes"
]) {
  assert.ok(editor.includes(label), "Fashion product editor is missing the field: " + label);
}

for (const category of [
  "Dresses","Tops & Blouses","Trousers & Jeans","Co-ords & Matching Sets",
  "Heels","Sneakers","Handbags","Jewellery","Sunglasses","Activewear",
  "Loungewear & Sleepwear","Occasionwear","Fashion Accessories"
]) {
  assert.ok(aiManager.includes(category), "AI Manager is missing fashion category: " + category);
}
assert.ok(aiManager.includes("Women’s Fashion"), "AI Manager must be labelled for Women's Fashion.");

assert.ok(wrapper.includes('id="nuvora-fashion-store"'), "Storefront wrapper must expose the fashion iframe.");
assert.ok(wrapper.includes("const basePath='/fashion'"), "Storefront wrapper must synchronize /fashion routes.");
assert.ok(wrapper.includes("nuvora-fashion-store-route") && wrapper.includes("nuvora-fashion-store-navigate"), "Storefront wrapper must use fashion-specific route events.");
assert.ok(experienceStudio.includes("Women’s Fashion experiences loaded."), "Experience Studio must identify the fashion customer experiences.");
assert.ok(experienceStudio.includes("Materials & fabric data"), "Experience Studio must report fashion material coverage.");

assert.ok(schema.includes("storefront_key text not null default 'main'"), "Database schema must retain explicit product ownership.");
assert.ok(ownershipMigration.includes("check (storefront_key in ('main', 'skin'))"), "Existing database constraint must preserve the legacy fashion catalogue key.");

console.log("Nuvora Women's Fashion storefront, editor, AI intake and catalogue-isolation checks passed.");
