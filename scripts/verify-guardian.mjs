import fs from "node:fs";
import assert from "node:assert/strict";

const worker = fs.readFileSync(new URL("../worker.js", import.meta.url), "utf8");
const router = fs.readFileSync(new URL("../worker-router.js", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../guardian.html", import.meta.url), "utf8");

for (const route of ["/api/admin/guardian/scan", "/api/admin/guardian/history"]) {
  assert.ok(worker.includes(route), `Missing Guardian API route: ${route}`);
}
assert.ok(worker.includes("adminUser(request,env)"), "Guardian API must require an authenticated admin.");
assert.ok(worker.includes("action:'nuvora_guardian_scan'"), "Guardian scan results must be persisted to admin activity history.");
assert.ok(worker.includes("runNuvoraGuardianScan(env,scheduledAt)"), "Guardian must run from the daily scheduled Worker.");
assert.ok(worker.includes("https://client-store-platform.rayyung713.workers.dev"), "Skin Care storefront is not registered.");
assert.ok(worker.includes("https://nuvora-clothing.rayyung713.workers.dev"), "Clothing storefront is not registered.");
assert.ok(worker.includes("https://nuvora-games.rayyung713.workers.dev"), "Gaming storefront is not registered.");
assert.ok(worker.includes("https://nuvora-home.rayyung713.workers.dev"), "Home storefront is not registered.");
for (const route of ["/admin/skin-studio", "/admin/clothing-studio", "/admin/gaming-studio", "/admin/home-studio", "/admin/guardian"]) assert.ok(worker.includes(route), `Guardian scan is missing admin route coverage: ${route}`);
assert.ok(router.includes("/admin/guardian"), "Guardian admin route is not registered.");
assert.ok(router.includes("nuvora-guardian-nav-link"), "Guardian is not linked from the main admin navigation.");
assert.ok(router.includes("withGuardianShortcut"), "Guardian shortcut is not exposed from the companion studios.");
assert.ok(page.includes("/api/admin/guardian/scan"), "Guardian dashboard cannot start a scan.");
assert.ok(page.includes("/api/admin/guardian/history"), "Guardian dashboard cannot load scan history.");
assert.ok(page.includes("Copy fix brief"), "Guardian issue reports need a copyable remediation brief.");
assert.ok(page.includes("@media(max-width:700px)"), "Guardian dashboard needs a mobile layout.");
assert.ok(page.includes("Automatic code repair is not performed"), "Guardian must disclose the current repair limitation.");

console.log("Nuvora Guardian contracts passed.");
