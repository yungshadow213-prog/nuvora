import worker from "./worker.js";

const STORES = {
  games: { config: "games_site_config", products: "games_products" },
  home: { config: "home_site_config", products: "home_products" },
  clothing: { config: "clothing_site_config", products: "clothing_products" }
};
const guardianShortcut = "<style>.nuvora-guardian-shortcut{position:fixed;right:18px;top:18px;z-index:99999;display:flex;align-items:center;gap:8px;padding:10px 13px;border:1px solid #cbdcc7;border-radius:10px;background:#fff;color:#28543a;text-decoration:none;font:750 11px/1.2 system-ui;box-shadow:0 8px 26px #203d3018}.nuvora-guardian-shortcut:hover{background:#edf4e9}@media(max-width:600px){.nuvora-guardian-shortcut{right:10px;top:10px;padding:9px;font-size:10px}}</style><a class=\"nuvora-guardian-shortcut\" href=\"/admin/guardian\">◈ &nbsp; Guardian ↗</a>";
async function withGuardianShortcut(response) {
  if (!(response.headers.get("content-type") || "").includes("text/html")) return response;
  const html = await response.text();
  if (html.includes("nuvora-guardian-shortcut")) return new Response(html, {status:response.status,statusText:response.statusText,headers:response.headers});
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(html.replace("</body>", guardianShortcut + "</body>"), {status:response.status,statusText:response.statusText,headers});
}
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
    "vary": "Origin",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin"
  }
});
async function publicStorefront(request, env, key) {
  const store = STORES[key];
  if (!store || request.method !== "GET") return json({ error: "Not found" }, 404);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Storefront database connection is not configured." }, 503);
  }
  const query = new URLSearchParams({ select: store.config + "," + store.products, id: "eq.true", limit: "1" });
  const response = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/store_settings?" + query.toString(), {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      accept: "application/json"
    }
  });
  if (!response.ok) return json({ error: "The " + key + " storefront configuration is not available yet." }, 503);
  const rows = await response.json();
  const row = Array.isArray(rows) ? rows[0] || {} : {};
  const products = Array.isArray(row[store.products]) ? row[store.products].filter(p => p && String(p.status || "published").toLowerCase() === "published") : [];
  return json({ config: row[store.config] && typeof row[store.config] === "object" ? row[store.config] : {}, products });
}
export default {
  async scheduled(controller, env, ctx) {
    if (typeof worker.scheduled === "function") return worker.scheduled(controller, env, ctx);
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/admin/guardian" || url.pathname === "/admin/guardian/") {
      return worker.fetch(new Request(new URL("/guardian.html", request.url), { method: "GET", headers: request.headers }), env, ctx);
    }
    // Route all studio aliases to the same maintained builder.
    if (url.pathname === "/admin/experiences" || url.pathname === "/admin/experiences/") {
      return withGuardianShortcut(await worker.fetch(new Request(new URL("/experience-studio.html", request.url), { method: "GET", headers: request.headers }), env, ctx));
    }
    if (url.pathname === "/admin/ai-manager" || url.pathname === "/admin/ai-manager/") {
      return withGuardianShortcut(await worker.fetch(new Request(new URL("/ai-manager.html", request.url), { method: "GET", headers: request.headers }), env, ctx));
    }
    const studioRoute = url.pathname.match(/^\/admin\/(gaming|games|home|clothing)-studio\/?$/);
    if (url.pathname === "/admin/studios" || url.pathname === "/admin/studios/") {
      return withGuardianShortcut(await worker.fetch(new Request(new URL("/storefront-studio.html?store=all", request.url), { method: "GET", headers: request.headers }), env, ctx));
    }
    if (studioRoute) {
      const storeKey = studioRoute[1] === "gaming" ? "games" : studioRoute[1];
      return withGuardianShortcut(await worker.fetch(new Request(new URL("/storefront-studio.html?store=" + storeKey, request.url), { method: "GET", headers: request.headers }), env, ctx));
    }
    const match = url.pathname.match(/^\/api\/(games|home|clothing)-storefront\/?$/);
    if (request.method === "OPTIONS" && match) return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
    if (match) {
      try { return await publicStorefront(request, env, match[1]); }
      catch (error) { return json({ error: "Could not load the requested storefront.", detail: String(error?.message || error).slice(0, 240) }, 502); }
    }
    const response = await worker.fetch(request, env, ctx);
    if (request.method === "GET" && ["/admin", "/admin/", "/admin.html", "/admin/skin-studio", "/admin/skin-studio/"].includes(url.pathname) && (response.headers.get("content-type") || "").includes("text/html")) {
      const html = await response.text();
      if (!html.includes("nuvora-multi-studio-launcher")) {
        const guardianNavLink = "<style>.nuvora-guardian-nav-link{display:flex;align-items:center;gap:10px;padding:10px 11px;margin:6px 0 0;border:1px solid #cbdcc7;border-radius:9px;background:#edf4e9;color:#244a34;text-decoration:none;font:750 11px/1.2 system-ui}.nuvora-guardian-nav-link:hover{background:#e1eddf}</style><a class=\"nuvora-guardian-nav-link\" href=\"/admin/guardian\">◈ &nbsp; Nuvora Guardian ↗</a>";
      const experienceLink = '<style>.nuvora-experience-nav-link{display:flex;align-items:center;gap:10px;padding:10px 11px;margin:6px 0 0;border:1px solid #b8cbb9;border-radius:9px;background:#edf4eb;color:#244a34;text-decoration:none;font:750 11px/1.2 system-ui}.nuvora-experience-nav-link:hover{background:#e1eddf}</style><a class="nuvora-experience-nav-link" href="/admin/experiences">◇ &nbsp; Experience Studio ↗</a>';
      const withExperienceLink = html.includes("nuvora-experience-nav-link") ? html : html.replace("</nav>", experienceLink + "</nav>");
      const withGuardianLink = withExperienceLink.includes("nuvora-guardian-nav-link") ? withExperienceLink : withExperienceLink.replace("</nav>", guardianNavLink + "</nav>");
      const updated = withGuardianLink;
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        return new Response(updated, { status: response.status, statusText: response.statusText, headers });
      }
      return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    return response;
  }
};
