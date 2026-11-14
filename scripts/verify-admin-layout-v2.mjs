import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const [html, css, js, worker] = await Promise.all([
  readFile(new URL("../admin.html", import.meta.url), "utf8"),
  readFile(new URL("../admin-layout-v2.css", import.meta.url), "utf8"),
  readFile(new URL("../admin-layout-v2.js", import.meta.url), "utf8"),
  readFile(new URL("../worker.js", import.meta.url), "utf8")
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
  "/api/admin/ai/claude/studio",
  "adminUser(request,env)",
  "ANTHROPIC_API_KEY",
  "anthropic-version",
  "claude-haiku-5-5",
  "rateLimit(request,'claude-studio'",
  "claude:!!e.ANTHROPIC_API_KEY"
]) assert.ok(worker.includes(token), "Claude API integration contract missing: " + token);

assert.ok(!html.includes("sk-ant-api"), "No Anthropic API key may be embedded in the admin HTML");
assert.ok(!js.includes("ANTHROPIC_API_KEY"), "No Anthropic API key may be embedded in admin layout JavaScript");

console.log("Nuvora Admin layout and Claude contracts passed.");
