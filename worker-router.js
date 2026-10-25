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
    "vary": "Origin"
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
      return env.ASSETS.fetch(new Request(new URL("/multi-store-studio.html", request.url), { method: "GET", headers: request.headers }));
    }
    if (studioRoute) {
      return env.ASSETS.fetch(new Request(new URL("/multi-store-studio.html?store=" + studioRoute[1], request.url), { method: "GET", headers: request.headers }));
    }
    const match = url.pathname.match(/^\/api\/(games|home|clothing)-storefront\/?$/);
    if (request.method === "OPTIONS" && match) return json({}, 204);
    if (match) {
      try { return await publicStorefront(request, env, match[1]); }
      catch (error) { return json({ error: "Could not load the requested storefront.", detail: String(error?.message || error).slice(0, 240) }, 502); }
    }
    return worker.fetch(request, env, ctx);
  }
};
