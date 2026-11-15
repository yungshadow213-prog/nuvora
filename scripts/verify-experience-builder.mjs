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
for(const id of ['compare','quiz','product-finder','routine-builder','ingredient-library','alternatives','recommendations','recently-viewed','smart-search'])assert.ok(worker.includes("id:'"+id+"'"),"Experience module missing: "+id);
assert.ok(router.includes('/admin/experiences')&&router.includes('experience-studio.html'),"Experience Studio route missing");
assert.ok(router.includes('nuvora-experience-nav-link'),"Main Admin navigation entry missing");
assert.ok(studio.includes("/api/admin/experience-builder?store=skin"),"Studio must load its scoped API");
assert.ok(studio.includes("method:'PUT'"),"Studio must save through its admin API");
assert.ok(studio.includes('Save as draft')&&studio.includes('Save & publish'),"Draft and publish controls required");
assert.ok(studio.includes('data-remove-question')&&studio.includes('addQuestion'),"Quiz question editor is incomplete");
assert.ok(ai.includes('/admin/experiences'),"AI Manager must link back to Experience Studio");
console.log("Nuvora Experience Studio architecture contracts passed.");
