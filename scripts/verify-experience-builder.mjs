import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const [worker,router,studio,ai]=await Promise.all([
 readFile(new URL('../worker.js',import.meta.url),'utf8'),
 readFile(new URL('../worker-router.js',import.meta.url),'utf8'),
 readFile(new URL('../experience-studio.html',import.meta.url),'utf8'),
 readFile(new URL('../ai-manager.html',import.meta.url),'utf8')
]);
assert.ok(worker.includes("/api/admin/experience-builder"),"Experience Studio API route missing");
assert.ok(worker.includes("storefront_key=eq.skin"),"Experience API must be scoped to Skin Care products");
assert.ok(worker.includes("item.status==='published'"),"Public settings must filter unpublished modules");
assert.ok(worker.includes("function defaultNuvoraExperienceConfig()"),"Default experience registry missing");
for(const id of ['compare','quiz','product-finder','routine-builder','ingredient-library','alternatives','recommendations','recently-viewed','smart-search','compatibility-explorer','preference-profile','shopping-assistant','saved-routines'])assert.ok(worker.includes("id:'"+id+"'"),"Experience module missing: "+id);
for(const type of ['compatibility','profile','assistant','saved-routines'])assert.ok(worker.includes("'"+type+"'"),"Experience validator does not allow "+type);
assert.ok(worker.includes("/api/skin-assistant")&&worker.includes("nuvora-skin-assistant"),"Rate-limited Skin Care shopping assistant API is missing");
assert.ok(worker.includes("storefront_key=eq.skin&published=eq.true"),"Shopping assistant must only read published Skin Care products");
assert.ok(worker.includes("access-control-allow-origin':'https://client-store-platform.rayyung713.workers.dev"),"Shopping assistant CORS is not restricted to the Skin Care client");

assert.ok(router.includes('/admin/experiences')&&router.includes('experience-studio.html'),"Experience Studio route missing");
assert.ok(router.includes('nuvora-experience-nav-link'),"Main Admin navigation entry missing");
assert.ok(studio.includes("/api/admin/experience-builder?store=skin"),"Studio must load its scoped API");
assert.ok(studio.includes("'/api/admin/experience-builder?store=skin','PUT'"),"Studio must save through its admin API");
assert.ok(studio.includes('Save as draft')&&studio.includes('Save & publish'),"Draft and publish controls required");
assert.ok(studio.includes('data-remove-question')&&studio.includes('addQuestion'),"Quiz question editor is incomplete");
for(const id of ['compatibility','profile','assistant','saved-routines'])assert.ok(studio.includes("f.type==='"+id+"'"),"Experience Studio editor missing "+id);
assert.ok(studio.includes("fMaxCompatibility")&&studio.includes("fMaxTurns")&&studio.includes("fMaxRoutines"),"Experience Studio is missing extended module settings");
assert.ok(studio.includes("compatAttr")&&studio.includes("profileField"),"Experience Studio preference and compatibility field editors are missing");
assert.ok(ai.includes('/admin/experiences'),"AI Manager must link back to Experience Studio");
console.log("Nuvora Experience Studio architecture contracts passed.");
