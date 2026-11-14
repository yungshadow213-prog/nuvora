import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const [html, css, js, worker, studio] = await Promise.all([
  readFile(new URL("../admin.html", import.meta.url), "utf8"),
  readFile(new URL("../admin-layout-v2.css", import.meta.url), "utf8"),
  readFile(new URL("../admin-layout-v2.js", import.meta.url), "utf8"),
  readFile(new URL("../worker.js", import.meta.url), "utf8"),
  readFile(new URL("../storefront-studio.html", import.meta.url), "utf8")
]);

assert.ok(html.includes('/admin-layout-v2.css?v=1'), "Admin must load the new layout stylesheet");
assert.ok(html.includes('/admin-layout-v2.js?v=1'), "Admin must load the accordion behavior");
assert.ok(html.includes('id="skinStudioPreview"'), "Skin Studio must retain its live storefront iframe");
assert.ok(html.includes('loading="eager"'), "Store preview should load eagerly");
assert.ok(html.includes("studioPreview=1&device=desktop"), "Preview route should use a stable cacheable URL");
assert.ok(html.includes("placedIds.has(String(product.id))&&isSkinProduct(product)"), "Preview must expose only Skin Care products placed in visible product grids");
assert.ok(html.includes("group.open=index===0;"), "Only one dynamic inspector group should expand by default");
assert.ok(html.includes("target.open=true;"), "Deep links to whole-site settings must open the target accordion");

for (const token of [
  "upgradeAdminNavigation",
  "upgradeStudioWorkspace",
  "upgradeOutlineGroups",
  "upgradeSettingsGroups",
  "MutationObserver",
  "wrapSettingsNavigation"
]) assert.ok(js.includes(token), "Collapsible interface behavior missing: " + token);

for (const token of [
  ".nv-admin-nav-summary",
  ".nv-workspace-summary",
  ".nv-outline-summary",
  ".nv-settings-summary",
  "grid-template-columns:360px minmax(0,1fr)",
  ".studio-layout.is-inspecting .studio-left-panel>.studio-right-panel",
  ".studio-workspace-group.nv-accordion",
  ".nv-outline-accordion[hidden]",
  "height:calc(100dvh - 154px)",
  "#skinStudioPreview"
]) assert.ok(css.includes(token), "Admin layout styling missing: " + token);

assert.ok(!js.includes("ANTHROPIC_API_KEY"), "Layout-only patch must not include or activate Claude secrets");

for (const token of [
  "openSkinClaudeAssistant",
  "sendSkinClaudePrompt",
  "applySkinClaudeChanges",
  "skinClaudePendingChanges",
  "nuvora-skin-studio-request-add-section",
  "window.__nuvoraSkinPendingSectionInsert",
  "targetSections.splice(targetIndex>=0?targetIndex+1:targetSections.length,0,section)",
  "selection:skinStudioSelection||null"
]) assert.ok(html.includes(token), "Skin Studio visual-editor behavior missing: " + token);

for (const token of [
  "#skinClaudeAssistant[hidden]",
  ".skin-claude-dialog",
  ".skin-claude-proposals",
  ".skin-claude-composer"
]) assert.ok(css.includes(token), "Claude assistant styling missing: " + token);

for (const token of [
  "/api/admin/ai/studio",
  "/api/admin/ai/skin-product",
  "/api/admin/ai/copy",
  "/api/admin/ai/image",
  "adminUser(request,env)",
  "runNuvoraWorkersAI",
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/black-forest-labs/flux-2-klein-4b",
  "rateLimit(request,'nuvora-ai-studio'",
  "rateLimit(request,'nuvora-ai-image'",
  "workersAI:!!e.AI"
]) assert.ok(worker.includes(token), "Cloudflare Workers AI integration contract missing: " + token);

for (const token of [
  "product-workspace-page",
  "pfSkinStoreCategory",
  "pfStoreDescription",
  "runSkinBulkAiImport",
  "generateSkinProductWithGemini(j.destination_url||url,{auto:true})",
  "aiModalBody.querySelectorAll('.ai-studio')",
  "No other skincare products are available yet"
]) assert.ok(html.includes(token), "AI-assisted Skin Studio product workspace behavior missing: " + token);

assert.ok(!html.includes("sk-ant-api"), "No Anthropic API key may be embedded in the admin HTML");
assert.ok(!js.includes("ANTHROPIC_API_KEY"), "No Anthropic API key may be embedded in admin layout JavaScript");

for (const token of [
  "nuvora-product-workspace-final-fix",
  "height:100dvh!important",
  "overflow-y:auto!important",
  "product-entry-navigation",
  "position:static!important",
  "grid-template-columns:minmax(180px,220px) minmax(0,1fr) minmax(210px,260px)"
]) assert.ok(html.includes(token), "Product editor scroll/overlap fix is missing: " + token);

for (const token of [
  "/api/admin/ai/store-product",
  "nuvora-ai-store-product",
  "ingestSourceProduct(sourceUrl,env)",
  "Choose category only from this exact list",
  "Verify every product detail before publishing"
]) assert.ok(worker.includes(token), "Store product AI endpoint contract missing: " + token);

for (const token of [
  "fillProductFromSource()",
  "generateStoreProductImage()",
  "useStoreGeneratedImage()",
  "pFeatures",
  "pSpecs",
  "storeProductAIStatus",
  "storeImageGrade",
  "storeImagePreview"
]) assert.ok(studio.includes(token), "Multi-store editor AI workflow missing: " + token);

assert.ok(studio.includes('products=seed.map(p=>({...p,status:"draft"}));'), "Starter products must load as private drafts, never public examples.");
assert.ok(studio.includes("add a verified retailer link before publishing"), "Starter product warning must explain publication requirements.");

console.log("Nuvora Admin layout and Cloudflare Workers AI contracts passed.");
