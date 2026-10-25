import worker from "./worker.js";

const STORES = {
  games: { config: "games_site_config", products: "games_products" },
  home: { config: "home_site_config", products: "home_products" },
  clothing: { config: "clothing_site_config", products: "clothing_products" }
};
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
  const products = Array.isArray(row[store.products]) ? row[store.products].filter(p => p && p.status === "published") : [];
  return json({ config: row[store.config] && typeof row[store.config] === "object" ? row[store.config] : {}, products });
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const studioRoute = url.pathname.match(/^\/admin\/(gaming|home|clothing)-studio\/?$/);
    if (url.pathname === "/admin/studios" || url.pathname === "/admin/studios/") {
      return worker.fetch(new Request(new URL("/multi-store-studio.html", request.url), { method: "GET", headers: request.headers }), env, ctx);
    }
    if (studioRoute) {
      return worker.fetch(new Request(new URL("/multi-store-studio.html?store=" + studioRoute[1], request.url), { method: "GET", headers: request.headers }), env, ctx);
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
        const launcher = '<style>.nuvora-multi-studio-launcher{position:fixed;right:18px;bottom:18px;z-index:99999;display:flex;align-items:center;gap:8px;padding:11px 14px;border:1px solid #b9cdb8;border-radius:12px;background:#203a2b;color:#fff;text-decoration:none;font:700 11px/1.2 system-ui;box-shadow:0 8px 26px #13271930}.nuvora-multi-studio-launcher:hover{background:#31543c}.skin-studio-fullpage .nuvora-multi-studio-launcher{top:78px;bottom:auto}@media(max-width:600px){.nuvora-multi-studio-launcher{right:10px;bottom:10px;padding:10px;font-size:10px}}</style><a class="nuvora-multi-studio-launcher" href="/admin/studios" aria-label="Open Gaming, Home and Clothing Studios">▦ &nbsp; Gaming · Home · Clothing Studios ↗</a>';
        const updated = html.replace("</body>", launcher + "</body>");
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        return new Response(updated, { status: response.status, statusText: response.statusText, headers });
      }
      return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    return response;
  }
};
