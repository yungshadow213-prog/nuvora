import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const [worker,studio]=await Promise.all([
 readFile(new URL("../worker.js",import.meta.url),"utf8"),
 readFile(new URL("../storefront-studio.html",import.meta.url),"utf8")
]);
assert.ok(worker.includes("function validatePublishedStorefrontProducts"),"Multi-store publishing must validate live product records");
assert.ok(worker.includes("const publishError=validatePublishedStorefrontProducts(products)"),"Publish action must enforce the live-product validation gate");
for(const token of ["Published products need a category.","Published products need a verified main image.","Published products need an exact retailer product link.","Published retailer links must use HTTPS."])assert.ok(worker.includes(token),"Publish validation missing: "+token);
for(const token of ["product.features","product.specifications","product.featured"])assert.ok(worker.includes(token),"Product schema validation missing: "+token);
for(const token of ['id="pFeatures"','id="pSpecifications"','id="pImagePreview"','id="generateProductCopy"','function updateProductImagePreview()','function generateProductCopy()','request("/api/admin/ai/copy"','updateProductImagePreview();'])assert.ok(studio.includes(token),"Store Studio editor capability missing: "+token);
const seed=studio.slice(studio.indexOf("function adoptSeedProducts("),studio.indexOf("function watchPreview(",studio.indexOf("function adoptSeedProducts("));
assert.ok(seed.includes('status:"draft"')&&seed.includes("featured:false"),"Bundled starter products must remain private drafts");
console.log("Nuvora multi-store publishing and editor contracts passed.");
