import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync("worker.js", "utf8");
const router = readFileSync("worker-router.js", "utf8");
const wrangler = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
const admin = readFileSync("admin.html", "utf8");

function section(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  assert.notEqual(start, -1, `Missing source section: ${startToken}`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.notEqual(end, -1, `Missing end marker for: ${startToken}`);
  return source.slice(start, end);
}

// Cloudflare Cron must reach the same Worker module that handles HTTP routes.
assert.match(worker, /async scheduled\(controller, env, ctx\)/);
assert.match(worker, /runNuvoraScheduledHealthCheck\(env, controller\?\.scheduledTime/);
assert.match(router, /async scheduled\(controller, env, ctx\)/);
assert.match(router, /worker\.scheduled\(controller, env, ctx\)/);
assert.ok(Array.isArray(wrangler.triggers?.crons));
assert.ok(wrangler.triggers.crons.includes("15 8 * * *"));

// Scheduled maintenance is deterministic, read-only for business data, and never calls AI.
const maintenance = section(worker, "async function runNuvoraScheduledHealthCheck(", "const NUVORA_BACKUP_VERSION=");
assert.match(maintenance, /supabaseRest\(env,'GET','products'/);
assert.match(maintenance, /supabaseRest\(env,'GET','store_settings'/);
assert.match(maintenance, /supabaseRest\(env,'GET','nuvora_product_import_batches'/);
assert.match(maintenance, /supabaseRest\(env,'POST','admin_activity'/);
assert.match(maintenance, /mutations:0,aiCalls:0/);
assert.doesNotMatch(maintenance, /supabaseRest\(env,'(PATCH|PUT|DELETE)'/);

// Manual maintenance and history are admin-gated.
const maintenanceRoute = section(worker, "if(url.pathname==='/api/admin/system/maintenance'", "if(url.pathname==='/api/admin/diagnostics'");
assert.match(maintenanceRoute, /adminUser\(request,env\)/);
assert.match(maintenanceRoute, /request\.method==='POST'/);
assert.match(maintenanceRoute, /request\.method==='GET'/);

// Backup export is private, store-scoped and contains configuration plus storefront products.
const exportRoute = section(worker, "if(url.pathname==='/api/admin/backups/export'", "if(url.pathname==='/api/admin/backups/restore'");
assert.match(exportRoute, /adminUser\(request,env\)/);
assert.match(exportRoute, /content-disposition/);
assert.match(exportRoute, /cache-control/);
const createBackup = section(worker, "async function createNuvoraBackup(", "function validNuvoraBackupId(");
assert.match(createBackup, /storefront_key=in\.\(main,skin\)/);
assert.match(createBackup, /skin_site_config/);
assert.match(createBackup, /home_products/);
assert.match(createBackup, /clothing_products/);
assert.match(createBackup, /games_products/);
assert.match(createBackup, /categories/);
assert.match(createBackup, /collections/);

// Restore is authenticated, format-checked, preview-first, merge-only and keeps public layouts unchanged.
const restoreRoute = section(worker, "if(url.pathname==='/api/admin/backups/restore'", "if(url.pathname==='/api/admin/system/maintenance'");
assert.match(restoreRoute, /adminUser\(request,env\)/);
assert.match(restoreRoute, /dryRun/);
assert.match(restoreRoute, /input\.confirm!==true/);
const restore = section(worker, "async function restoreNuvoraBackup(", "async function runNuvoraScheduledHealthCheck(");
assert.match(restore, /existingProducts\.has\(id\)/);
assert.match(restore, /published:false/);
assert.match(restore, /site_draft/);
assert.match(restore, /if\(dryRun\)return/);
assert.doesNotMatch(restore, /supabaseRest\(env,'DELETE'/);
assert.doesNotMatch(restore, /skin_site_config\s*:/);

// The Admin exposes the workflow and requires a preview before confirming a merge.
assert.match(admin, /onclick="downloadNuvoraBackup\(\)"/);
assert.match(admin, /onclick="previewNuvoraRestore\(\)"/);
assert.match(admin, /async function previewNuvoraRestore\(\)/);
assert.match(admin, /async function restoreNuvoraBackupNow\(\)/);
assert.match(admin, /dryRun:true/);
assert.match(admin, /confirm:true/);
assert.match(admin, /Restore never overwrites existing product records/);
assert.match(admin, /async function loadScheduledMaintenance\(\)/);
assert.match(admin, /async function runScheduledMaintenance\(\)/);

console.log("Nuvora maintenance and backup contracts passed: Cron forwarding, read-only checks, admin authorization, scoped export, dry-run restore, preserved published layouts and unpublished recovered records.");
