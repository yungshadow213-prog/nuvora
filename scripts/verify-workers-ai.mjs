import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const worker = readFileSync("worker.js", "utf8");
const manager = readFileSync("ai-manager.html", "utf8");

function section(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  assert.notEqual(start, -1, `Missing source section: ${startToken}`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.notEqual(end, -1, `Missing end marker for: ${startToken}`);
  return source.slice(start, end);
}

assert.doesNotMatch(worker, /claude|anthropic|ANTHROPIC_API_KEY|CLAUDE_API_KEY/i);
assert.doesNotMatch(manager, /claude|anthropic|ANTHROPIC_API_KEY|CLAUDE_API_KEY/i);
assert.match(worker, /function hasNuvoraTextAI\(env\)[\s\S]*?return !!\(env\?\.AI&&typeof env\.AI\.run==='function'\)/);
assert.match(worker, /primaryTextAIProvider:e\.AI\?'cloudflare-workers-ai':'unavailable'/);
const provider = section(worker, "async function runNuvoraWorkersAI(", "function parseNuvoraAIJson(");
assert.match(provider, /env\.AI\.run\(model/);
assert.match(provider, /provider:'cloudflare-workers-ai'/);
assert.doesNotMatch(provider, /fallbackReason|fallback/i);

for (const route of [
  "if(url.pathname==='/api/admin/ai/skin-product'",
  "if(url.pathname==='/api/admin/ai/studio'",
  "if(url.pathname==='/api/skin-assistant'&&request.method==='POST')",
  "if(url.pathname==='/api/admin/ai/manager/prepare'",
  "if(url.pathname==='/api/admin/ai/store-product'",
  "if(url.pathname==='/api/admin/ai/copy'"
]) {
  const routeStart = worker.indexOf(route);
  assert.ok(routeStart >= 0, `Missing AI route: ${route}`);
  const nextRoute = worker.indexOf("if(url.pathname===", routeStart + route.length);
  const routeBody = worker.slice(routeStart, nextRoute < 0 ? worker.length : nextRoute);
  assert.match(routeBody, /hasNuvoraTextAI\(env\)/, `Text route does not require Workers AI: ${route}`);
}

const runtime = {};
runInNewContext(provider + "\nglobalThis.__runProvider = runNuvoraWorkersAI;", runtime);
const result = await runtime.__runProvider(
  { AI: { run: async (model, payload) => ({ response: '{"provider":"workers-ai"}' }) } },
  "Return JSON only.",
  [{ role: "user", content: "Test" }],
  600
);
assert.equal(result.provider, "cloudflare-workers-ai");
assert.equal(result.raw, '{"provider":"workers-ai"}');
assert.equal(result.model, "@cf/google/gemma-4-26b-a4b-it");

await assert.rejects(
  () => runtime.__runProvider({}, "Return JSON only.", [{ role: "user", content: "Test" }], 600),
  /Cloudflare Workers AI is not connected/
);

assert.match(manager, /Cloudflare Workers AI active/);
assert.match(manager, /configured\.workersAI===true/);
console.log("Workers AI contracts passed: Workers AI-only provider, admin routes, diagnostics and AI Manager status.");
