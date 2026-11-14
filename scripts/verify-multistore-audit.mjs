import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const [worker,studio]=await Promise.all([
 readFile(new URL("../worker.js",import.meta.url),"utf8"),
 readFile(new URL("../storefront-studio.html",import.meta.url),"utf8")
]);
for(const token of ["product.features","product.specifications","product.featured"])assert.ok(worker.includes(token),"Worker product validation missing: "+token);
assert.ok(worker.includes("Published retailer destinations must use HTTPS."),"Published retailer destinations must require HTTPS.");
assert.ok(studio.includes('id="pFeatured"'),"Product editor must let stores feature products on their homepage.");
assert.ok(studio.includes('id="pImagePreview"')&&studio.includes("function updateProductMainImagePreview()"),"Product editor must preview the selected main image.");
assert.ok(studio.includes("status==="+"\"published\"")&&studio.includes("validHttpUrl(destinationUrl,true)"),"Product editor must block incomplete or non-HTTPS published products.");
assert.ok(studio.includes('id="storeProductAIButton"')&&studio.includes("async function generateStoreProductImage()"),"Store editor AI link and image workflows must remain available.");
console.log("Nuvora multi-store editor and publication contracts passed.");
