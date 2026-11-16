import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

const provider = section(worker, "async function runNuvoraWorkersAI(", "function parseNuvoraAIJson(");
const claudeAttempt = provider.indexOf("runNuvoraClaude(env,system,messages,maxTokens)");
const workersFallback = provider.indexOf("env.AI.run(model");
assert.ok(claudeAttempt >= 0 && workersFallback > claudeAttempt, "Claude must be attempted before Workers AI fallback.");
assert.match(provider, /provider:'cloudflare-workers-ai-fallback'/);
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

console.log("Claude provider contracts passed: secret-safe configuration, current Messages API headers, Claude-first routing, Workers AI fallback and AI Manager status.");
