import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [worker,router,admin,wrangler,workflow] = await Promise.all([
  readFile(new URL("../worker.js", import.meta.url), "utf8"),
  readFile(new URL("../worker-router.js", import.meta.url), "utf8"),
  readFile(new URL("../admin.html", import.meta.url), "utf8"),
  readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8")
]);

// Scheduled maintenance must run automatically and through the router, remain read-only,
// and persist an auditable report without making AI calls or editing catalogue records.
assert.match(wrangler, /"crons"\s*:\s*\[\s*"15 8 \* \* \*"\s*\]/);
assert.match(worker, /async scheduled\(controller, env, ctx\)/);
assert.match(router, /async scheduled\(controller, env, ctx\)/);
assert.match(router, /worker\.scheduled\(controller, env, ctx\)/);
const health = worker.slice(worker.indexOf("async function runNuvoraScheduledHealthCheck("), worker.indexOf("const NUVORA_BACKUP_VERSION="));
assert.match(health, /nuvora_scheduled_health_check/);
assert.match(health, /mutations:0,aiCalls:0/);
assert.match(health, /productsResponse/);
assert.match(health, /settingsResponse/);
assert.match(health, /batchesResponse/);
assert.doesNotMatch(health, /supabaseProductWrite|published\s*:\s*true|runNuvoraWorkersAI/);

// Backups must be authenticated, versioned, bounded, store-scoped and downloadable without caching.
assert.match(worker, /\/api\/admin\/backups\/export/);
assert.match(worker, /\/api\/admin\/backups\/restore/);
assert.match(worker, /const NUVORA_BACKUP_VERSION='nuvora-backup-v1'/);
assert.match(worker, /if\(!admin\)return json\(\{error:'Admin authentication required'\},401\)/);
assert.match(worker, /storefront_key=in\.\(main,skin\)/);
assert.match(worker, /home_products/);
assert.match(worker, /clothing_products/);
assert.match(worker, /games_products/);
assert.match(worker, /Published storefront configurations are preserved in the file, but restore writes only private drafts\./);
assert.match(worker, /if\(!dryRun&&input\.confirm!==true\)/);
assert.match(worker, /published:false/);
assert.match(worker, /Existing product records were not overwritten/);
assert.match(worker, /existingProductSlugs/);
assert.match(worker, /categoryIdMap/);
assert.match(worker, /collectionIdMap/);

// Admin controls must expose export, preview-before-restore, and a second confirmation.
assert.match(admin, /show\('backups',this\)/);
assert.match(admin, /id="downloadNuvoraBackup"/);
assert.match(admin, /async function previewNuvoraRestore\(/);
assert.match(admin, /dryRun:true/);
assert.match(admin, /confirm\('Restore only missing Nuvora records/);
assert.match(admin, /loadScheduledMaintenance\(\)/);
assert.match(admin, /runScheduledMaintenance\(\)/);

// CI must execute this safety contract before deployment.
assert.match(workflow, /npm run verify:ops/);
console.log("Nuvora maintenance, backup, restore and admin safety contracts passed.");
