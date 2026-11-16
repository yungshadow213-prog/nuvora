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

const claude = section(worker, "async function runNuvoraClaude(", "async function runNuvoraWorkersAI(");
assert.match(claude, /env\?\.ANTHROPIC_API_KEY/);
assert.match(claude, /https:\/\/api\.anthropic\.com\/v1\/messages/);
assert.ok(claude.includes("'authorization':'Bearer '+apiKey"), "Claude API key must be sent as a server-side bearer token.");
assert.match(claude, /anthropic-version':\s*'2026-10-21'/);
assert.match(claude, /claude-sonnet-5-5/);
assert.match(claude, /max_tokens:\s*tokenLimit/);
assert.match(claude, /payload\?\.content/);
assert.doesNotMatch(claude, /temperature\s*:|top_p\s*:|top_k\s*:/, "Claude request must not send removed sampling parameters.");

const textAIAvailability = section(worker, "function hasNuvoraTextAI(", "async function runNuvoraClaude(");
assert.match(textAIAvailability, /ANTHROPIC_API_KEY/);
assert.match(textAIAvailability, /env\?\.AI/);
assert.equal((worker.match(/if\(!env\.AI\)/g) || []).length, 1, "Only image generation may require the Workers AI binding directly.");
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
  assert.match(routeBody, /hasNuvoraTextAI\(env\)/, `Text route does not accept Claude: ${route}`);
}

const provider = section(worker, "async function runNuvoraWorkersAI(", "function parseNuvoraAIJson(");
const claudeAttempt = provider.indexOf("runNuvoraClaude(env,system,messages,maxTokens)");
const workersFallback = provider.indexOf("env.AI.run(model");
assert.ok(claudeAttempt >= 0 && workersFallback > claudeAttempt, "Claude must be attempted before Workers AI fallback.");
assert.ok(provider.includes("provider:claudeError?'cloudflare-workers-ai-fallback':'cloudflare-workers-ai'"), "Provider metadata must distinguish a normal Workers AI response from a fallback.");
assert.match(provider, /fallbackReason/);

const config = section(worker, "function configured(env){", "function randHex(");
assert.ok(config.includes("claude:!!String(e.ANTHROPIC_API_KEY||'').trim()"), "Claude key presence must be reported as a boolean.");
assert.match(config, /primaryTextAIProvider:/);
assert.doesNotMatch(config, /ANTHROPIC_API_KEY\s*:/, "Health/config output must expose only key presence, never the secret.");

const polish = section(worker, "async function aiPolishAmazonListing(", "async function amazonApiFallbackListing(");
assert.ok(polish.indexOf("runNuvoraClaude") < polish.indexOf("OPENAI_API_KEY"), "Listing enrichment must try Claude before legacy OpenAI fallback.");

assert.match(manager, /id="aiProviderPill"/);
assert.match(manager, /async function loadAIProviderStatus\(\)/);
assert.match(manager, /fetch\('\/api\/health'/);
assert.match(manager, /configured\.claude===true/);
assert.match(manager, /Workers AI active · Claude not configured/);

// Exercise provider selection with a mocked Anthropic endpoint; no real key or API call is used.
const runtime = { fetch: async () => ({ ok: true, status: 200, json: async () => ({ model: "claude-sonnet-5-5", content: [{ type: "text", text: '{"source":"claude"}' }] }) }) };
const providerSource = section(worker, "async function runNuvoraClaude(", "function parseNuvoraAIJson(");
runInNewContext(providerSource + "\nglobalThis.__runProvider = runNuvoraWorkersAI;", runtime);
let requestSeen = null;
runtime.fetch = async (url, options) => {
  requestSeen = { url, options };
  return { ok: true, status: 200, json: async () => ({ model: "claude-sonnet-5-5", content: [{ type: "text", text: '{"source":"claude"}' }] }) };
};
const claudeResult = await runtime.__runProvider(
  { ANTHROPIC_API_KEY: "test-only-secret", AI: { run: async () => { throw new Error("Workers AI must not run when Claude succeeds."); } } },
  "Return JSON only.",
  [{ role: "user", content: "Test" }],
  600
);
assert.equal(claudeResult.provider, "anthropic-claude");
assert.equal(claudeResult.raw, '{"source":"claude"}');
assert.equal(requestSeen.url, "https://api.anthropic.com/v1/messages");
assert.equal(requestSeen.options.headers.authorization, "Bearer test-only-secret");
assert.equal(requestSeen.options.headers["anthropic-version"], "2026-10-21");
const requestBody = JSON.parse(requestSeen.options.body);
assert.equal(requestBody.model, "claude-sonnet-5-5");
assert.equal(requestBody.max_tokens, 600);
assert.equal(requestBody.temperature, undefined);

// With no Claude key, Workers AI is the active provider rather than a fallback.
const workersResult = await runtime.__runProvider(
  { AI: { run: async () => ({ response: '{"source":"workers-ai"}' }) } },
  "Return JSON only.",
  [{ role: "user", content: "Test" }],
  600
);
assert.equal(workersResult.provider, "cloudflare-workers-ai");

// When Claude is configured but errors, Workers AI is used automatically.
runtime.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "Invalid test key" } }) });
const fallbackResult = await runtime.__runProvider(
  { ANTHROPIC_API_KEY: "invalid-test-only", AI: { run: async () => ({ response: '{"source":"fallback"}' }) } },
  "Return JSON only.",
  [{ role: "user", content: "Test" }],
  600
);
assert.equal(fallbackResult.provider, "cloudflare-workers-ai-fallback");
assert.match(fallbackResult.fallbackReason, /HTTP 401/);

console.log("Claude provider contracts passed: secret-safe configuration, current Messages API headers, Claude-first routing, Workers AI fallback and AI Manager status.");
