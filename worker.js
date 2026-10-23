
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) {
        const limited = rateLimit(request, 'api', 120, 60000);
        if (limited) return json({error:'Too many requests. Please try again shortly.'},429,{'retry-after':String(limited)});
      }
      if (request.method === 'OPTIONS') return securityResponse(new Response(null,{status:204}));
      if(url.pathname==='/admin/skin-studio'||url.pathname==='/admin/skin-studio/'){
        return serveAsset(env,new Request(new URL('/admin.html',request.url),{method:'GET',headers:request.headers}));
      }
      if (url.pathname === '/admin' || url.pathname === '/admin/') {
        return serveAsset(env,new Request(new URL('/admin.html',request.url), {method:'GET',headers:request.headers}));
      }
      if(url.pathname==='/beauty'||url.pathname==='/beauty/'){
        return serveAsset(env,new Request(new URL('/beauty.html',request.url),{method:'GET',headers:request.headers}));
      }
      const editPageMatch=url.pathname.match(/^\/admin\/products\/([^/]+)\/edit\/?$/);
      if(editPageMatch){
        return serveAsset(env,new Request(new URL('/edit-product.html',request.url), {method:'GET',headers:request.headers}));
      }
      if (url.pathname === '/api/health') {
        const cfg=configured(env)||{};
        let supabaseProjectRef='';
        try{
          const host=new URL(String(env.SUPABASE_URL||'')).hostname.toLowerCase();
          const match=host.match(/^([a-z0-9-]+)\.supabase\.co$/);
          if(match)supabaseProjectRef=match[1];
        }catch(e){}
        return json({
          ok:true,
          release:'nuvora-2026-10-23-manual-import-duplicate-guard-r36',
          supabaseProjectRef,
          configured:cfg&&typeof cfg==='object'?cfg:{}
        });
      }
      if (url.pathname === '/api/config') return json({supabaseUrl:env.SUPABASE_URL||'',supabaseAnonKey:env.SUPABASE_ANON_KEY||''});

      if (url.pathname === '/api/analytics/events' && request.method === 'POST') {
        const wait=rateLimit(request,'analytics',180,60000);
        if(wait) return json({error:'Analytics rate limit reached.'},429,{'retry-after':String(wait)});
        const event=await body(request,128*1024);
        const name=String(event.event_name||'').trim().slice(0,80);
        if(!/^[a-z0-9_.-]+$/.test(name)) return json({error:'Invalid analytics event name.'},400);
        const row={event_name:name,product_id:event.product_id||null,session_id:String(event.session_id||'').slice(0,80)||null,metadata:event.metadata&&typeof event.metadata==='object'?event.metadata:{}};
        const r=await supabaseRest(env,'POST','analytics_events',row);
        if(!r.ok){
          const raw=await r.text();
          const setupMissing=/PGRST205|relation .*analytics_events|table .*analytics_events/i.test(raw);
          return json({
            error:setupMissing?'Analytics database table is not configured yet.':'Analytics event could not be saved.',
            code:setupMissing?'ANALYTICS_NOT_CONFIGURED':'ANALYTICS_WRITE_FAILED'
          },setupMissing?503:400);
        }
        return json({ok:true});
      }

      if(url.pathname==='/api/admin/diagnostics'&&request.method==='GET'){
        const cfg=configured(env)||{};
        const checks={
          environment:!!cfg.supabase,auth:false,admin:false,products:false,productSchema:false,
          settings:false,settingsSchema:false,social:false,analytics:false,
          workersAI:!!cfg.workersAI,shopifyStorefront:!!cfg.shopifyStorefront,
          shopifyEnvironment:!!cfg.shopifyAdmin,shopifyAuth:false,shopifyProducts:false
        };
        // Keep all diagnostic state in one declared object. The admin consumes
        // these as response fields; no browser globals or undeclared variables.
        const diagnosticsState={
          missingProductColumns:[],
          productSchemaError:'',
          settingsSchemaError:'',
          shopifyError:'',
          shopifyMissing:[],
          aiMissing:[]
        };
        if(!env.AI)diagnosticsState.aiMissing.push('Workers AI binding');
        if(!(env.SHOPIFY_SHOP||env.SHOPIFY_STORE_DOMAIN))diagnosticsState.shopifyMissing.push('SHOPIFY_SHOP');
        if(!env.SHOPIFY_CLIENT_ID)diagnosticsState.shopifyMissing.push('SHOPIFY_CLIENT_ID');
        if(!env.SHOPIFY_CLIENT_SECRET)diagnosticsState.shopifyMissing.push('SHOPIFY_CLIENT_SECRET');

        const u=await supabaseUser(request,env);
        checks.auth=!!u;
        if(u&&env.SUPABASE_SERVICE_ROLE_KEY){
          try{
            const pr=await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(u.id)}&select=id,is_admin,role&limit=1`,{headers:sbHeaders(env,true)});
            if(pr.ok){
              const rows=await pr.json();
              const profile=Array.isArray(rows)?rows[0]:null;
              checks.admin=!!profile&&(profile.is_admin===true||profile.role==='admin');
            }
          }catch(e){}

          // Do not use select=* for the products health check: a legacy
          // optional field such as best_for must not make the catalog look
          // offline or block publish. inspectProductSchema checks core fields
          // separately and reports missing optional fields as an advisory.
          const tableChecks=[['store_settings','settings'],['social_posts','social'],['analytics_events','analytics']];
          for(const [table,key] of tableChecks){
            try{
              const rr=await supabaseRest(env,'GET',table,undefined,'?select=*&limit=1');
              checks[key]=rr.ok;
              if(table==='store_settings'&&!rr.ok)diagnosticsState.settingsSchemaError=(await rr.text()).slice(0,800);
            }catch(e){
              if(table==='store_settings')diagnosticsState.settingsSchemaError=String(e?.message||e).slice(0,800);
            }
          }

          const schema=await inspectProductSchema(env).catch(e=>({
            ok:false,core:false,missing:[],message:String(e?.message||e).slice(0,800)
          }));
          checks.products=schema.core===true;
          checks.productSchema=schema.core===true;
          diagnosticsState.missingProductColumns=Array.isArray(schema.missing)?[...new Set(schema.missing.filter(x=>typeof x==='string'))]:[];
          if(!schema.core){
            diagnosticsState.productSchemaError=String(schema.message||'Required product columns are missing or unavailable.').slice(0,800);
          }else if(!schema.ok&&!diagnosticsState.missingProductColumns.length){
            diagnosticsState.productSchemaError=String(schema.message||'Product schema inspection could not finish.').slice(0,800);
          }else{
            // Optional enrichment columns (e.g. best_for) are advisory. Their
            // absence must not mark the core schema unhealthy or block publish.
            diagnosticsState.productSchemaError='';
          }

          // Settings schema is required for the fields presented by the admin.
          // The settings endpoint still provides detailed errors if this probe fails.
          checks.settingsSchema=checks.settings===true;
          if(checks.admin&&checks.shopifyEnvironment){
            try{
              const data=await shopifyGraphql(env,'{ products(first: 1) { edges { node { id title } } } }',{},true);
              checks.shopifyAuth=true;
              checks.shopifyProducts=!!data?.products;
            }catch(e){
              diagnosticsState.shopifyError=String(e?.message||'Shopify authentication failed').slice(0,500);
            }
          }
        }

        const ok=checks.environment&&checks.auth&&checks.admin&&checks.products&&checks.productSchema&&checks.settings&&checks.settingsSchema&&checks.social;
        // Return a single normalized diagnostic contract. Never rely on
        // undeclared legacy variables (the previous UI error was caused by
        // missingProductColumns/productSchemaError escaping their scope).
        const diagnosticPayload={
          missingProductColumns:Array.isArray(diagnosticsState?.missingProductColumns)?diagnosticsState.missingProductColumns:[],
          productSchemaError:String(diagnosticsState?.productSchemaError||''),
          settingsSchemaError:String(diagnosticsState?.settingsSchemaError||''),
          shopifyError:String(diagnosticsState?.shopifyError||''),
          shopifyMissing:Array.isArray(diagnosticsState?.shopifyMissing)?diagnosticsState.shopifyMissing:[],
          aiMissing:Array.isArray(diagnosticsState?.aiMissing)?diagnosticsState.aiMissing:[]
        };
        return json({
          ok:!!ok,
          checks,
          missingProductColumns:diagnosticsState.missingProductColumns||[],
          productSchemaError:diagnosticsState.productSchemaError||'',
          settingsSchemaError:diagnosticsState.settingsSchemaError||'',
          ...diagnosticPayload,
          // Keep a namespaced alias for older admin builds and diagnostics UI.
          schema:{
            missingProductColumns:diagnosticPayload.missingProductColumns,
            productSchemaError:diagnosticPayload.productSchemaError,
            settingsSchemaError:diagnosticPayload.settingsSchemaError
          }
        });
      }

/* Amazon link/import hardening */
// Runtime integration helpers. These live in the Worker so health, diagnostics, Shopify, and legacy Amazon routes never depend on the old Node server.
async function inspectProductSchema(env){
  // Probe core columns as a single query. Publishing cannot proceed without these.
  const core=['id','name','slug','kind','image_url','image_urls','display_price','currency','destination_url','published','created_at','updated_at'];
  const optional=[
    'features','brand','availability','provider','region','category_id','collection_id',
    'why_we_picked_it','best_for','skip_if','last_checked_at','featured','trending','top_pick',
    'amazon_asin','amazon_source_url','source_type','source_sku','sourcinbox_product_url',
    'sourcinbox_product_id','supplier_cost','amazon_last_synced','amazon_current_price',
    'amazon_list_price','amazon_discount_percent','amazon_deal_text','amazon_rating',
    'amazon_review_count','amazon_bought_past_month','amazon_badges','amazon_shipping_text',
    'amazon_tax_text','amazon_variations','source_related_products','source_image_urls',
    'source_url','resolved_url','store_description','temu_source_url','temu_product_id',
    'temu_deal_text','temu_list_price','temu_discount_percent','temu_rating','temu_review_count',
    'deal_text','list_price','discount_percent','rating','review_count',
    'ingredients','usage_instructions','product_warnings','product_size','benefits','skin_types','skin_concerns','recommended_product_ids','recommendation_reason'
  ];
  const query=fields=>'?select='+fields.map(encodeURIComponent).join(',')+'&limit=1';
  const coreRes=await supabaseRest(env,'GET','products',undefined,query(core));
  if(!coreRes.ok){
    const raw=await coreRes.text();
    const missing=[...raw.matchAll(/column products\.([A-Za-z0-9_]+) does not exist/gi)].map(m=>m[1]);
    return {ok:false,core:false,missing:[...new Set(missing)],message:raw.slice(0,800)};
  }

  // Probe optional columns as one select and remove only the missing field named
  // by Postgres/PostgREST. This keeps the diagnostic subrequest count low.
  const remaining=[...optional],missing=[];
  let firstOptionalError='';
  for(let attempt=0;remaining.length&&attempt<=optional.length;attempt++){
    const rr=await supabaseRest(env,'GET','products',undefined,query(remaining));
    if(rr.ok){firstOptionalError='';break;}
    const raw=await rr.text();
    const patterns=[
      /Could not find the '([^']+)' column of 'products'/i,
      /column\s+products\.([A-Za-z_][A-Za-z0-9_]*)\s+does not exist/i,
      /column\s+["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s+of relation\s+["']?products["']?\s+does not exist/i
    ];
    const match=patterns.map(re=>raw.match(re)).find(Boolean);
    const field=match?.[1];
    if(!field||!remaining.includes(field)){
      firstOptionalError=raw.slice(0,800);
      break;
    }
    missing.push(field);
    remaining.splice(remaining.indexOf(field),1);
    if(!firstOptionalError)firstOptionalError=raw.slice(0,800);
  }
  return {ok:true,core:true,missing,message:firstOptionalError};
}
function configured(env){
  const e=env||{};
  const shopDomain=String(e.SHOPIFY_SHOP||e.SHOPIFY_STORE_DOMAIN||'').trim();
  return {
    supabase:!!e.SUPABASE_URL&&!!e.SUPABASE_ANON_KEY&&!!e.SUPABASE_SERVICE_ROLE_KEY,
    shopify:!!shopDomain&&!!e.SHOPIFY_STOREFRONT_ACCESS_TOKEN,
    shopifyStorefront:!!shopDomain&&!!e.SHOPIFY_STOREFRONT_ACCESS_TOKEN,
    shopifyAdmin:!!shopDomain&&!!e.SHOPIFY_ADMIN_ACCESS_TOKEN,
    amazon:!!e.AMAZON_CLIENT_ID&&!!e.AMAZON_CLIENT_SECRET&&!!e.AMAZON_PARTNER_TAG,
    workersAI:!!e.AI
  };
}
function randHex(length=6){const bytes=new Uint8Array(Math.max(1,Math.ceil(length/2)));crypto.getRandomValues(bytes);return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,length);}
function buildProductOptions(text){
  const raw=String(text||''),groups=[];
  const add=(name,value)=>{const n=String(name||'').trim(),v=String(value||'').trim();if(!n||!v||v.length>120)return;let g=groups.find(x=>x.name.toLowerCase()===n.toLowerCase());if(!g){g={name:n,values:[]};groups.push(g);}if(!g.values.includes(v))g.values.push(v);};
  for(const label of ['color','colour','size','style','pattern','material','flavor','flavour','configuration','capacity']){
    const re=new RegExp('\b'+label+'\\s*[:：]\\s*([^\\n;|]+)','gi');
    for(const m of raw.matchAll(re)){m[1].split(/,|\s+\/\s+/).map(v=>v.trim()).filter(Boolean).slice(0,40).forEach(v=>add(label[0].toUpperCase()+label.slice(1),v));}
  }
  return groups.filter(g=>g.values.length).slice(0,12);
}
let amazonTokenCache={value:null,expires:0};
async function getAmazonToken(env){
  const e=env||{};if(amazonTokenCache.value&&Date.now()<amazonTokenCache.expires)return amazonTokenCache.value;
  const endpoint=e.AMAZON_TOKEN_ENDPOINT||'https://api.amazon.com/auth/o2/token';
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'client_credentials',client_id:e.AMAZON_CLIENT_ID,client_secret:e.AMAZON_CLIENT_SECRET,scope:'creatorsapi::default'})});
  const payload=await response.json().catch(()=>({}));if(!response.ok||!payload.access_token)throw new Error('Amazon authentication failed.');
  const ttl=Math.max(60,Number(payload.expires_in)||3600);amazonTokenCache={value:payload.access_token,expires:Date.now()+(ttl-60)*1000};return amazonTokenCache.value;
}
async function amazonGetItem(env,asin){
  const token=await getAmazonToken(env), marketplace=env.AMAZON_MARKETPLACE||'www.amazon.com';
  const payload={itemIds:[String(asin).toUpperCase()],itemIdType:'ASIN',partnerTag:env.AMAZON_PARTNER_TAG,marketplace,resources:['images.primary.large','images.primary.medium','images.variants.large','itemInfo.title','itemInfo.features','itemInfo.byLineInfo','itemInfo.productInfo','offersV2.listings.price','offersV2.listings.availability']};
  const response=await fetch('https://creatorsapi.amazon/catalog/v1/getItems',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-marketplace':marketplace},body:JSON.stringify(payload)});
  const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error('Amazon Creators API returned HTTP '+response.status+'.');return data?.itemsResult?.items?.[0]||null;
}
async function shopifyGraphql(env,query,variables={},admin=false){
  const e=env||{},domain=String(e.SHOPIFY_SHOP||e.SHOPIFY_STORE_DOMAIN||'').trim(),token=admin?String(e.SHOPIFY_ADMIN_ACCESS_TOKEN||''):String(e.SHOPIFY_STOREFRONT_ACCESS_TOKEN||'');
  if(!domain||!token)throw new Error(admin?'Shopify Admin API is not configured.':'Shopify Storefront API is not configured.');
  const version=e.SHOPIFY_API_VERSION||'2026-07',endpoint=(admin?'https://':'https://')+domain+(admin?'/admin/api/':'/api/')+version+'/graphql.json';
  const headers={'content-type':'application/json'};headers[admin?'X-Shopify-Access-Token':'X-Shopify-Storefront-Access-Token']=token;
  const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({query,variables})});const data=await response.json().catch(()=>({}));
  if(!response.ok||Array.isArray(data?.errors)&&data.errors.length)throw new Error(data?.errors?.[0]?.message||'Shopify GraphQL request failed (HTTP '+response.status+').');return data?.data||{};
}
function isValidHttpUrl(value){try{const u=new URL(String(value||'').trim());return u.protocol==='http:'||u.protocol==='https:';}catch{return false;}}
function validURL(value){return isValidHttpUrl(value);}
function resolveProductDestination(current={},patch={}){
  const merged={...current,...patch};
  const candidates=[
    patch.destination_url,current.destination_url,
    patch.amazon_source_url,current.amazon_source_url,
    patch.source_url,current.source_url,
    patch.resolved_url,current.resolved_url
  ];
  for(const value of candidates){
    const raw=String(value||'').trim();
    if(!raw)continue;
    if(isValidHttpUrl(raw))return raw;
    try{
      const normalized=/^(?:amazon(?:\.\w+)?|www\.amazon\.[a-z.]+|amzn\.to|link\.amazon)\//i.test(raw)?'https://'+raw:'';
      if(normalized&&isValidHttpUrl(normalized))return normalized;
    }catch(e){}
    const asin=asinFromUrl(raw);
    if(asin)return 'https://www.amazon.com/dp/'+asin;
  }
  const amazonLike=/amazon/i.test(String(merged.retailer||merged.source_type||''))||!!merged.amazon_asin||!!merged.amazon_source_url||/azon/i.test(String(merged.retailer||''));
  const possibleAsin=merged.amazon_asin||merged.asin||merged.source_sku||merged.source_id;
  if(amazonLike&&/^[A-Z0-9]{10}$/i.test(String(possibleAsin||''))){
    return 'https://www.amazon.com/dp/'+String(possibleAsin).toUpperCase();
  }
  for(const value of [merged.name,merged.source_url,merged.resolved_url]){
    const asin=asinFromUrl(value);
    if(asin&&amazonLike)return 'https://www.amazon.com/dp/'+asin;
  }
  return '';
}
async function publishProductRecord(env,id,patch={}){
  // Read only the core fields first so optional legacy columns never block publish.
  const coreFields=['id','name','slug','kind','image_url','image_urls','description','display_price','currency','destination_url','published','created_at','updated_at'];
  const optionalFields=['retailer','provider','source_type','source_sku','amazon_asin','amazon_source_url','source_url','resolved_url','sourcinbox_product_url','temu_source_url','store_description'];
  const fields=[...coreFields,...optionalFields];
  let current=null,readError='';
  for(let attempt=0;attempt<=optionalFields.length;attempt++){
    const q='?select='+fields.map(encodeURIComponent).join(',')+'&id=eq.'+encodeURIComponent(id)+'&limit=1';
    const response=await supabaseRest(env,'GET','products',undefined,q);
    if(response.ok){
      current=(await response.json())?.[0]||null;
      readError='';
      break;
    }
    const raw=(await response.text().catch(()=>'' )).slice(0,900);
    const match=raw.match(/Could not find the '([^']+)' column of 'products'|column\s+products\.([A-Za-z_][A-Za-z0-9_]*)\s+does not exist/i);
    const missing=match?.[1]||match?.[2];
    if(missing&&optionalFields.includes(missing)&&fields.includes(missing)){
      fields.splice(fields.indexOf(missing),1);
      readError=raw;
      continue;
    }
    return {ok:false,status:500,error:'Could not load the product before publishing.'+(raw?' Database: '+raw:'')};
  }
  if(!current)return {ok:false,status:404,error:'Product not found.'};
  const destination=resolveProductDestination(current,patch);
  const merged={...current,...patch,published:true,destination_url:destination};
  if(!merged.slug||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(String(merged.slug)))merged.slug=makeProductSlug(merged.name||'product');
  if(!merged.destination_url)return {ok:false,status:400,error:'This product has no valid retailer URL. Import the retailer link or provide a destination URL before publishing.'};
  const validation=validateProduct(merged);
  if(validation)return {ok:false,status:400,error:validation};
  const amazonIdentity=asinFromUrl(merged.amazon_source_url||merged.destination_url)||String(merged.amazon_asin||'').trim();
  const amazonLike=/amazon/i.test(String(merged.retailer||merged.source_type||''))||!!amazonIdentity;
  if(amazonLike&&amazonIdentity){
    const duplicateQuery='?select=id,name,amazon_asin,amazon_source_url,destination_url&published=eq.true&id=neq.'+encodeURIComponent(id)+'&or=(amazon_asin.eq.'+encodeURIComponent(amazonIdentity)+',amazon_source_url.ilike.*'+encodeURIComponent(amazonIdentity)+'*,destination_url.ilike.*'+encodeURIComponent(amazonIdentity)+'*)&limit=1';
    const duplicateResponse=await supabaseRest(env,'GET','products',undefined,duplicateQuery);
    if(duplicateResponse.ok){
      const duplicate=(await duplicateResponse.json())?.[0];
      if(duplicate)return {ok:false,status:409,error:'This Amazon product is already published as “'+cleanText(duplicate.name,180)+'”. Unpublish or edit the existing listing instead of publishing a duplicate.'};
    }
  }
  const write={published:true,slug:merged.slug,destination_url:destination,updated_at:new Date().toISOString()};
  if(patch.amazon_source_url||current.amazon_source_url)write.amazon_source_url=patch.amazon_source_url||current.amazon_source_url;
  const result=await supabaseProductWrite(env,'PATCH',write,'?id=eq.'+encodeURIComponent(id));
  if(!result.ok)return {ok:false,status:400,error:await result.text()};
  const rows=await result.json().catch(()=>[]);
  let product=rows[0]||null;
  if(!product||product.published!==true){
    const verify=await supabaseRest(env,'GET','products',undefined,'?select=id,published,slug,destination_url,updated_at&id=eq.'+encodeURIComponent(id)+'&limit=1');
    if(!verify.ok)return {ok:false,status:502,error:'Publish was sent, but Nuvora could not verify the updated product.'};
    product=(await verify.json())?.[0]||null;
  }
  if(!product||product.published!==true)return {ok:false,status:409,error:'Nuvora saved the product but could not confirm it is published. Please try publish again.'};
  return {ok:true,product};
}

function amazonDecode(value){return String(value||'').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&nbsp;/gi,' ');}
function amazonHost(host){
  const h=String(host||'').toLowerCase().replace(/^www\./,'');
  return h==='link.amazon'||h==='amzn.to'||h==='a.co'||h==='amzn.eu'||h==='amzn.in'||h==='amzn.to'||/(^|\.)amazon\.[a-z.]+$/.test(h);
}
function amazonShortHost(host){
  const h=String(host||'').toLowerCase().replace(/^www\./,'');
  return ['link.amazon','amzn.to','a.co','amzn.eu','amzn.in'].includes(h);
}
function extractUrls(value){ const m=String(value||'').match(/https?:\/\/[^\s<>]+/gi)||[]; return [...new Set(m.map(x=>x.replace(/[.,;]+$/,'').trim()).filter(Boolean))]; }
async function resolveAmazonUrl(sourceUrl){
  let current=String(sourceUrl||'').trim();
  for(let i=0;i<5;i++){
    let parsed;
    try{parsed=new URL(current)}catch{break}
    const host=parsed.hostname.toLowerCase().replace(/^www\./,'');
    if(!amazonShortHost(host))return current;
    try{
      const r=await fetch(current,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 Nuvora importer','accept':'text/html,application/xhtml+xml,*/*;q=0.8'}});
      if(r.url&&r.url!==current){current=r.url;continue;}
      break;
    }catch{break}
  }
  return current;
}
function asinFromUrl(url){ const s=String(url||''); const m=s.match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/product\/|\/dp%2F)([A-Z0-9]{10})(?:[/?#]|$)/i); if(m)return m[1].toUpperCase(); const q=s.match(/[?&](?:asin|ASIN)=([A-Z0-9]{10})(?:&|$)/i); return q?q[1].toUpperCase():null; }
function decodeHtmlEntities(value){
  let s=String(value??'');
  const named={
    '&nbsp;':' ','&amp;':'&','&quot;':'"',"&#39;":"'",'&apos;':"'",
    '&lt;':'<','&gt;':'>','&ndash;':'–','&mdash;':'—','&hellip;':'…',
    '&ldquo;':'“','&rdquo;':'”','&lsquo;':'‘','&rsquo;':'’','&bull;':'•','&trade;':'™','&reg;':'®','&copy;':'©'
  };
  s=s.replace(/&(?:nbsp|amp|quot|apos|lt|gt|ndash|mdash|hellip|ldquo|rdquo|lsquo|rsquo|bull|trade|reg|copy);/gi,m=>named[m.toLowerCase()]??m);
  s=s.replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,n)=>{
    const cp=String(n).toLowerCase().startsWith('x')?parseInt(String(n).slice(1),16):parseInt(n,10);
    return Number.isFinite(cp)&&cp>0&&cp<=0x10ffff?String.fromCodePoint(cp):'';
  });
  return s;
}
function htmlText(v){
  let s=String(v??'');
  // Remove markup without inserting spaces inside words split by inline Amazon spans.
  s=s.replace(/<(?:br|p|div|li|tr|td|th|h[1-6]|section|article|ul|ol)[^>]*>/gi,' ');
  s=s.replace(/<[^>]+>/g,'');
  s=decodeHtmlEntities(s);
  return s.replace(/[\\u0000-\\u001F\\u007F]/g,' ').replace(/\s+/g,' ').trim();
}
function metaValue(html,name){
  const wanted=String(name||'').toLowerCase();
  const tags=String(html||'').match(/<meta\b[^>]*>/gi)||[];
  for(const tag of tags){
    const attrs=tag.match(/(?:name|property)\s*=\s*(["'])(.*?)\1/i);
    if(!attrs)continue;
    if(String(attrs[2]).toLowerCase()!==wanted)continue;
    const content=tag.match(/content\s*=\s*(["'])([\s\S]*?)\1/i)||tag.match(/content\s*=\s*([^ >]+)/i);
    if(content)return htmlText(String(content[2]??content[1]).replaceAll('"','').replaceAll("'",""));
  }
  return '';
}
function parseMoney(v){ const m=String(v||'').replace(/,/g,'').match(/([0-9]+(?:\.[0-9]{1,2})?)/); return m?Number(m[1]):null; }
function parseRating(v){ const m=String(v||'').match(/([0-5](?:\.[0-9])?)/); return m?Number(m[1]):null; }
function parsePercent(v){ const m=String(v||'').replace(/,/g,'').match(/([0-9]{1,3}(?:\.[0-9]+)?)\s*%/); return m?Number(m[1]):null; }
function parseReviewCount(v){ const m=String(v||'').replace(/,/g,'').match(/([0-9]{1,9})/); return m?Number(m[1]):null; }
function decodeJsonHtml(value){
  return String(value||'')
    .replace(/&quot;/g,'"').replace(/&#34;/g,'"').replace(/&#39;/g,"'")
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}
function firstJsonLd(html){
  const blocks=String(html||'').match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi)||[];
  for(const block of blocks){
    const raw=block.replace(/^.*?>/,'').replace(/<\/script>\s*$/i,'').trim();
    try{
      const data=JSON.parse(raw);
      const list=Array.isArray(data)?data:[data];
      const product=list.find(x=>String(x?.['@type']||'').toLowerCase()==='product')||list.find(x=>Array.isArray(x?.['@type'])&&x['@type'].some(t=>String(t).toLowerCase()==='product'));
      if(product)return product;
    }catch(e){}
  }
  return null;
}
function amazonStateObjects(html){
  const out=[];
  const re=/<(?:div|span|script)[^>]*(?:data-a-state|data-a-dynamic-image|data-csa-c-type|id=["'](?:centerCol|twister|ppd|availability)["'])[^>]*>/gi;
  const tags=String(html||'').match(re)||[];
  for(const tag of tags){
    const m=tag.match(/data-a-state=["']([^"']+)["']/i);
    if(m){try{out.push(JSON.parse(decodeJsonHtml(m[1])))}catch(e){}}
  }
  return out;
}
function amazonText(html,patterns){
  for(const pattern of patterns){
    const m=String(html||'').match(pattern);
    if(m&&m[1]){const v=htmlText(decodeJsonHtml(m[1]));if(v)return v;}
  }  return '';
}
function extractAmazonSpecs(html){
  const specs=[],seen=new Set();
  const add=(label,value)=>{
    const l=cleanText(htmlText(label),120),v=cleanText(htmlText(value),600);
    if(!l||!v||v===l||seen.has(l.toLowerCase()))return;
    if(/^(?:customer reviews|customer ratings|product details|feedback|questions)$/i.test(l))return;
    seen.add(l.toLowerCase());specs.push([l,v]);
  };
  const tables=String(html||'').match(/<table[^>]*>[\s\S]*?<\/table>/gi)||[];
  for(const table of tables){
    if(!/(productDetails|technical|detail|asin|brand|material|dimension|model)/i.test(table))continue;
    for(const row of table.matchAll(/<tr[^>]*>[\s\S]*?<th[^>]*>([\s\S]*?)<\/th>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi))add(row[1],row[2]);
  }
  const detail=String(html||'').match(/id=["']detailBullets_feature_div["'][^>]*>[\s\S]*?<\/div>/i)?.[0]||'';
  for(const li of detail.matchAll(/<li[^>]*>[\s\S]*?<span[^>]*class=["'][^"']*a-text-bold[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/li>/gi))add(String(li[1]).replace(/[:：]\s*$/,''),li[2]);
  return specs.slice(0,40);
}
function extractAmazonVariations(html,states){
  const out=[],seen=new Set();
  const add=(name,values)=>{
    const n=cleanText(name,80),vs=[...new Set((Array.isArray(values)?values:[values]).map(v=>cleanText(typeof v==='object'?(v?.displayName||v?.name||v?.value):v,100)).filter(Boolean))].slice(0,40);
    if(!n||!vs.length||seen.has(n.toLowerCase()))return;
    seen.add(n.toLowerCase());out.push({name:n,values:vs});
  };
  const visit=obj=>{
    if(!obj||typeof obj!=='object')return;
    if(Array.isArray(obj)){obj.slice(0,100).forEach(visit);return;}
    for(const [k,v] of Object.entries(obj)){
      if(/dimensionValuesDisplayData|variationValuesDisplayData/i.test(k)&&v&&typeof v==='object'){
        if(Array.isArray(v))add(k,v); else for(const [name,vals] of Object.entries(v))if(Array.isArray(vals))add(name,vals);
      }
      visit(v);
    }
  };
  (Array.isArray(states)?states:[]).forEach(visit);
  for(const m of String(html||'').matchAll(/<(?:select|div)[^>]*(?:id|name)=["']variation_([^"']+)["'][^>]*>[\s\S]*?<\/(?:select|div)>/gi)){
    const vals=[...m[0].matchAll(/<option[^>]*>([\s\S]*?)<\/option>/gi)].map(x=>htmlText(x[1])).filter(x=>x&&!/select|choose/i.test(x));
    add(m[1].replace(/[_-]+/g,' '),vals);
  }
  return out.slice(0,20);
}
function extractAmazonSeller(html,jsonld){
  const seller=String(jsonld?.offers?.seller?.name||'').trim();
  return cleanText(seller,180)||amazonText(html,[/id=["']sellerProfileTriggerId["'][^>]*>([\s\S]*?)<\//i,/id=["']sellerName["'][^>]*>([\s\S]*?)<\//i])||null;
}
function extractAmazonBreadcrumb(html){
  const block=String(html||'').match(/id=["']wayfinding-breadcrumbs_feature_div["'][^>]*>[\s\S]*?<\/div>/i)?.[0]||'';
  return [...block.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].map(m=>htmlText(m[1])).filter(Boolean).slice(0,12);
}
function normalizeAmazonListing(listing={}){
  const x={...listing};
  x.title=smartProductTitle(x.title||'Nuvora product',x.brand||'');
  x.images=dedupeImages(x.images,60);
  x.features=Array.isArray(x.features)?[...new Set(x.features.map(v=>cleanText(v,900)).filter(Boolean))].slice(0,40):[];
  x.specifications=Array.isArray(x.specifications)?x.specifications.slice(0,60):[];
  const specLines=x.specifications.map(item=>Array.isArray(item)?cleanMultilineText(String(item[0])+': '+String(item[1]),700):cleanMultilineText(String(item),700)).filter(Boolean).slice(0,30);
  const featureLines=x.features.map(v=>cleanMultilineText(v,900)).filter(v=>v&&!looksFragmentedText(v)).slice(0,18);
  const sourceDescription=cleanMultilineText(x.description,12000)||'';
  const badDescription=/^(?:visit the|shop the|brand:\s|about this item|product description|click to|see more|read more|customer questions|make sure this fits)/i.test(sourceDescription);
  const parts=[];
  if(sourceDescription&&sourceDescription.length>=80&&!badDescription&&!looksFragmentedText(sourceDescription))parts.push(sourceDescription);
  if(featureLines.length)parts.push('Key features: '+featureLines.slice(0,12).join(' • '));
  if(specLines.length)parts.push('Product details: '+specLines.slice(0,20).join(' • '));
  x.features=[...featureLines,...specLines].slice(0,60);
  x.description=cleanMultilineText(parts.join('\n\n'),12000)||null;
  if(x.list_price!=null&&x.current_price!=null&&x.list_price>x.current_price&&x.discount_percent==null)x.discount_percent=Number((((x.list_price-x.current_price)/x.list_price)*100).toFixed(1));
  if(x.discount_percent!=null&&x.discount_percent>0&&x.discount_percent<100&&!x.list_price&&x.current_price)x.list_price=Number((x.current_price/(1-x.discount_percent/100)).toFixed(2));
  // Preserve skincare facts only when the source explicitly provides them.
  const sourceFacts=[sourceDescription,...featureLines,...specLines].filter(Boolean).join('\n');
  const factAfter=labels=>{
    const match=sourceFacts.match(new RegExp('(?:^|\\n|\\s)(?:'+labels.join('|')+')\\s*[:：-]\\s*([^\\n]{8,900})','i'));
    return match?cleanMultilineText(match[1],900):null;
  };
  x.ingredients=x.ingredients||factAfter(['ingredients?','full ingredients?','active ingredients?','ingredient list']);
  x.usage_instructions=x.usage_instructions||factAfter(['directions','how to use','suggested use','usage instructions','application']);
  x.product_warnings=x.product_warnings||factAfter(['warnings?','caution','precautions','safety information']);
  x.product_size=x.product_size||factAfter(['item volume','net content','size','product size','capacity','weight']);
  x.brand=cleanText(x.brand,180)||null;x.seller=cleanText(x.seller,300)||null;
  return x;
}
async function aiPolishAmazonListing(env,listing){
  if(!listing?.title)return listing;
  const facts={title:listing.title,brand:listing.brand,description:listing.description,features:listing.features,specifications:listing.specifications,current_price:listing.current_price,list_price:listing.list_price,discount_percent:listing.discount_percent,rating:listing.rating,review_count:listing.review_count,availability:listing.availability,shipping_text:listing.shipping_text,category_path:listing.category_path};
  const system='You clean ecommerce source data for Nuvora. Return ONLY valid JSON with title and description. Use ONLY facts present in the supplied data. Do not invent, infer, add specifications, compatibility, materials, sizes, guarantees, certifications, discounts, or performance claims. Preserve important measurements, model numbers, quantities and factual product attributes. Remove retailer boilerplate, keyword spam and broken wording. Make the title natural and specific, maximum 120 characters. Make the description clear, useful and 80-180 words when enough source facts exist. If the source lacks facts, keep the description short rather than inventing.';
  try{
    const key=String(env?.OPENAI_API_KEY||'').trim();
    let raw='';
    if(key){
      const resp=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+key},body:JSON.stringify({model:'gpt-4o-mini',temperature:0,response_format:{type:'json_object'},messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(facts).slice(0,22000)}]})});
      if(resp.ok){const data=await resp.json();raw=String(data?.choices?.[0]?.message?.content||'').trim();}
    }else if(env?.AI){
      const resp=await env.AI.run('@cf/google/gemma-4-26b-a4b-it',{messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(facts).slice(0,18000)}],chat_template_kwargs:{enable_thinking:false}});
      raw=String(resp?.response||resp?.choices?.[0]?.message?.content||'').trim();
    }
    if(!raw)return listing;
    const clean=raw.replace(/^\`\`\`(?:json)?\s*/i,'').replace(/\s*\`\`\`$/,'').trim();
    const p=JSON.parse(clean);
    if(typeof p.title==='string'&&p.title.trim()&&!looksFragmentedText(p.title)){
      const polished=smartProductTitle(p.title,listing.brand||'');
      if(polished&&polished.length>=8)listing.title=polished;
    }
    if(typeof p.description==='string'&&p.description.trim()&&!looksFragmentedText(p.description)){
      const desc=cleanMultilineText(p.description,12000);
      if(desc.length>=40)listing.description=desc;
    }
  }catch(e){}
  return listing;
}

async function amazonApiFallbackListing(env,asin,sourceUrl){
  if(!configured(env).amazon)return null;
  try{
    const item=await amazonGetItem(env,asin);
    if(!item)return null;
    const listing=item.offersV2?.listings?.[0];
    const money=listing?.price?.money;
    const images=[
      item.images?.primary?.large?.url,
      item.images?.primary?.medium?.url,
      ...(item.images?.variants||[]).flatMap(v=>[v?.large?.url,v?.medium?.url])
    ].filter(Boolean);
    const features=item.itemInfo?.features?.displayValues||[];
    const brand=item.itemInfo?.byLineInfo?.brand?.displayValue||item.itemInfo?.byLineInfo?.manufacturer?.displayValue||'';
    return normalizeAmazonListing({
      title:item.itemInfo?.title?.displayValue||'Amazon product',
      description:features.join('\n')||null,
      brand,
      images,
      features,
      current_price:money?.amount??null,
      list_price:null,
      discount_percent:null,
      deal_text:null,
      rating:null,
      review_count:null,
      availability:listing?.availability?.displayValue||listing?.availability?.type||null,
      shipping_text:null,
      tax_text:null,
      variations:[],
      sku:asin,
      destination_url:item.detailPageURL||sourceUrl,
      resolved_url:item.detailPageURL||sourceUrl,
      asin
    });
  }catch{return null}
}

async function scrapeAmazonListing(sourceUrl,asin,env){
  const resolved=await resolveAmazonUrl(sourceUrl);
  const finalAsin=asinFromUrl(resolved)||asin;
  if(!finalAsin)return {error:'Could not find an ASIN after resolving the Amazon link.'};

  let html='';
  try{
    const r=await fetch(resolved,{redirect:'follow',headers:{
      'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154 Safari/537.36',
      'accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'accept-language':'en-US,en;q=0.9',
      'cache-control':'no-cache'
    }});
    if(!r.ok)throw new Error('Amazon returned HTTP '+r.status);
    html=await r.text();
  }catch(e){
    const fallback=await amazonApiFallbackListing(env,finalAsin,sourceUrl);
    if(fallback)return fallback;
    return {error:'Amazon product page could not be read: '+String(e?.message||e)};
  }

  const clean=htmlText;
  const jsonld=firstJsonLd(html)||{};
  const states=amazonStateObjects(html);
  const brandHint=typeof jsonld.brand==='string'?jsonld.brand:String(jsonld.brand?.name||'');

  const escapeRegex=(value)=>String(value).replace(/[.*+?^{}()|[\]\\$]/g,'\\$&');
      const elementInnerHtmlById=(id)=>{
    const esc=escapeRegex(id);
    const openRe=new RegExp(String.raw`<([a-z][a-z0-9:-]*)\\b[^>]*\\bid=["']${esc}["'][^>]*>`,"i");
    const open=String(html).match(openRe);
    if(!open||open.index==null)return '';
    const tag=open[1],contentStart=open.index+open[0].length;
    const tagRe=new RegExp(String.raw`<\\/?${escapeRegex(tag)}\\b[^>]*>`,"gi");
    tagRe.lastIndex=contentStart;
    let depth=1,match;
    while((match=tagRe.exec(html))){
      const token=match[0];
      if(token.indexOf("</")===0)depth--;
      else if(token.endsWith("/>"))continue;
      else depth++;
      if(depth===0)return String(html).slice(contentStart,match.index);
    }
    return String(html).slice(contentStart);
  };
  const textById=(id)=>{const inner=elementInnerHtmlById(id);return inner?clean(inner):'';};
  const blockById=(id)=>{const inner=elementInnerHtmlById(id);return inner?clean(inner):'';};
  const extractFirst=(patterns)=>{
    for(const re of patterns){
      const m=String(html).match(re);
      if(m&&m[1]){
        const v=clean(decodeJsonHtml(m[1]));
        if(v)return v;
      }
    }
    return '';
  };
  const extractAll=(re,limit=20)=>{
    const out=[];
    for(const m of String(html).matchAll(re)){
      const v=clean(decodeJsonHtml(m[1]||m[0]));
      if(v&&!out.includes(v))out.push(v);
      if(out.length>=limit)break;
    }
    return out;
  };
  const firstNumber=(value)=>{
    const m=String(value||'').replace(/,/g,'').match(/[0-9]+(?:\.[0-9]+)?/);
    return m?Number(m[0]):null;
  };
  const extractReviewCount=(value)=>{
    const m=String(value||'').replace(/,/g,'').match(/([0-9]{1,9})\s*(?:global ratings|ratings|reviews|reviews?)/i);
    return m?Number(m[1]):null;
  };
  const extractRating=(value)=>{
    const s=String(value||'');
    const m=s.match(/([0-5](?:\.[0-9])?)/);
    const n=m?Number(m[1]):null;
    return n!=null&&n<=5?n:null;
  };
  const extractPrice=(value)=>{
    const s=String(value||'').replace(/,/g,' ');
    const m=s.match(/([0-9]+(?:\.[0-9]{1,2})?)/);
    return m?Number(m[1]):null;
  };

  const titleCandidates=[
    extractFirst([
      /id=["']productTitle["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
      /id=["']productTitle["'][^>]*>([\s\S]*?)<\/h1>/i,
      /id=["']productTitle["'][^>]*>([\s\S]*?)<\/div>/i
    ]),
    String(jsonld.name||'').trim(),
    metaValue(html,'og:title'),
    metaValue(html,'twitter:title'),
    clean((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)||[])[1]||''),
    clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'')
  ].map(clean).filter(Boolean);
  const title=titleCandidates.find(v=>v.length>brandHint.length+8&&!/^amazon(?:\\.com)?$/i.test(v)&&!/sign in|page not found/i.test(v)&&!looksFragmentedText(v))
    ||titleCandidates.find(v=>!looksFragmentedText(v)&&v.length>8)||'';

  const featureMatches=String(html).match(/id=["']feature-bullets["'][^>]*>[\s\S]*?<li[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/gi)||[];
  const features=[...new Set(featureMatches.map(x=>clean(x.replace(/^.*?<span[^>]*>/i,'').replace(/<\/span>[\s\S]*$/i,'')).trim()).filter(v=>v&&v.length>8&&!/^skip to/i.test(v)))].slice(0,20);
  const descriptionCandidates=[
    blockById('productDescription'),
    blockById('productDescription_feature_div'),
    blockById('aplus_feature_div'),
    clean(jsonld.description||''),
    metaValue(html,'og:description'),
    metaValue(html,'description')
  ].map(clean).filter(v=>v&&v.length>20);
  const boilerplate=/^(?:visit the|shop the|brand:\s|about this item|product description|click to|see more|read more|customer questions|make sure this fits|customers say|frequently bought)/i;
  const navigationJunk=/\b(?:search|keyboard shortcuts|skip to|sign in|create account|orders|cart|today'?s deals|best sellers|new releases|customer service|gift cards|all departments|back to top|deliver to|update location|sponsored)\b/i;
  const normalizedTitle=String(title||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const normalizedBrand=String(brandHint||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const usableDescription=v=>{
    const raw=clean(v).replace(/\s+/g,' ').trim();
    const x=raw.toLowerCase();
    const compact=x.replace(/[^a-z0-9]+/g,' ').trim();
    if(!x||x.length<40||compact===normalizedBrand||compact===normalizedTitle)return false;
    if(boilerplate.test(x)||navigationJunk.test(x.slice(0,180)))return false;
    if(x.split(' ').length<8)return false;
    return true;
  };
  const descriptionParts=[];
  for(const candidate of descriptionCandidates){
    if(!usableDescription(candidate))continue;
    const cleaned=clean(candidate);
    if(!descriptionParts.some(existing=>existing.toLowerCase()===cleaned.toLowerCase()))descriptionParts.push(cleaned);
  }
  const cleanFeatures=features.map(v=>clean(v)).filter(v=>v.length>=12&&!boilerplate.test(v)&&!navigationJunk.test(v.slice(0,180))).slice(0,12);
  if(cleanFeatures.length)descriptionParts.push('Key features: '+cleanFeatures.join(' • '));
  let description=descriptionParts.join('\n\n').slice(0,12000)||null;

  const imageCandidates=[];
  const addImage=v=>{
    if(typeof v!=='string')return;
    const decoded=decodeJsonHtml(v);
    if(isValidHttpUrl(decoded)&&!imageCandidates.includes(decoded))imageCandidates.push(decoded);
  };
  if(Array.isArray(jsonld.image))jsonld.image.forEach(addImage); else addImage(jsonld.image);
  addImage(metaValue(html,'og:image'));
  addImage(metaValue(html,'twitter:image'));
  for(const tag of String(html).match(/data-a-dynamic-image=["'][^"']+["']/gi)||[]){
    const m=tag.match(/data-a-dynamic-image=["']([^"']+)["']/i);
    if(m){
      try{
        const obj=JSON.parse(decodeJsonHtml(m[1]));
        Object.keys(obj||{}).forEach(addImage);
      }catch(e){}
    }
  }
  for(const m of String(html).matchAll(/(?:data-old-hires|data-src|data-lazy-src)=["'](https?:\/\/[^"']+)["']/gi))addImage(m[1]);

  const brand=clean(typeof jsonld.brand==='string'?jsonld.brand:jsonld.brand?.name
    ||extractFirst([
      /id=["']bylineInfo["'][^>]*>([\s\S]*?)<\/a>/i,
      /id=["']brand["'][^>]*>([\s\S]*?)<\/span>/i
    ])||'').replace(/^visit the\s+/i,'').replace(/\s+store$/i,'').trim();

  const offers=Array.isArray(jsonld.offers)?(jsonld.offers[0]||{}):(jsonld.offers||{});
  const priceSources=[
    offers.price,
    metaValue(html,'product:price:amount'),
    extractFirst([
      /class=["'][^"']*a-price-whole[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
      /id=["']priceblock_dealprice["'][^>]*>([\s\S]*?)<\//i,
      /id=["']priceblock_ourprice["'][^>]*>([\s\S]*?)<\//i,
      /id=["']corePrice_feature_div["'][^>]*>([\s\S]*?)<\/div>/i,
      /class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
    ])
  ];
  let currentPrice=null;
  for(const v of priceSources){const n=extractPrice(v);if(n!=null){currentPrice=n;break;}}
  const currency=String(offers.priceCurrency||metaValue(html,'product:price:currency')||'USD').toUpperCase();

  let listPrice=null;
  const listSources=[
    extractFirst([
      /class=["'][^"']*a-text-price[^"']*["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
      /id=["']listPrice["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
      /class=["'][^"']*(?:basis-price|priceBlockStrikePriceString)[^"']*["'][^>]*>([\s\S]*?)<\//i
    ]),
    metaValue(html,'product:original_price')
  ];
  for(const v of listSources){const n=extractPrice(v);if(n!=null){listPrice=n;break;}}
  const discountText=extractFirst([
    /id=["']couponText["'][^>]*>([\s\S]*?)<\/span>/i,
    /class=["'][^"']*savingsPercentage[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    /class=["'][^"']*dealBadge[^"']*["'][^>]*>([\s\S]*?)<\//i,
    /((?:limited\s+time\s+deal|deal\s+of\s+the\s+day|coupon)[^<]{0,120})/i
  ]);
  let discountPercent=discountText?parsePercent(discountText):null;
  if(listPrice==null&&currentPrice!=null&&discountPercent!=null&&discountPercent>0&&discountPercent<100){
    listPrice=Number((currentPrice/(1-discountPercent/100)).toFixed(2));
  }
  if(discountPercent==null&&listPrice!=null&&currentPrice!=null&&listPrice>currentPrice){
    discountPercent=Number((((listPrice-currentPrice)/listPrice)*100).toFixed(1));
  }

  const rating=extractRating(jsonld.aggregateRating?.ratingValue)
    ??extractRating(metaValue(html,'ratingValue'))
    ??extractRating(extractFirst([
      /id=["']acrPopover["'][^>]*title=["']([^"']+)["']/i,
      /data-hook=["']rating-out-of-text["'][^>]*>([\s\S]*?)<\//i,
      /aria-label=["']([0-5](?:\.[0-9])?)\s*(?:out of 5 stars?|stars?)[^"']*["']/i
    ]))
    ??extractRating(String(html).match(/([0-5](?:\.[0-9])?)\s+out of 5 stars/i)?.[1]);

  const reviewText=extractFirst([
    /id=["']acrCustomerReviewText["'][^>]*>([\s\S]*?)<\/span>/i,
    /data-hook=["']total-review-count["'][^>]*>([\s\S]*?)<\//i
  ]);
  const aggregateReviewCount=firstNumber(jsonld.aggregateRating?.reviewCount ?? jsonld.aggregateRating?.ratingCount);
  const reviewCount=aggregateReviewCount
    ??extractReviewCount(reviewText)
    ??extractReviewCount(String(html).match(/([0-9][0-9,.]*)\s+(?:global ratings|ratings|reviews)/i)?.[0]||'');

  const availability=clean(offers.availability||'')
    ||extractFirst([
      /id=["']availability["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
      /id=["']outOfStock["'][^>]*>([\s\S]*?)<\/div>/i,
      /id=["']availabilityInsideBuyBox_feature_div["'][^>]*>([\s\S]*?)<\/div>/i
    ])||null;
  const shippingText=extractFirst([
    /id=["']mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
    /id=["']deliveryBlockMessage["'][^>]*>([\s\S]*?)<\/span>/i,
    /data-csa-c-delivery-time=["']([^"']+)["']/i,
    /class=["'][^"']*delivery-message[^"']*["'][^>]*>([\s\S]*?)<\//i  ])||null;
  const boughtPastMonth=extractFirst([
    /id=["']socialProofingAsinFacepileFeature["'][^>]*>[\s\S]*?([0-9,.]+\+?\s*(?:bought|purchased)[^<]*)/i,
    /([0-9,.]+\+?\s+bought in past month)/i
  ])||null;
  const taxText=extractFirst([
    /id=["']taxInclusiveMessage["'][^>]*>([\s\S]*?)<\/span>/i,
    /id=["']taxMessage["'][^>]*>([\s\S]*?)<\/span>/i
  ])||null;

  const sku=String(jsonld.sku||jsonld.mpn||'').trim()
    ||extractFirst([/id=["']productDetails["'][^>]*>[\s\S]*?(?:ASIN|Item model number)[^<]*<[^>]*>([A-Z0-9._-]+)/i])
    ||null;

  const variantNames=[];
  for(const state of states){
    const raw=JSON.stringify(state);
    if(/dimension|variation|size|color/i.test(raw)&&raw.length<100000)variantNames.push(state);
  }

  if(!title&&!imageCandidates.length){
    const fallback=await amazonApiFallbackListing(env,finalAsin,sourceUrl);
    if(fallback)return fallback;
    return {error:'Amazon did not expose product data from this page. Amazon may have served a bot-check page; try the direct product URL or configure the Amazon API as an optional fallback.'};
  }

  return {
    title:title||'Amazon product',
    description:description||null,
    brand:brand||null,
    images:dedupeImages(imageCandidates,60),
    features,
    current_price:currentPrice,
    list_price:listPrice,
    discount_percent:discountPercent,
    deal_text:discountText||null,
    rating,
    review_count:reviewCount,
    bought_past_month:boughtPastMonth,
    shipping_text:shippingText,
    tax_text:taxText,
    availability,
    sku,
    currency,
    destination_url:resolved,
    resolved_url:resolved,
    asin:finalAsin,
    related_products:extractRelatedAmazonProducts(html,finalAsin),
    specifications:extractAmazonSpecs(html),
    variations:extractAmazonVariations(html,states),
    seller:extractAmazonSeller(html,jsonld),
    category_path:extractAmazonBreadcrumb(html)
  };
}
function autoCategory(title='',description='',brand='',categories=[]){
  const text=(String(title)+' '+String(description)+' '+String(brand)).toLowerCase();
  const aliases={
    electronics:['electronics','electronic','gadget','computer','laptop','tablet','phone','mobile','headphone','earbud','keyboard','mouse','monitor','camera'],
    fashion:['fashion','clothing','shirt','dress','shoe','sneaker','jacket','hoodie','jeans','baby clothes','women','men','kids'],
    beauty:['beauty','skincare','skin care','makeup','cosmetic','hair','shampoo','serum','lotion'],
    home:['home','kitchen','furniture','decor','storage','organizer','bedding','bathroom'],
    fitness:['fitness','gym','exercise','yoga','workout','sports'],
    toys:['toy','toys','game','kids','children','puzzle'],
    baby:['baby','infant','toddler','newborn','maternity'],
    pets:['pet','dog','cat','puppy','kitten','animal']
  };
  for(const cat of (Array.isArray(categories)?categories:[])){
    const hay=(String(cat.name||'')+' '+String(cat.slug||'')).toLowerCase().replace(/-/g,' ');
    if(hay&&text.includes(hay))return cat.id||null;
  }
  const skinCategory=(Array.isArray(categories)?categories:[]).find(cat=>/skin\s*care|skincare/i.test(String(cat.name||'')+' '+String(cat.slug||'')));
  if(skinCategory&&/\b(?:skin|skincare|serum|moisturizer|moisturiser|cleanser|sunscreen|spf|toner|essence|retinol|niacinamide|hyaluronic|beauty|glass skin)\b/i.test(text))return skinCategory.id||null;
  for(const [group,words] of Object.entries(aliases)){
    if(words.some(w=>text.includes(w))){
      const cat=(Array.isArray(categories)?categories:[]).find(x=>String(x.name||'').toLowerCase().includes(group)||String(x.slug||'').toLowerCase().includes(group));
      if(cat)return cat.id||null;
    }
  }
  return null;
}
function cleanImportedTitle(value,brand=''){
  let t=amazonDecode(value).replace(/\s+/g,' ').trim();
  if(looksFragmentedText(t)||productTitleQualityIssue(t))return '';
  t=t.replace(/^Amazon\.com\s*[:|-]\s*/i,'').replace(/\s*[|·]\s*(?:Amazon|Temu)\s*$/i,'');
  t=t.replace(/^\s*(?:Visit the|Shop)\s+[^:]{1,80}\s*(?:Store|Brand)?\s*[:|-]\s*/i,'');
  t=t.replace(/\b(?:official|best seller|#1 best seller|hot sale|trending|must have)\b/gi,'');
  const words=t.split(' ').filter(Boolean),seen=new Set(),kept=[];
  for(const word of words){
    const key=word.toLowerCase().replace(/[^a-z0-9]/g,'');
    if(key&&seen.has(key))continue;
    if(key)seen.add(key);
    kept.push(word);
  }
  t=kept.join(' ').replace(/\s{2,}/g,' ').replace(/\s+([,.:;])/g,'$1').trim();
  if(t===t.toLowerCase())t=t.replace(/\b[a-z]/g,c=>c.toUpperCase());
  return t.slice(0,180);
}
function normalizeImageUrl(value){
  try{
    const u=new URL(String(value||'').trim());
    u.hash='';
    if(/(^|\.)amazon\./i.test(u.hostname))u.search='';
    return u.toString();
  }catch{return String(value||'').trim()}
}
function dedupeImages(values,max=60){
  const out=[],seen=new Set();
  const blocked=/(?:amazon-avatars-global|transparent-pixel|aax-[^/]+\/e\/is\/|\/nav[-_]|sprite|spacer|pixel\b|tracking)/i;
  for(const value of (Array.isArray(values)?values:[])){
    const url=normalizeImageUrl(value);
    if(!isValidHttpUrl(url)||blocked.test(url))continue;
    const key=url.toLowerCase().replace(/\.(?:jpe?g|png|webp)(?:$|[?#])/i,'');
    if(seen.has(key))continue;
    seen.add(key);out.push(url);
    if(out.length>=max)break;
  }
  return out;
}
function smartProductTitle(value,brand=''){
  let t=htmlText(amazonDecode(value)).replace(/\s+/g,' ').trim();
  if(looksFragmentedText(t)||productTitleQualityIssue(t))return '';
  t=t.replace(/^(?:Amazon\.com|Amazon)\s*[:|-]\s*/i,'');
  t=t.replace(/\s*[|·]\s*(?:Amazon|Temu).*$/i,'');
  t=t.replace(/\b(?:official|best seller|#1 best seller|hot sale|trending|must have|new arrival)\b/gi,'');
  t=t.replace(/\s{2,}/g,' ').trim();
  const b=cleanText(brand,120);
  if(b&&!t.toLowerCase().startsWith(b.toLowerCase()))t=b+' '+t;
  const words=t.split(' ').filter(Boolean),seen=new Set(),kept=[];
  for(const word of words){
    const key=word.toLowerCase().replace(/[^a-z0-9]/g,'');
    if(key&&seen.has(key))continue;
    if(key)seen.add(key);
    kept.push(word);
  }
  t=kept.join(' ').replace(/\s+([,.:;])/g,'$1').trim();
  if(t===t.toLowerCase())t=t.replace(/\b[a-z]/g,c=>c.toUpperCase());
  return t.slice(0,180)||'Nuvora product';
}
function extractRelatedAmazonProducts(html,asin){
  const out=[],seen=new Set(),add=id=>{
    id=String(id||'').toUpperCase();
    if(/^[A-Z0-9]{10}$/.test(id)&&id!==String(asin||'').toUpperCase()&&!seen.has(id)){
      seen.add(id);out.push(id);
    }
  };
  for(const m of String(html||'').matchAll(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\?asin=|"asin"\s*:\s*")([A-Z0-9]{10})/gi))add(m[1]);
  return out.slice(0,20);
}
function normalizeAmazonProduct(product={}){
  const images=dedupeImages(Array.isArray(product.image_urls)?product.image_urls:(isValidHttpUrl(product.image_url)?[product.image_url]:[]),60);
  const rawName=smartProductTitle(product.name||'Nuvora product',product.brand||'');
  const description=cleanMultilineText(product.description,12000)||null;
  const features=cleanMultilineText(product.features,12000)||null;
  return {
    name:rawName||'Nuvora product',
    brand:cleanText(product.brand,180)||null,
    description,
    features,
    image_url:images[0]||null,
    image_urls:images,
    display_price:product.display_price??null,
    currency:product.currency||'USD',
    rating:product.amazon_rating??null,
    review_count:product.amazon_review_count??null,
    deal:product.amazon_deal_text||null
  };
}
/* Universal source-ingestion engine */
function sourceHost(value){try{return new URL(value).hostname.toLowerCase().replace(/^www\./,'')}catch{return ''}}
function detectRetailer(value){
  const h=sourceHost(value);
  if(amazonHost(h))return 'Amazon';
  if(h==='temu.com'||h.endsWith('.temu.com')||h==='temu.to')return 'Temu';
  if(h==='app.sourcinbox.com'||h.endsWith('.sourcinbox.com'))return 'Source Box';
  if(/aliexpress\./i.test(h))return 'AliExpress';
  if(/shopify\./i.test(h))return 'Shopify';
  return 'Web source';
}
function sourceProductId(url,html=''){
  const u=String(url||'');
  const patterns=[
    /(?:\/dp\/|\/gp\/product\/|\/product\/|\/item\/|\/p\/)([A-Z0-9_-]{5,40})(?:[/?#]|$)/i,
    /[?&](?:id|product_id|productId|sku|item_id|itemId)=([^&#]+)/i
  ];
  for(const re of patterns){const m=u.match(re);if(m)return decodeURIComponent(m[1]).slice(0,120)}
  const metas=['product:retailer_item_id','product:sku','sku','product_id','productid'];
  for(const n of metas){const v=metaValue(html,n);if(v)return v.slice(0,120)}
  const m=String(html).match(/["'](?:sku|productId|product_id|item_id)["']\s*:\s*["']([^"']{4,120})["']/i);
  return m?m[1]:null;
}
function genericJsonLd(html){
  const out=[];
  const re=/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for(const m of String(html||'').matchAll(re)){try{const x=JSON.parse(m[1].trim());if(Array.isArray(x))out.push(...x);else out.push(x)}catch(e){}}
  return out.find(x=>{const t=x?.['@type'];return t==='Product'||(Array.isArray(t)&&t.some(v=>String(v).toLowerCase()==='product'))})||{};
}
function genericImages(html,ld){
  const out=[]; const add=v=>{if(typeof v==='string'&&isValidHttpUrl(v)&&!out.includes(v))out.push(v)};
  const xs=Array.isArray(ld.image)?ld.image:(ld.image?[ld.image]:[]);xs.forEach(add);
  add(metaValue(html,'og:image'));add(metaValue(html,'twitter:image'));
  for(const m of String(html||'').matchAll(/(?:data-src|data-lazy-src|src)=["'](https?:\/\/[^"']+)["']/gi))add(m[1]);
  return dedupeImages(out,60);
}
function genericNumber(v){const m=String(v??'').replace(/,/g,'').match(/(?:[$€£₦]|USD|EUR|GBP|NGN|US\$)?\s*([0-9]+(?:\.[0-9]{1,2})?)/);return m?Number(m[1]):null}
async function scrapeGenericSource(sourceUrl,retailer){
  let resolved=sourceUrl;
  try{const r=await fetch(sourceUrl,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (compatible; NuvoraImporter/1.0)','accept':'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8','accept-language':'en-US,en;q=0.9'}});resolved=r.url||sourceUrl;if(!r.ok)throw new Error('Source returned HTTP '+r.status);const html=await r.text();if(html.length<200)throw new Error('Source page returned too little data.');
    const ld=genericJsonLd(html),offers=Array.isArray(ld.offers)?(ld.offers[0]||{}):(ld.offers||{}),agg=ld.aggregateRating||{};
    const title=htmlText(ld.name)||metaValue(html,'og:title')||metaValue(html,'twitter:title')||amazonText(html,[/<h1[^>]*>([\s\S]*?)<\/h1>/i])||htmlText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'');
    const description=htmlText(ld.description)||metaValue(html,'og:description')||metaValue(html,'description');
    const brand=typeof ld.brand==='string'?ld.brand:ld.brand?.name||metaValue(html,'product:brand')||metaValue(html,'brand')||null;
    const current=genericNumber(offers.price)??genericNumber(metaValue(html,'product:price:amount'))??genericNumber(amazonText(html,[/(?:class|id)=["'][^"']*(?:price|sale-price|current-price)[^"']*["'][^>]*>([\s\S]*?)<\//i]));
    const currency=String(offers.priceCurrency||metaValue(html,'product:price:currency')||'USD').toUpperCase();
    const list=genericNumber(metaValue(html,'product:original_price'))??genericNumber(amazonText(html,[/(?:class|id)=["'][^"']*(?:compare|original|regular)-price[^"']*["'][^>]*>([\s\S]*?)<\//i]));
    const rating=parseRating(agg.ratingValue||metaValue(html,'ratingValue')||amazonText(html,[/(?:rating|stars)[^>]*>([0-5](?:\.[0-9])?)/i]));
    const reviews=parseReviewCount(agg.reviewCount||agg.ratingCount||metaValue(html,'reviewCount')||amazonText(html,[/([0-9][0-9,.]*)\s+(?:reviews|ratings)/i]));
    const availability=htmlText(offers.availability)||metaValue(html,'product:availability')||amazonText(html,[/(?:availability|stock)[^>]*>([\s\S]*?)<\//i])||null;
    const sku=String(ld.sku||ld.mpn||sourceProductId(resolved,html)||'').trim()||null;
    const features=[];
    for(const m of String(html).matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)){const t=htmlText(m[1]);if(t&&t.length<500&&!features.includes(t))features.push(t);if(features.length>=20)break}
    const listPrice=list??(current!=null&&rating==null?null:list);
    const discount=listPrice&&current!=null&&listPrice>current?Number((((listPrice-current)/listPrice)*100).toFixed(1)):null;
    if(!title&&!genericImages(html,ld).length)throw new Error('No product data was exposed by the source page.');
    return {title:title||retailer+' product',description:description||null,brand:brand||null,images:genericImages(html,ld),features,current_price:current,list_price:listPrice,discount_percent:discount,deal_text:null,rating,review_count:reviews,availability,shipping_text:null,tax_text:null,variations:[],sku,destination_url:resolved,resolved_url:resolved,retailer};
  }catch(e){return {error:String(e?.message||e).slice(0,500)}}
}
async function ingestSourceProduct(sourceUrl,env){
  const retailer=detectRetailer(sourceUrl);
  if(retailer==='Amazon'){
    const resolved=await resolveAmazonUrl(sourceUrl),asin=asinFromUrl(resolved)||asinFromUrl(sourceUrl);
    if(!asin)return {error:'Could not identify the Amazon product ID (ASIN).'};
    let listing=await scrapeAmazonListing(resolved,asin,env);
    if(!listing?.error){listing=normalizeAmazonListing(listing);listing=await aiPolishAmazonListing(env,listing);}
    return listing?.error?listing:{...listing,retailer,source_id:asin,source_url:sourceUrl,resolved_url:resolved};
  }
  if(retailer==='Temu'){
    const listing=await scrapeTemuListing(sourceUrl);
    return listing?.error?listing:{...listing,retailer,source_id:listing.id||sourceProductId(sourceUrl)};
  }
  return await scrapeGenericSource(sourceUrl,retailer);
}

      if(url.pathname==='/api/admin/import/amazon-search'&&request.method==='POST'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const payload=await body(request,256*1024);
        const searchUrl=String(payload?.url||'').trim();
        const limit=Math.min(Math.max(Number(payload?.limit||20),1),20);
        if(!isValidHttpUrl(searchUrl))return json({error:'A valid Amazon search or category URL is required.'},400);
        let parsed; try{parsed=new URL(searchUrl);}catch{return json({error:'That URL is not valid.'},400);}
        if(!amazonHost(parsed.hostname))return json({error:'Please paste an Amazon search or category URL.'},400);
        let response;
        try{
          response=await fetch(searchUrl,{redirect:'follow',headers:{
            'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36',
            'accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'accept-language':'en-US,en;q=0.9'
          }});
        }catch(e){return json({error:'Amazon search could not be reached: '+String(e?.message||e)},502);}
        if(!response.ok)return json({error:'Amazon search returned HTTP '+response.status+'.'},502);
        const html=await response.text();
        const found=[],seen=new Set();
        const marketplaceHost=parsed.hostname.toLowerCase().replace(/^www\./,'');
        const add=(asin)=>{
          const id=String(asin||'').toUpperCase();
          if(!/^[A-Z0-9]{10}$/.test(id)||seen.has(id))return;
          seen.add(id);found.push('https://'+marketplaceHost+'/dp/'+id);
        };
        for(const m of html.matchAll(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/)([A-Z0-9]{10})(?:[/?#"'&]|$)/gi))add(m[1]);
        for(const m of html.matchAll(/(?:asin|data-asin)=["':= ]+([A-Z0-9]{10})/gi))add(m[1]);
        return json({ok:true,source_url:searchUrl,requested:limit,found:found.slice(0,limit),count:Math.min(found.length,limit)});
      }

      if(url.pathname==='/api/admin/import/bulk'&&request.method==='POST'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const payload=await body(request,512*1024);
        const rawUrls=Array.isArray(payload?.urls)?payload.urls.join('\n'):String(payload?.urls||'');
        const urls=extractUrls(rawUrls);
        if(urls.length>30)return json({error:'Import up to 30 links at a time.'},400);
        const results=[]; let imported=0,skipped=0,failed=0;
        let categories=[]; try{const cr=await supabaseRest(env,'GET','categories',undefined,'?select=id,slug,name');if(cr.ok)categories=await cr.json();}catch(e){}
        for(const sourceUrl of urls){
          const started=Date.now();
          try{
            if(!isValidHttpUrl(sourceUrl))throw new Error('Invalid URL.');
            const listing=await ingestSourceProduct(sourceUrl,env);
            if(!listing||listing.error)throw new Error(listing?.error||'Product data could not be read from the source.');
            const retailer=listing.retailer||detectRetailer(sourceUrl);
            const sourceId=sourceProductId(sourceUrl)||sourceProductId(listing.resolved_url)||listing.source_id||listing.asin||listing.id||listing.sku;
            if(!sourceId)throw new Error('The source did not expose a stable product ID.');
            const identityQuery=retailer==='Amazon'
              ?'?select=id,name,published,amazon_asin&amazon_asin=eq.'+encodeURIComponent(sourceId)+'&limit=1'
              :'?select=id,name,published,source_sku,retailer&source_sku=eq.'+encodeURIComponent(sourceId)+'&retailer=eq.'+encodeURIComponent(retailer)+'&limit=1';
            const dup=await supabaseRest(env,'GET','products',undefined,identityQuery);
            let rows=dup.ok?await dup.json():[];
            // Legacy rows may have a bad ASIN but still point to the same canonical product URL.
            if(!rows.length&&retailer==='Amazon'&&sourceId){
              const bySource=await supabaseRest(env,'GET','products',undefined,'?select=id,name,published,amazon_asin&or=(amazon_source_url.ilike.*'+encodeURIComponent(sourceId)+'*,destination_url.ilike.*'+encodeURIComponent(sourceId)+'*)&limit=1');
              if(bySource.ok)rows=await bySource.json();
            }
            if(rows[0]){skipped++;results.push({ok:true,status:'skipped',retailer,source_url:sourceUrl,name:rows[0].name||'Existing product',reason:'Already imported or already listed from this product URL',id:rows[0].id,duration_ms:Date.now()-started});continue;}
            const rawTitle=cleanText(listing.title,300);
            const titleIssue=productTitleQualityIssue(rawTitle);
            if(!rawTitle||titleIssue||looksFragmentedText(rawTitle))throw new Error(titleIssue||'The retailer returned unreadable product text. This link was not saved. Try the direct product URL again or use a retailer API fallback.');
            const title=smartProductTitle(rawTitle,listing.brand||'');
            if(!title||productTitleQualityIssue(title)||looksFragmentedText(title))throw new Error('The product title could not be cleaned reliably. This link was not saved; correct the source details and retry.');
            const normalized=normalizeAmazonListing(listing);
         const images=dedupeImages(Array.isArray(normalized.images)?normalized.images:[],60).filter(isDisplayableProductImage).slice(0,40);
         const candidateTitle=smartProductTitle(normalized.title||'',normalized.brand||current.brand||'');
         const syncedTitle=candidateTitle&&!productTitleQualityIssue(candidateTitle)&&!looksFragmentedText(candidateTitle)
           ?candidateTitle
           :(current.name&&!productTitleQualityIssue(current.name)&&!looksFragmentedText(current.name)?current.name:'');
         if(!syncedTitle)return json({error:'Amazon source sync did not return a reliable product title. Nothing was changed; edit the title manually or retry later.'},422);
         const sourceDescription=cleanMultilineText(normalized.description,12000);
         const currentDescription=cleanMultilineText(current.description,12000);
         const syncedDescription=sourceDescription&&!looksFragmentedText(sourceDescription)?sourceDescription:(currentDescription&&!looksFragmentedText(currentDescription)?currentDescription:null);
         const syncedFeatures=Array.isArray(normalized.features)?normalized.features.map(v=>cleanMultilineText(v,1000)).filter(v=>v&&!looksFragmentedText(v)).slice(0,20):[];
         const patch={
           amazon_asin:asin,
           amazon_source_url:sourceUrl,
           source_type:'amazon',
           brand:normalized.brand||current.brand||null,
           name:syncedTitle,
           description:syncedDescription,
           source_sku:normalized.sku||current.source_sku||asin,
           features:syncedFeatures.length?syncedFeatures.join('\n'):current.features||null,
           amazon_current_price:retailer==='Amazon'?(normalized.current_price??null):null,
              amazon_list_price:retailer==='Amazon'?(normalized.list_price??null):null,amazon_discount_percent:retailer==='Amazon'?(normalized.discount_percent??null):null,
              amazon_deal_text:retailer==='Amazon'?(normalized.deal_text||null):null,amazon_rating:normalized.rating??null,amazon_review_count:normalized.review_count??null,
              amazon_bought_past_month:listing.bought_past_month||null,amazon_shipping_text:listing.shipping_text||null,
              availability:listing.availability||null,source_sku:listing.sku||sourceId,amazon_tax_text:listing.tax_text||null,
              amazon_variations:Array.isArray(listing.variations)?listing.variations:[],source_related_products:Array.isArray(listing.related_products)?listing.related_products:[],source_image_urls:images,ingredients:listing.ingredients||null,usage_instructions:listing.usage_instructions||null,product_warnings:listing.product_warnings||null,product_size:listing.product_size||null,published:false,amazon_last_synced:new Date().toISOString()
            };
            const slugBase=title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120);
            product.slug=(slugBase||'product')+'-'+Date.now().toString(36);
            const saved=await supabaseProductWrite(env,'POST',product);
            if(!saved.ok)throw new Error((await saved.text()).slice(0,1000)||'Could not save product.');
            const row=(await saved.json())?.[0]||null;
            imported++;results.push({ok:true,status:'imported',retailer,source_url:sourceUrl,name:title,id:row?.id||null,
              source_id:sourceId,captured:{images:images.length,description:!!description,features:features.length,price:listing.current_price!=null,listPrice:listing.list_price!=null,
              discount:listing.discount_percent!=null,rating:listing.rating!=null,reviews:listing.review_count!=null,availability:!!listing.availability,shipping:!!listing.shipping_text,variants:Array.isArray(listing.variations)?listing.variations.length:0},
              duration_ms:Date.now()-started});
          }catch(e){failed++;results.push({ok:false,status:'failed',source_url:sourceUrl,retailer:detectRetailer(sourceUrl),error:String(e?.message||e).slice(0,500),duration_ms:Date.now()-started});}
        }
        return json({ok:true,imported,skipped,failed,total:urls.length,results});
      }

      if(url.pathname.match(/^\/api\/admin\/products\/[^/]+\/sync$/)&&request.method==='POST'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const syncMatch=url.pathname.match(/^\/api\/admin\/products\/([^/]+)\/sync$/); const id=decodeURIComponent(syncMatch[1]);
        const existingRes=await supabaseRest(env,'GET','products',undefined,'?select=*&id=eq.'+encodeURIComponent(id)+'&limit=1');
        if(!existingRes.ok)return json({error:'Could not load the product.'},500);
        const current=(await existingRes.json())?.[0]; if(!current)return json({error:'Product not found.'},404);
        const sourceUrl=current.amazon_source_url||current.destination_url||'';
        if(!isValidHttpUrl(sourceUrl))return json({error:'This product has no valid source URL to sync.'},400);
        const retailer=String(current.retailer||'').toLowerCase();
        if(retailer!=='amazon')return json({error:'Source sync currently supports Amazon products.'},400);
        const asin=asinFromUrl(sourceUrl)||current.amazon_asin;
        if(!asin)return json({error:'This product has no Amazon ASIN.'},400);
        const listing=await scrapeAmazonListing(sourceUrl,asin,env);
        if(!listing||listing.error)return json({error:listing?.error||'Amazon source could not be read.'},502);
        const normalized=normalizeAmazonListing(listing);
        const images=Array.isArray(normalized.images)?normalized.images.filter(isValidHttpUrl).slice(0,40):[];
        const syncedTitle=smartProductTitle(normalized.title||current.name||'',normalized.brand||current.brand||'')||current.name;
        const patch={
          amazon_asin:normalized.asin||asin,
          amazon_source_url:sourceUrl,
          source_type:'amazon',
          brand:normalized.brand||current.brand||null,
          name:syncedTitle,
          description:normalized.description||current.description||null,
          features:Array.isArray(normalized.features)&&normalized.features.length?normalized.features.join('\n'):current.features||null,
          amazon_current_price:normalized.current_price??null,
          amazon_list_price:normalized.list_price??null,
          amazon_discount_percent:normalized.discount_percent??null,
          amazon_deal_text:normalized.deal_text||null,
          amazon_rating:normalized.rating??null,
          amazon_review_count:normalized.review_count??null,
          amazon_bought_past_month:normalized.bought_past_month||null,
          amazon_shipping_text:normalized.shipping_text||null,
          amazon_tax_text:normalized.tax_text||null,
          availability:normalized.availability||null,
          source_sku:normalized.sku||current.source_sku||null,
          amazon_variations:Array.isArray(normalized.variations)?normalized.variations:[],
          source_related_products:Array.isArray(normalized.related_products)?normalized.related_products:[],
          source_image_urls:images,
          amazon_last_synced:new Date().toISOString()
        };
        const oldSource=Array.isArray(current.source_image_urls)?dedupeImages(current.source_image_urls,60):[];
        const currentImages=Array.isArray(current.image_urls)?dedupeImages(current.image_urls,60):[];
        const galleryIsSource=!currentImages.length||(!oldSource.length&&currentImages.length===1&&currentImages[0]===current.image_url)||oldSource.length===currentImages.length&&oldSource.every((u,i)=>u===currentImages[i]);
        if(images.length&&galleryIsSource){patch.image_url=images[0];patch.image_urls=images;}
        const saved=await supabaseProductWrite(env,'PATCH',patch,'?id=eq.'+encodeURIComponent(id));
        if(!saved.ok)return json({error:(await saved.text()).slice(0,2000)},400);
        return json({ok:true,product:(await saved.json())?.[0]||null,source:{asin,fieldsCaptured:{images:images.length,description:!!syncedDescription,features:syncedFeatures.length,price:listing.current_price!=null,listPrice:listing.list_price!=null,discount:listing.discount_percent!=null,rating:listing.rating!=null,reviews:listing.review_count!=null,availability:!!listing.availability,shipping:!!listing.shipping_text,variants:Array.isArray(listing.variations)?listing.variations.length:0}}});
      }

      if(url.pathname==='/api/amazon/prepare'&&request.method==='POST'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const {url:amazonUrl}=await body(request,256*1024);
        if(!amazonUrl||!isValidHttpUrl(amazonUrl))return json({error:'A valid Amazon product URL is required'},400);
        const parsed=new URL(amazonUrl);
        if(!amazonHost(parsed.hostname))return json({error:'Please paste an Amazon product URL.'},400);
        const resolved=await resolveAmazonUrl(amazonUrl);
        const asin=asinFromUrl(resolved)||asinFromUrl(amazonUrl); if(!asin)return json({error:'Could not find an ASIN in that Amazon URL'},400);
        const resolvedParsed=new URL(resolved);
        const cleanPath=decodeURIComponent(resolvedParsed.pathname).replace(/^\/+|\/+$/g,'');
        const dpIndex=cleanPath.toLowerCase().indexOf('/dp/');
        const beforeDp=dpIndex>=0?cleanPath.slice(0,dpIndex):cleanPath;
        const titleHint=beforeDp.split('/').pop().replace(/[-_+]+/g,' ').replace(/\b(?:dp|gp|product)\b/gi,'').replace(/\s+/g,' ').trim().replace(/\b\w/g,c=>c.toUpperCase()).slice(0,180);
        let duplicate=null;
        try{
          const dup=await supabaseRest(env,'GET','products',undefined,'?select=id,name,published,amazon_asin&amazon_asin=eq.'+encodeURIComponent(asin)+'&limit=5');
          if(dup.ok){const rows=await dup.json();duplicate=rows[0]||null;}
          if(!duplicate){
            const bySource=await supabaseRest(env,'GET','products',undefined,'?select=id,name,published,amazon_asin&or=(amazon_source_url.ilike.*'+encodeURIComponent(asin)+'*,destination_url.ilike.*'+encodeURIComponent(asin)+'*)&limit=5');
            if(bySource.ok){const rows=await bySource.json();duplicate=rows[0]||null;}
          }
        }catch(e){}
        let listing=null;
        try{listing=await scrapeAmazonListing(resolved,asin,env);if(!listing?.error){listing=normalizeAmazonListing(listing);listing=await aiPolishAmazonListing(env,listing);}}
        catch(e){listing={error:String(e?.message||e).slice(0,300)};}
        let category_id=null;
        try{
          const cats=await supabaseRest(env,'GET','categories',undefined,'?select=id,slug,name');
          if(cats.ok){
            const categories=await cats.json();
            category_id=autoCategory(listing?.title||titleHint,listing?.category_path||'',listing?.brand||'',categories);
          }
        }catch(e){}
        const safeTitleHint=listing?.title||(!productTitleQualityIssue(titleHint)?titleHint:'');
        return json({ok:true,asin,destination_url:amazonUrl,resolved_url:resolved,title_hint:safeTitleHint,retailer:'Amazon',kind:'find',category_id,duplicate,listing:listing||null});
      }

async function scrapeTemuListing(temuUrl){
  const r=await fetch(temuUrl,{headers:{
    'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36',
    'accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language':'en-US,en;q=0.9'
  }});
  const html=await r.text();
  if(!r.ok||html.length<500)return {error:'Temu page could not be read right now.'};

  const decode=amazonDecode;
  const findMeta=(key)=>{
    const wanted=String(key||'').toLowerCase();
    const lower=html.toLowerCase();
    let p=lower.indexOf('<meta');
    while(p>=0){
      const e=html.indexOf('>',p);
      if(e<0)break;
      const tag=html.slice(p,e+1);
      const attrs=tag.toLowerCase();
      if(attrs.includes('property="'+wanted+'"')||attrs.includes("property='"+wanted+"'")||attrs.includes('name="'+wanted+'"')||attrs.includes("name='"+wanted+"'")){
        const a=attrs.indexOf('content=');
        if(a>=0){
          const q=tag[a+8];
          if(q==='"'||q==="'"){
            const b=tag.indexOf(q,a+9);
            if(b>a+9)return decode(tag.slice(a+9,b));
          }
        }
      }
      p=lower.indexOf('<meta',e+1);
    }
    return '';
  };

  const addUnique=(arr,value,max=40)=>{
    const u=String(value||'').replaceAll('\\u0026','&').replaceAll('\\/','/').trim();
    if((u.startsWith('https://')||u.startsWith('http://'))&&!arr.includes(u)&&arr.length<max)arr.push(u);
  };

  const images=[];
  try{
    const q=new URL(temuUrl).searchParams.get('top_gallery_url');
    if(q)addUnique(images,q);
  }catch(e){}
  addUnique(images,findMeta('og:image'));
  addUnique(images,findMeta('twitter:image'));

  const jsonLd=[];
  const scriptRe=/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for(const m of html.matchAll(scriptRe)){
    try{
      const parsed=JSON.parse(m[1].trim());
      if(Array.isArray(parsed))jsonLd.push(...parsed); else jsonLd.push(parsed);
    }catch(e){}
  }

  const productLd=jsonLd.find(x=>{
    const t=x&&x['@type'];
    return t==='Product'||(Array.isArray(t)&&t.includes('Product'));
  })||{};
  const offers=Array.isArray(productLd.offers)?(productLd.offers[0]||{}):(productLd.offers||{});
  const aggregate=productLd.aggregateRating||{};

  const title=decode(productLd.name||findMeta('og:title')||findMeta('twitter:title')||'Temu product');
  const description=decode(productLd.description||findMeta('og:description')||findMeta('description')||'');
  const brand=decode(typeof productLd.brand==='string'?productLd.brand:(productLd.brand?.name||''));

  const ldImages=Array.isArray(productLd.image)?productLd.image:(productLd.image?[productLd.image]:[]);
  for(const u of ldImages)addUnique(images,u);

  const lowerHtml=html.toLowerCase();
  let gp=lowerHtml.indexOf('top_gallery_url=');
  while(gp>=0){
    let a=gp+'top_gallery_url='.length;
    let b=a;
    while(b<html.length&&html[b]!=='&'&&html[b]!=='"'&&html[b]!=="'"&&html[b]!==' '&&html[b]!=='<')b++;
    if(b>a){
      try{addUnique(images,decodeURIComponent(html.slice(a,b)));}catch(e){}
    }
    gp=lowerHtml.indexOf('top_gallery_url=',b);
  }

  const kwcdnMarker='https://img.kwcdn.com/';
  let kp=html.indexOf(kwcdnMarker);
  while(kp>=0){
    let b=kp;
    while(b<html.length&&html[b]!=='"'&&html[b]!=="'"&&html[b]!==' '&&html[b]!=='<'&&html[b]!=='>')b++;
    addUnique(images,html.slice(kp,b));
    kp=html.indexOf(kwcdnMarker,b);
  }

  const plain=decode(html.replaceAll('<',' ').replaceAll('>',' '));
  const cleanRetailerText=(value)=>{
    return String(value||'')
      .replace(/(?:sale_list_token|order_receipt_token|refund_detail_token|bg_mail_token|payment_detail_token|email_token|[a-z0-9_]+_token)/gi,' ')
      .replace(/\s+/g,' ')
      .replace(/\s+([.,;:])/g,'$1')
      .trim();
  };
  const money=(v)=>{
    const text=String(v||'');
    const marker=text.match(/(?:US\$|\$|£|€|₦|NGN)\s*[0-9][0-9,.]*/i);
    if(!marker)return null;
    const n=marker[0].replace(/[^0-9.]/g,'');
    return n?Number(n):null;
  };
  const currentText=(plain.match(/(?:after applying promos to|now|current price|sale price|price)[^₦$€£0-9]{0,45}(?:₦|NGN|US\$|\$|£|€)\s*[0-9][0-9,.]*/i)||[])[0]||'';
  const currentPrice=money(offers.price)||money(findMeta('product:price:amount'))||money(currentText);
  const currency=String(offers.priceCurrency||findMeta('product:price:currency')||(plain.includes('₦')?'NGN':'')).toUpperCase()||null;
  const originalText=(plain.match(/(?:original|was|list price|from)[^₦$€£0-9]{0,45}(?:₦|NGN|US\$|\$|£|€)\s*[0-9][0-9,.]*/i)||[])[0]||'';
  const originalPrice=money(originalText);
  const reviewText=(plain.match(/[0-9][0-9,]*\s+reviews?/i)||[])[0]||'';
  const reviewCount=aggregate.reviewCount?Number(aggregate.reviewCount):Number(reviewText.replace(/[^0-9]/g,''))||null;
  const ratingText=(plain.match(/[0-5](?:\.[0-9])?\s*(?:out of 5|\/5)/i)||[])[0]||'';
  const ratingValue=aggregate.ratingValue?Number(aggregate.ratingValue):Number((ratingText.match(/[0-5](?:\.[0-9])?/)||[])[0])||null;
  // Only expose human-readable promotional language. Amazon pages contain
  // internal offer/token strings that must never reach the Nuvora storefront.
  const dealCandidates=[
    plain.match(/limited time deal/i)?.[0],
    plain.match(/flash deal/i)?.[0],
    plain.match(/today'?s deal/i)?.[0]
  ].filter(Boolean);
  const extraDeals=[
    plain.match(/\b[0-9]{1,2}\s*%\s*OFF\b/i)?.[0],
    plain.match(/\bONLY\s+[0-9,]+\s+LEFT\b/i)?.[0],
    plain.match(/\bFREE\s+SHIPPING\b/i)?.[0]
  ].filter(Boolean);
  const dealText=cleanRetailerText(dealCandidates[0]||extraDeals.join(' · ')||'')||null;
  const availability=String(offers.availability||'').split('/').pop()||null;
  const detailStart=plain.toLowerCase().indexOf('product details');
  const stopWords=['explore your interests','company info','customer service','back to top'];
  let detailEnd=plain.length;
  if(detailStart>=0){
    for(const word of stopWords){
      const p=plain.toLowerCase().indexOf(word,detailStart+1);
      if(p>=0&&p<detailEnd)detailEnd=p;
    }
  }
  const detailText=detailStart>=0?plain.slice(detailStart,detailEnd):'';
  const sectionClean=cleanRetailerText(detailText)
    .replace(/product details\s*[0-9]+/gi,' ')
    .replace(/open claw/gi,' ')
    .replace(/save\s*save/gi,' ')
    .replace(/report this item/gi,' ')
    .replace(/common_arrows/gi,' ')
    .replace(/\bsvg\b/gi,' ')
    .replace(/\s+/g,' ').trim();

  const specLabels=['Wireless Property','Battery Properties','Applicable Age Group','Brand','Major Material','Color','Power Mode','Operating Voltage','Item ID','Origin','Connectivity','Compatible Devices','Compatibility','Dimensions','Drawing Area','Interface','Material','Model','Style','Size','Capacity','Screen Size'];
  const specifications=[];
  const lowerDetails=sectionClean.toLowerCase();
  for(const label of specLabels){
    const needle=label.toLowerCase()+':';
    const pos=lowerDetails.indexOf(needle);
    if(pos<0)continue;
    const start=pos+needle.length;
    let end=sectionClean.length;
    for(const other of specLabels){
      const next=lowerDetails.indexOf(other.toLowerCase()+':',start);
      if(next>=0&&next<end)end=next;
    }
    const value=cleanRetailerText(sectionClean.slice(start,end)).trim();
    if(value&&value.length<300&&!specifications.some(x=>x[0].toLowerCase()===label.toLowerCase()))specifications.push([label,value]);
  }

  const highlightStart=plain.toLowerCase().indexOf('highlights');
  let highlightEnd=plain.length;
  for(const word of stopWords){
    const p=plain.toLowerCase().indexOf(word,highlightStart+10);
    if(p>=0&&p<highlightEnd)highlightEnd=p;
  }
  const highlightText=highlightStart>=0?plain.slice(highlightStart+10,highlightEnd):'';
  const featureLines=[...new Set(highlightText.split(/[.!?]+/).map(x=>cleanRetailerText(x)).filter(x=>x.length>25&&x.length<450))].slice(0,10);

  const soldText=(plain.match(/\b[0-9][0-9,.]*\s+sold\b/i)||[])[0]||null;
  const scarcityText=(plain.match(/\bONLY\s+[0-9,]+\s+LEFT\b/i)||[])[0]||null;
  const freeShipping=(plain.match(/\bFree shipping[^.\n]*/i)||[])[0]||null;
  const reviewSnapshot=(plain.match(/\b[0-9][0-9,.]*\s+reviews?\b/i)||[])[0]||null;
  const reviewVerified=/All reviews are from verified purchases/i.test(plain);
  const bestSellerText=(plain.match(/#[0-9]+\s+Best Seller[^.\n]*/i)||[])[0]||null;
  const promoPriceMatch=(plain.match(/after applying promos to\s+(?:₦|NGN|US\$|\$|£|€)\s*[0-9][0-9,.]*/i)||[])[0]||null;

  const descriptionParts=[];
  const productSentences=[...new Set(sectionClean.split(/(?<=[.!?])\s+/).map(x=>cleanRetailerText(x)).filter(x=>x.length>45&&x.length<800))].slice(0,8);
  if(productSentences.length)descriptionParts.push('Product information\n'+productSentences.join(' '));
  if(specifications.length)descriptionParts.push('Specifications\n'+specifications.map(x=>x[0]+': '+x[1]).join('\n'));
  if(featureLines.length)descriptionParts.push('Highlights\n'+featureLines.join('\n'));
  if(reviewSnapshot)descriptionParts.push('Review snapshot: '+reviewSnapshot+(reviewVerified?' · verified purchases':''));
  if(bestSellerText)descriptionParts.push('Retailer badge: '+bestSellerText);
  if(promoPriceMatch)descriptionParts.push('Promotional price: '+promoPriceMatch);
  if(soldText)descriptionParts.push('Sales activity: '+soldText);
  if(scarcityText)descriptionParts.push('Availability: '+scarcityText);


  let productId=null;
  const marker='-g-';
  const mi=temuUrl.toLowerCase().indexOf(marker);
  if(mi>=0){
    const raw=temuUrl.slice(mi+marker.length);
    const digits=raw.match(/^[0-9]{10,18}/);
    if(digits)productId=digits[0];
  }
  if(!productId){
    const qi=temuUrl.indexOf('goods_id=');
    if(qi>=0){
      const raw=temuUrl.slice(qi+9).split('&')[0];
      if(raw&&/^[0-9]{10,18}$/.test(raw))productId=raw;
    }  }

  return {
    id:productId,
    title:title.slice(0,180),
    brand:brand.slice(0,120),
    description:(descriptionParts.join('\n\n')||cleanRetailerText(description)).slice(0,12000),
    current_price:currentPrice,
    list_price:originalPrice,
    discount_percent:currentPrice&&originalPrice&&originalPrice>currentPrice?Math.round((1-currentPrice/originalPrice)*100):null,
    currency,
    rating:ratingValue,
    review_count:reviewCount,
    deal_text:dealText,
    availability,
    sold_count_text:soldText,
    shipping_text:cleanRetailerText(freeShipping||''),
    features:featureLines,
    specifications,
    variations:buildProductOptions(plain),
    scarcity_text:scarcityText,
    review_verified:reviewVerified,
    best_seller_text:bestSellerText,
    promo_price_text:promoPriceMatch,
    images
  };
}
      if(url.pathname==='/api/temu/prepare'&&request.method==='POST'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const {url:temuUrl}=await body(request,256*1024);
        if(!temuUrl||!isValidHttpUrl(temuUrl))return json({error:'A valid Temu product URL is required'},400);
        const parsed=new URL(temuUrl);
        const host=parsed.hostname.toLowerCase().replace(/^www\./,'');
        if(host!=='temu.com'&&!host.endsWith('.temu.com')&&host!=='temu.to')return json({error:'Please paste a Temu product URL.'},400);
        let listing=await scrapeTemuListing(temuUrl);
        if(listing?.error)return json(listing,502);
        listing.title=cleanImportedTitle(listing.title,listing.brand);
        if(!listing.title||productTitleQualityIssue(listing.title)||looksFragmentedText(listing.title))return json({error:'Temu returned an incomplete or corrupted product title. Nothing was imported; retry the direct listing URL or edit the source details first.'},502);
        const titleHint=listing.title.replace(/\s+/g,' ').trim().slice(0,180);
        let category_id=null;
        try{const cats=await supabaseRest(env,'GET','categories',undefined,'?select=id,slug,name');if(cats.ok)category_id=autoCategory(titleHint,listing?.description||'','',await cats.json());}catch(e){}
        let duplicate=null;
        if(listing?.id){try{const dup=await supabaseRest(env,'GET','products',undefined,'?select=id,name,published&retailer=eq.Temu&amazon_asin=eq.'+encodeURIComponent(listing.id)+'&limit=5');if(dup.ok){const rows=await dup.json();duplicate=rows[0]||null;}}catch(e){}}
        return json({ok:true,product_id:listing?.id||null,destination_url:temuUrl,title_hint:titleHint,retailer:'Temu',kind:'find',category_id,duplicate,listing});
      }

      if(url.pathname==='/api/amazon/import'&&request.method==='POST'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        if(!configured(env).amazon)return json({error:'Amazon Creators API is not configured'},503);
        const {url:amazonUrl}=await body(request,256*1024);
        if(!amazonUrl||!isValidHttpUrl(amazonUrl))return json({error:'A valid Amazon product URL is required'},400);
        const asin=asinFromUrl(amazonUrl); if(!asin)return json({error:'Could not find an ASIN in that Amazon URL'},400);
        const item=await amazonGetItem(env,asin); if(!item)return json({error:'Amazon returned no matching item'},404);
        const listing=item.offersV2?.listings?.[0]; const price=listing?.price?.money;
        const title=item.itemInfo?.title?.displayValue||'Amazon product';
        const features=item.itemInfo?.features?.displayValues||[];
        const brand=item.itemInfo?.byLineInfo?.brand?.displayValue||item.itemInfo?.byLineInfo?.manufacturer?.displayValue||'';
        const images=[item.images?.primary?.large?.url,item.images?.primary?.medium?.url,...(item.images?.variants||[]).flatMap(v=>[v?.large?.url,v?.medium?.url])].filter(Boolean);
        const availability=listing?.availability?.type||listing?.availability?.displayValue||null;
        return json({draft:{name:title,slug:`amazon-${asin.toLowerCase()}-${randHex(6)}`,kind:'find',brand,image_url:images[0]||null,image_urls:[...new Set(images)],display_price:price?.amount??null,currency:price?.currency||null,destination_url:item.detailPageURL||amazonUrl,retailer:'Amazon',amazon_asin:asin,amazon_source_url:amazonUrl,description:features.join('\n')||null,features:features.join('\n')||null,availability,published:false,amazon_last_synced:new Date().toISOString()}});
      }

      if(url.pathname==='/api/shopify/cart'&&request.method==='POST'){
        if(!configured(env).shopify)return json({error:'Shopify checkout is not configured'},503);
        const {lines}=await body(request);
        if(!Array.isArray(lines)||!lines.length)return json({error:'Cart lines required'},400);
        const normalized=[];
        for(const line of lines.slice(0,50)){
          const rawVariant=String(line?.merchandiseId||'').trim();
          const rawProduct=String(line?.shopifyProductId||'').trim();
          const variantId=rawVariant.startsWith('gid://shopify/ProductVariant/')?rawVariant:(/^\d+$/.test(rawVariant)?'gid://shopify/ProductVariant/'+rawVariant:'');
          const productId=rawProduct.startsWith('gid://shopify/Product/')?rawProduct:(/^\d+$/.test(rawProduct)?'gid://shopify/Product/'+rawProduct:'');
          if(!variantId&&!productId)continue;
          let variant=null; let product=null;
          if(variantId){
            const data=await shopifyGraphql(env,'query CheckoutVariant($id:ID!){ productVariant(id:$id){ id title availableForSale product{ id title handle status onlineStoreUrl } } }',{id:variantId},true);
            variant=data?.productVariant||null; product=variant?.product||null;
          }
          if(!variant&&productId){
            const data=await shopifyGraphql(env,'query CheckoutProduct($id:ID!){ product(id:$id){ id title handle status onlineStoreUrl variants(first:100){nodes{ id title availableForSale selectedOptions{name value} }} } }',{id:productId},true);
            product=data?.product||null;
            const candidates=product?.variants?.nodes||[];
            const wanted=Array.isArray(line?.selectedOptions)?line.selectedOptions.filter(x=>x&&x.name&&x.value):[];
            variant=candidates.find(v=>{const opts=Array.isArray(v.selectedOptions)?v.selectedOptions:[];return wanted.length&&wanted.length===opts.length&&wanted.every(item=>opts.some(o=>String(o.name)===String(item.name)&&String(o.value)===String(item.value)))})||candidates.find(v=>String(v.title||'')===String(line?.variantTitle||''))||null;
          }
          if(!variant)return json({error:'This Nuvora product is linked to a Shopify variant that no longer exists. Open Admin → Import Shopify and sync this product again.'},409);
          if(String(product?.status||'')!=='ACTIVE')return json({error:'This Shopify product is not active yet. In Shopify, set the product status to Active, then make it available to the Online Store.'},409);
          if(!product?.onlineStoreUrl)return json({error:'This Shopify product is not published to the Online Store. In Shopify, publish the product to Online Store, then try Buy now again.'},409);
          if(variant.availableForSale===false)return json({error:'This variant is currently unavailable for sale in Shopify. Choose another variant or update its inventory/selling settings.'},409);
          const numeric=String(variant.id||'').split('/').pop();
          if(!/^\d+$/.test(numeric))return json({error:'Shopify returned an invalid variant ID.'},502);
          normalized.push({id:numeric,variantId:variant.id,quantity:Math.max(1,Math.min(250,Number(line?.quantity)||1))});
        }
        if(!normalized.length)return json({error:'No valid Shopify checkout lines were supplied'},400);
        const storefrontLines=normalized.map(x=>({merchandiseId:x.variantId,quantity:x.quantity}));
        try{
          const domain=env.SHOPIFY_SHOP||env.SHOPIFY_STORE_DOMAIN;
          const version=env.SHOPIFY_API_VERSION||'2026-07';
          const headers={'content-type':'application/json'};
          if(env.SHOPIFY_STOREFRONT_ACCESS_TOKEN)headers['X-Shopify-Storefront-Access-Token']=env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
          const response=await fetch('https://'+domain+'/api/'+version+'/graphql.json',{
            method:'POST',headers,body:JSON.stringify({
              query:'mutation CreateNuvoraCart($input:CartInput!){ cartCreate(input:$input){ cart{ id checkoutUrl } userErrors{ field message code } warnings{ code message } } }',
              variables:{input:{lines:storefrontLines}}
            })
          });
          const payload=await response.json().catch(()=>({}));
          const userErrors=payload?.data?.cartCreate?.userErrors||[];
          const checkoutUrl=payload?.data?.cartCreate?.cart?.checkoutUrl;
          if(response.ok&&checkoutUrl&&!userErrors.length)return json({checkoutUrl,method:'storefront_cart'});
          const detail=userErrors.map(x=>x.message).filter(Boolean).join('; ');
          if(detail)return json({error:'Shopify could not create the checkout: '+detail},409);
        }catch(e){}
        const checkoutUrl='https://'+(env.SHOPIFY_SHOP||env.SHOPIFY_STORE_DOMAIN)+'/cart/'+normalized.map(x=>x.id+':'+x.quantity).join(',');
        return json({checkoutUrl,method:'cart_permalink'});
      }
      if(url.pathname==='/api/admin/shopify/products'&&request.method==='GET'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        if(!configured(env).shopifyAdmin)return json({error:'Shopify Admin API is not configured'},503);
        try{
          const data=await shopifyGraphql(env,'query{shop{currencyCode} products(first:100,sortKey:TITLE){nodes{id title handle descriptionHtml vendor productType status updatedAt featuredImage{url altText} images(first:20){nodes{url altText}} variants(first:100){nodes{id title price compareAtPrice selectedOptions{name value}}}}}}',{},true);
        const shopCurrency=String(data?.shop?.currencyCode||'NGN').toUpperCase();
          return json({products:data?.products?.nodes||[]});
        }catch(e){return json({error:e?.message||'Shopify products could not be loaded'},502);}
      }

function cleanShopifyDescription(raw){return String(raw||'').replace(/<img\b[^>]*>/gi,' ').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/(p|div|li|tr|h[1-6])>/gi,'\n').replace(/<li\b[^>]*>/gi,'• ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/[ \t]+/g,' ').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();}

      if(url.pathname==='/api/admin/shopify/import'&&request.method==='POST'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        if(!configured(env).shopifyAdmin)return json({error:'Shopify Admin API is not configured'},503);
        const payload=await body(request);
        const ids=Array.isArray(payload.ids)?payload.ids.map(String).filter(Boolean):[];
        if(!ids.length)return json({error:'Select at least one Shopify product.'},400);
        if(ids.length>100)return json({error:'You can import up to 100 Shopify products at once.'},400);

        // Fetch the Shopify catalog once. The importer then uses batched Supabase
        // requests instead of making multiple requests per product. This avoids
        // Cloudflare's per-invocation subrequest limit when importing many items.
        const data=await shopifyGraphql(env,'query{shop{currencyCode} products(first:100,sortKey:TITLE){nodes{id title handle descriptionHtml vendor productType status updatedAt featuredImage{url altText} images(first:20){nodes{url altText}} variants(first:100){nodes{id title price compareAtPrice selectedOptions{name value}}}}}}',{},true);
        const shopCurrency=String(data?.shop?.currencyCode||'NGN').toUpperCase();
        const catRes=await supabaseRest(env,'GET','categories',undefined,'?select=id,slug,name');
        const categories=catRes.ok?await catRes.json():[];
        const selected=(data?.products?.nodes||[]).filter(p=>ids.includes(String(p.id)));
        if(!selected.length)return json({ok:true,results:[],imported:0,skipped:0,failed:0});

        const results=[];
        const products=[];
        for(const p of selected){
          const images=[p.featuredImage?.url,...(p.images?.nodes||[]).map(x=>x.url)].filter(Boolean);
          const variant=p.variants?.nodes?.[0];
          const slugBase=String(p.handle||p.title||'product').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,140);
          products.push({
            source:p,
            product:{
              name:p.title,slug:slugBase+'-'+randHex(5),kind:'shop',description:cleanShopifyDescription(p.descriptionHtml),
              brand:p.vendor||null,image_url:images[0]||null,image_urls:[...new Set(images)],
              availability:p.status==='ACTIVE'?'In stock':null,display_price:variant?.price?Number(variant.price):null,
              currency:shopCurrency,destination_url:'https://'+(env.SHOPIFY_SHOP||env.SHOPIFY_STORE_DOMAIN)+'/products/'+p.handle,
              retailer:null,provider:'shopify',region:null,category_id:autoCategory(p.title,p.descriptionHtml,p.productType,categories),collection_id:null,
              why_we_picked_it:null,featured:false,trending:false,top_pick:false,published:false,
              shopify_product_id:p.id,shopify_variant_id:variant?.id||null,shopify_variants:(p.variants?.nodes||[]).map(v=>({id:v.id,title:v.title||'',price:v.price!=null?Number(v.price):null,compareAtPrice:v.compareAtPrice!=null?Number(v.compareAtPrice):null,selectedOptions:Array.isArray(v.selectedOptions)?v.selectedOptions:[]}))
            }
          });
        }

        // One lookup for all selected Shopify IDs.
        const idList=products.map(x=>String(x.source.id)).join(',');
        const existing=await supabaseRest(env,'GET','products',undefined,'?select=id,shopify_product_id&shopify_product_id=in.('+encodeURIComponent(idList)+')');
        let existingRows=[];
        if(existing.ok) existingRows=await existing.json();
        const existingMap=new Map((existingRows||[]).map(x=>[String(x.shopify_product_id),x.id]));

        const newItems=products.filter(x=>!existingMap.has(String(x.source.id)));
        const existingItems=products.filter(x=>existingMap.has(String(x.source.id)));

        // Sync existing Shopify-linked products as well as importing new ones.
        // Existing rows keep their current publication state.
        const syncRows=existingItems.map(x=>{
          const row={...x.product,id:existingMap.get(String(x.source.id))};
          delete row.published;
          return row;
        });
        const newRows=newItems.map(x=>x.product);
        const payloadRows=[...syncRows,...newRows];

        if(payloadRows.length){
          let created=await supabaseRest(env,'POST','products',payloadRows,'?on_conflict=id');
          if(!created.ok){
            const errText=(await created.text()).slice(0,2000);
            if(/PGRST204|schema cache|Could not find the '.*' column|shopify_product_id|shopify_variant_id|shopify_variants/i.test(errText)){
              const legacyRows=payloadRows.map(row=>{
                const copy={...row};
                delete copy.shopify_product_id;
                delete copy.shopify_variant_id;
                delete copy.shopify_variants;
                return copy;
              });
              created=await supabaseRest(env,'POST','products',legacyRows);
              if(!created.ok){
                const legacyErr=(await created.text()).slice(0,2000);
                for(const x of payloadRows)results.push({ok:false,id:x.id||null,title:x.name||'',error:legacyErr,initialError:errText});
              }else{
                for(const x of newItems)results.push({ok:true,imported:true,synced:false,id:x.source.id,title:x.source.title,syncedWithoutShopifyIds:true});
                for(const x of existingItems)results.push({ok:true,imported:false,synced:true,id:x.source.id,title:x.source.title,syncedWithoutShopifyIds:true});
              }
            }else{
              for(const x of payloadRows)results.push({ok:false,id:x.id||null,title:x.name||'',error:errText});
            }
          }else{
            for(const x of newItems)results.push({ok:true,imported:true,synced:false,id:x.source.id,title:x.source.title});
            for(const x of existingItems)results.push({ok:true,imported:false,synced:true,id:x.source.id,title:x.source.title});
          }
        }

        return json({
          ok:results.every(x=>x.ok),
          results,
          imported:results.filter(x=>x.ok&&x.imported).length,
          synced:results.filter(x=>x.ok&&x.synced).length,
          skipped:0,
          failed:results.filter(x=>!x.ok).length
        });
      }

      if(url.pathname==='/api/shopify/product'&&request.method==='POST'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        if(!configured(env).shopifyAdmin)return json({error:'Shopify Admin API is not configured'},503);
        const {product}=await body(request); if(!product?.title)return json({error:'Product title required'},400);
        const data=await shopifyGraphql(env,`mutation ProductCreate($product:ProductCreateInput!){productCreate(product:$product){product{id title handle}userErrors{field message}}}`,{product:{title:product.title,descriptionHtml:product.description||'',status:product.status==='ACTIVE'?'ACTIVE':'DRAFT'}},true);
        const p=data.productCreate; if(p.userErrors?.length)return json({error:p.userErrors.map(x=>x.message).join('; ')},400);
        return json(p.product);
      }

      if((url.pathname==='/api/admin/categories'||url.pathname==='/api/admin/collections')&&(request.method==='GET'||request.method==='POST')){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const table=url.pathname.endsWith('categories')?'categories':'collections';
        if(request.method==='GET'){
          const r=await supabaseRest(env,'GET',table,undefined,'?select=*&order=created_at.desc');
          if(!r.ok)return json({error:await r.text()},500); return json(await r.json());
        }
        const item=await body(request); if(!item.name||!item.slug)return json({error:'Name and slug are required'},400);
        // The deployed categories table may not have an optional description column.
        // Only send columns supported by the categories schema; collections retain their description.
        const record=table==='categories'?{name:item.name,slug:item.slug}:item;
        const r=await supabaseRest(env,'POST',table,record); if(!r.ok)return json({error:await r.text()},400); return json((await r.json())[0]);
      }

      if(url.pathname==='/api/admin/analytics'&&request.method==='GET'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const r=await supabaseRest(env,'GET','analytics_events',undefined,'?select=event_name&limit=5000');
        if(!r.ok){
          const raw=await r.text();
          const setupMissing=/PGRST205|relation .*analytics_events|table .*analytics_events/i.test(raw);
          return json({
            error:setupMissing?'Analytics database table is not configured yet.':'Analytics data could not be loaded.',
            code:setupMissing?'ANALYTICS_NOT_CONFIGURED':'ANALYTICS_READ_FAILED'
          },setupMissing?503:500);
        }
        const rows=await r.json();
        const counts={};
        for(const x of Array.isArray(rows)?rows:[]) counts[x.event_name]=(counts[x.event_name]||0)+1;
        return json({counts,total:Array.isArray(rows)?rows.length:0});
      }

      if(url.pathname==='/api/skin-settings'&&request.method==='GET'){
        // Only expose the explicit Skin storefront configuration; never return the whole admin settings row.
        const r=await supabaseRest(env,'GET','store_settings',undefined,'?select=skin_site_config&id=eq.true&limit=1');
        if(!r.ok)return json({error:'Skin storefront settings could not be loaded.'},502);
        const row=(await r.json())?.[0]||{};
        return json(row.skin_site_config&&typeof row.skin_site_config==='object'?row.skin_site_config:{},200,{'access-control-allow-origin':'https://client-store-platform.rayyung713.workers.dev','vary':'Origin'});
      }

      if(url.pathname==='/api/admin/settings'&&(request.method==='GET'||request.method==='PATCH')){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        if(request.method==='GET'){
          const r=await supabaseRest(env,'GET','store_settings',undefined,'?id=eq.true&select=*'); if(!r.ok)return json({error:await r.text()},500);
          return json((await r.json())[0]||{});
        }
        const patch=await body(request); delete patch.id;
        if(Object.prototype.hasOwnProperty.call(patch,'skin_site_config')){
          const configError=validateSkinSiteConfig(patch.skin_site_config);
          if(configError)return json({error:configError},400);
        }
        if(Object.prototype.hasOwnProperty.call(patch,'skin_site_draft')&&patch.skin_site_draft!==null){
          const draftError=validateSkinSiteConfig(patch.skin_site_draft,{requireProductGrid:false});
          if(draftError)return json({error:'Skin Studio draft: '+draftError},400);
        }
        patch.updated_at=new Date().toISOString();
        const r=await supabaseRest(env,'PATCH','store_settings',patch,'?id=eq.true'); if(!r.ok)return json({error:await r.text()},400);
        return json((await r.json())[0]||null);
      }

      if(url.pathname==='/api/admin/social-posts'&&(request.method==='GET'||request.method==='POST')){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        if(request.method==='GET'){
          const r=await supabaseRest(env,'GET','social_posts',undefined,'?select=*&order=created_at.desc'); if(!r.ok)return json({error:await r.text()},500);
          return json(await r.json());
        }
        const post=await body(request); if(!post.title||!post.caption||!post.platform)return json({error:'Title, caption and platform are required'},400);
        post.created_by=admin.id; post.status=post.status||'draft';
        const r=await supabaseRest(env,'POST','social_posts',post); if(!r.ok)return json({error:await r.text()},400); return json((await r.json())[0]);
      }

      const socialMatch=url.pathname.match(/^\/api\/admin\/social-posts\/([^/]+)$/);
      if(socialMatch&&(request.method==='PATCH'||request.method==='DELETE')){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const id=decodeURIComponent(socialMatch[1]);
        if(request.method==='PATCH'){
          const patch=await body(request); patch.updated_at=new Date().toISOString(); if(patch.status==='published')patch.published_at=new Date().toISOString();
          const r=await supabaseRest(env,'PATCH','social_posts',patch,`?id=eq.${encodeURIComponent(id)}`); if(!r.ok)return json({error:await r.text()},400); return json((await r.json())[0]||null);
        }
        const r=await supabaseRest(env,'DELETE','social_posts',undefined,`?id=eq.${encodeURIComponent(id)}`); if(!r.ok)return json({error:await r.text()},400); return json({ok:true});
      }

      if(url.pathname==='/api/admin/products/bulk'&&request.method==='POST'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const payload=await body(request,2*1024*1024),items=Array.isArray(payload.items)?payload.items:[];
        if(!items.length)return json({error:'No products supplied.'},400); if(items.length>500)return json({error:'CSV imports are limited to 500 rows per batch.'},400);
        const results=[];
        for(const raw of items){          const product={...raw,published:false,slug:String(raw.slug||raw.name||'product').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,150)+'-'+randHex(6)};
          const validation=validateProduct(product); if(validation){results.push({ok:false,name:raw.name||'',error:validation});continue;}
          if(product.image_url&&!isValidHttpUrl(product.image_url))product.image_url=null;
          // Use the same schema-drift-compatible writer as single-product
          // creation and Amazon imports. Keep ratings/reviews fields when the
          // destination schema supports them; drop only explicitly missing
          // optional columns when PostgREST reports a schema mismatch.
          const r=await supabaseProductWrite(env,'POST',product);
          if(!r.ok){results.push({ok:false,name:raw.name||'',error:(await r.text()).slice(0,500)});continue;}
          const saved=await r.json().catch(()=>[]);
          results.push({ok:true,name:product.name,id:saved?.[0]?.id||null});
        }
        return json({ok:results.every(x=>x.ok),results,imported:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length});
      }

      if(url.pathname==='/api/settings'&&request.method==='GET'){
        const r=await supabaseRest(env,'GET','store_settings',undefined,'?select=store_name,store_description,support_email,currency,timezone,default_region,affiliate_disclosure,shipping_policy,returns_policy&limit=1');
        if(!r.ok)return json({error:'Store settings could not be loaded.'},502);
        const rows=await r.json();
        return json(rows[0]||{store_name:'Nuvora'});
      }

      if(url.pathname==='/api/products'&&request.method==='GET'){
        // Keep the public catalog independent of Supabase relationship embeds.
        // A broken/missing category or collection relationship must not blank the store.
        const [productsRes,categoriesRes,collectionsRes]=await Promise.all([
          supabaseRest(env,'GET','products',undefined,'?select=*&published=eq.true&order=created_at.desc'),
          supabaseRest(env,'GET','categories',undefined,'?select=id,name'),
          supabaseRest(env,'GET','collections',undefined,'?select=id,name')
        ]);
        if(!productsRes.ok)return json({error:'Products could not be loaded.'},502);
        const products=await productsRes.json();
        const categories=categoriesRes.ok?await categoriesRes.json():[];
        const collections=collectionsRes.ok?await collectionsRes.json():[];
        const categoryMap=new Map(categories.map(x=>[String(x.id),x]));
        const collectionMap=new Map(collections.map(x=>[String(x.id),x]));
        const storefront=String(url.searchParams.get('storefront')||'').toLowerCase();
        const storefrontProducts=storefront==='beauty'
          ?products.filter(p=>{
            const category=categoryMap.get(String(p.category_id||''));
            const label=String(category?.name||'');
            const productText=[p.name,p.brand,p.description,p.features,p.store_description].filter(Boolean).join(' ');
            // Nuvora Skin is a skincare editorial storefront, so include imported
            // Amazon "find" products as well as shop products when their category
            // or verified product text identifies them as skincare/beauty.
            return /skin\s*care|skincare|beauty|cosmetic/i.test(label)
              ||/skin\s*care|skincare|beauty|cosmetic|cleanser|cleansing|face wash|moisturi|serum|sunscreen|sunblock|spf|face cream|toner|retinol|exfoliat|lip balm|facial oil|eye cream|face mask/i.test(productText);
          })
          :products;
        return json(storefrontProducts.map(p=>{
          const source=p;
          const normalized=normalizeAmazonProduct(source);
          const safeText=v=>cleanMultilineText(v,12000)||null;
          const storedName=cleanText(source.name,180)||normalized.name;
          const storedDescription=safeText(source.description);
          const curatedDescription=safeText(source.store_description);
          // Imported text is normalized before storage. Do not run a second
          // title rewrite on every public read: repeated cleanup can damage
          // perfectly good titles/descriptions. If a legacy description is
          // visibly fragmented, prefer the clean editorial description.
          const publicDescription=curatedDescription
            ||(storedDescription&&!looksFragmentedText(storedDescription)?storedDescription:normalized.description);
          const storedFeatures=safeText(source.features);
          const publicFeatures=storedFeatures&&!looksFragmentedText(storedFeatures)?storedFeatures:null;
          const isAmazonSource=/amazon/i.test(String(source.retailer||source.source_type||''))||!!source.amazon_asin||!!source.amazon_source_url;
          const publicProduct={
            id:source.id,name:storedName,slug:source.slug,kind:source.kind,brand:cleanText(source.brand,180)||normalized.brand,
            description:publicDescription,store_description:source.store_description||null,features:publicFeatures,
            ingredients:source.ingredients||null,usage_instructions:source.usage_instructions||null,product_warnings:source.product_warnings||null,product_size:source.product_size||null,
            benefits:source.benefits||source.why_we_picked_it||null,skin_types:source.skin_types||source.best_for||null,skin_concerns:source.skin_concerns||source.skip_if||null,
            recommended_product_ids:Array.isArray(source.recommended_product_ids)?source.recommended_product_ids:[],recommendation_reason:source.recommendation_reason||null,
            image_url:normalized.image_url,image_urls:normalized.image_urls,display_price:source.display_price??normalized.display_price,currency:source.currency||normalized.currency,
            destination_url:(isAmazonSource?(source.destination_url||source.amazon_source_url):(source.destination_url||source.source_url))||null,
            retailer:source.retailer||null,provider:source.provider||null,source_type:source.source_type||null,region:source.region||null,
            category_id:source.category_id||null,collection_id:source.collection_id||null,category:source.category_id?categoryMap.get(String(source.category_id))||null:null,
            collection:source.collection_id?collectionMap.get(String(source.collection_id))||null:null,availability:source.availability||null,
            featured:!!source.featured,trending:!!source.trending,top_pick:!!source.top_pick,why_we_picked_it:source.why_we_picked_it||null,
            best_for:source.best_for||null,skip_if:source.skip_if||null,deal_text:safeText(source.deal_text)||safeText(normalized.deal),
            amazon_deal_text:safeText(normalized.deal),amazon_list_price:isAmazonSource?source.amazon_list_price??null:null,
            amazon_discount_percent:isAmazonSource?source.amazon_discount_percent??null:null,amazon_shipping_text:isAmazonSource?source.amazon_shipping_text??null:null,
            amazon_tax_text:isAmazonSource?source.amazon_tax_text??null:null,amazon_variations:isAmazonSource&&Array.isArray(source.amazon_variations)?source.amazon_variations:[],
            amazon_rating:isAmazonSource?null:normalized.rating,amazon_review_count:isAmazonSource?null:normalized.review_count,
            rating:isAmazonSource?null:source.rating,review_count:isAmazonSource?null:source.review_count,
            temu_deal_text:safeText(source.temu_deal_text),temu_list_price:source.temu_list_price??null,temu_discount_percent:source.temu_discount_percent??null,
            temu_rating:source.temu_rating??null,temu_review_count:source.temu_review_count??null,
            shopify_product_id:source.shopify_product_id||null,shopify_variant_id:source.shopify_variant_id||null,
            shopify_variants:Array.isArray(source.shopify_variants)?source.shopify_variants:[],
          };
          return publicProduct;
        }),200,{
          'cache-control':'no-store, no-cache, must-revalidate, max-age=0',
          'pragma':'no-cache',
          'vary':'Origin',
          ...(storefront==='beauty'?{'access-control-allow-origin':'https://client-store-platform.rayyung713.workers.dev'}:{})
        });
      }
      async function supabaseProductWrite(env,method,product,query=''){
        const payload={...product};
        // Missing optional columns can occur when a hosted Supabase project has
        // drifted from the repository schema. Retry only for known optional
        // product metadata; never silently discard identity/publishing fields.
        const optionalColumns=new Set([
          'features','brand','availability','provider','region','category_id','collection_id',
          'why_we_picked_it','best_for','skip_if','last_checked_at','featured','trending','top_pick',
          'shopify_product_id','shopify_variant_id','shopify_variants','amazon_asin','amazon_source_url',
          'source_type','source_sku','sourcinbox_product_url','sourcinbox_product_id','supplier_cost',
          'amazon_last_synced','amazon_current_price','amazon_list_price','amazon_discount_percent',
          'amazon_deal_text','amazon_rating','amazon_review_count','amazon_bought_past_month',
          'amazon_badges','amazon_shipping_text','amazon_tax_text','amazon_variations',
          'source_related_products','source_image_urls','source_url','resolved_url','store_description',
          'temu_source_url','temu_product_id','temu_deal_text','temu_list_price','temu_discount_percent',
          'temu_rating','temu_review_count','deal_text','list_price','discount_percent','rating','review_count',
          'ingredients','usage_instructions','product_warnings','product_size','benefits','skin_types','skin_concerns','recommended_product_ids','recommendation_reason'
        ]);
        for(let attempt=0;attempt<40;attempt++){
          const response=await supabaseRest(env,method,'products',payload,query);
          if(response.ok)return response;
          const raw=await response.text();
          let parsed={};try{parsed=JSON.parse(raw)||{}}catch(e){}
          const message=String(parsed.message||parsed.details||raw);
          const match=message.match(/Could not find the '([^']+)' column of 'products'/i)
            ||message.match(/column\s+products\.([A-Za-z_][A-Za-z0-9_]*)\s+does not exist/i)
            ||message.match(/column\s+["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s+of relation\s+["']?products["']?\s+does not exist/i);
          const missing=match?.[1]||null;
          if(!missing||!(missing in payload)||!optionalColumns.has(missing)){
            return {ok:false,text:async()=>raw};
          }
          delete payload[missing];
        }
        return {ok:false,text:async()=>JSON.stringify({message:'Product write exceeded the optional-column compatibility retry limit.'})};
      }

      if(url.pathname==='/api/admin/products'&&request.method==='GET'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const r=await supabaseRest(env,'GET','products',undefined,'?select=*&order=created_at.desc'); if(!r.ok)return json({error:await r.text()},500); return json(await r.json());
      }
      if(url.pathname==='/api/admin/products'&&request.method==='POST'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const product=await body(request,512*1024);
        product.name=String(product.name??'').trim().slice(0,180);
        product.slug=makeProductSlug(product.slug||product.name||product.amazon_asin||'product');
        const validation=validateProduct(product); if(validation)return json({error:validation},400);
        product.published=product.published===true;
        product.description=cleanMultilineText(product.description,12000); product.features=cleanMultilineText(product.features,12000); product.brand=cleanText(product.brand,180);
        if(Array.isArray(product.image_urls))product.image_urls=product.image_urls.filter(isValidHttpUrl).slice(0,30);
        if(product.image_url&&!isValidHttpUrl(product.image_url))product.image_url=null;
        const r=await supabaseProductWrite(env,'POST',product); if(!r.ok)return json({error:'Supabase rejected the product.',detail:(await r.text()).slice(0,2000)},400);
        return json((await r.json())[0]);
      }

      const publishMatch=url.pathname.match(/^\/api\/admin\/products\/([^/]+)\/publish$/);
      if(publishMatch&&request.method==='POST'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const id=decodeURIComponent(publishMatch[1]);
        const patch=await body(request,128*1024);
        const result=await publishProductRecord(env,id,patch||{});
        if(!result.ok)return json({error:result.error},result.status||400);
        return json({ok:true,product:result.product});
      }

      const productMatch=url.pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
      if(productMatch&&(request.method==='GET'||request.method==='PATCH'||request.method==='DELETE')){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const id=decodeURIComponent(productMatch[1]);
        if(request.method==='GET'){
          const r=await supabaseRest(env,'GET','products',undefined,'?select=*&id=eq.'+encodeURIComponent(id)+'&limit=1');
          if(!r.ok)return json({error:'Could not load the product.'},500);
          const row=(await r.json())?.[0];
          if(!row)return json({error:'Product not found.'},404);
          return json(row);
        }
        if(request.method==='PATCH'){
          const patch=await body(request);
          if(patch.name)patch.name=String(patch.name).trim().slice(0,180);
          // Preserve an existing product slug unless the caller explicitly changes it.
          // Changing slugs during ordinary edits breaks saved/shared product URLs.
          if(patch.slug)patch.slug=String(patch.slug).trim().toLowerCase();
          // Never let legacy/broken slugs block an edit or publish.
          // Keep a valid existing slug; regenerate only when the stored value is malformed.
          if(patch.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(patch.slug))patch.slug=makeProductSlug(patch.name||'product');

          const existing=await supabaseRest(env,'GET','products',undefined,'?select=*&id=eq.'+encodeURIComponent(id)+'&limit=1');
          if(!existing.ok)return json({error:'Could not load the product before editing.'},500);
          const current=(await existing.json())?.[0];
          if(!current)return json({error:'Product not found.'},404);
          const merged={...current,...patch};
          if(!merged.slug||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(merged.slug))){merged.slug=makeProductSlug(merged.name||'product');patch.slug=merged.slug;}
          if(patch.published===true){
            const result=await publishProductRecord(env,id,patch);
            if(!result.ok)return json({error:result.error},result.status||400);
            return json(result.product);
          }
          // Editing an existing listing must remain possible even if its legacy content needs repair.
          // Apply the full publish gate only when the admin explicitly publishes; validate edited fields themselves below.
          const validation=validateProduct({...merged,name:merged.name,slug:merged.slug,kind:merged.kind,published:false});
          if(validation)return json({error:validation},400);
          if(merged.published===true){
            if(Object.prototype.hasOwnProperty.call(patch,'name')){
              const titleIssue=productTitleQualityIssue(merged.name);
              if(titleIssue)return json({error:titleIssue},400);
            }
            const imageTouched=Object.prototype.hasOwnProperty.call(patch,'image_url')||Object.prototype.hasOwnProperty.call(patch,'image_urls');
            if(imageTouched){
              const images=Array.isArray(patch.image_urls)?patch.image_urls.filter(isDisplayableProductImage):(isDisplayableProductImage(patch.image_url)?[patch.image_url]:[]);
              if(!images.length)return json({error:'A published product needs a real product image. Replace the image or move the listing to draft first.'},400);
            }
            if(Object.prototype.hasOwnProperty.call(patch,'destination_url')&&!isValidHttpUrl(merged.destination_url))return json({error:'Enter a valid retailer destination URL or move the listing to draft first.'},400);
            if(Object.prototype.hasOwnProperty.call(patch,'description')||Object.prototype.hasOwnProperty.call(patch,'store_description')){
              const customerDescription=cleanText(merged.store_description,12000)||cleanText(merged.description,12000);
              if(customerDescription&&looksFragmentedText(customerDescription))return json({error:'The customer-facing description appears incomplete or corrupted. Correct it or move the listing to draft first.'},400);
            }
          }
          if(typeof patch.description==='string')patch.description=cleanMultilineText(patch.description,12000);
          if(typeof patch.features==='string')patch.features=cleanMultilineText(patch.features,12000);
          if(typeof patch.brand==='string')patch.brand=cleanText(patch.brand,180);
          if(typeof patch.deal_text==='string')patch.deal_text=cleanText(patch.deal_text,500);
          if(typeof patch.amazon_deal_text==='string')patch.amazon_deal_text=cleanText(patch.amazon_deal_text,500);
          if(typeof patch.temu_deal_text==='string')patch.temu_deal_text=cleanText(patch.temu_deal_text,500);
          if(Array.isArray(patch.image_urls))patch.image_urls=patch.image_urls.filter(isValidHttpUrl).slice(0,30);
          const r=await supabaseProductWrite(env,'PATCH',patch,`?id=eq.${encodeURIComponent(id)}`); if(!r.ok)return json({error:await r.text()},400);
          const rows=await r.json(); return json(rows[0]||null);
        }
        const r=await supabaseRest(env,'DELETE','products',undefined,`?id=eq.${encodeURIComponent(id)}`); if(!r.ok)return json({error:await r.text()},400);
        return json({ok:true});
      }

      if(url.pathname==='/api/admin/ai/image'&&request.method==='POST'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const form=await request.formData();
        const prompt=cleanText(form.get('prompt'),5000);
        const size=String(form.get('size')||'1024x1024');
        const source=form.get('image');
        const imageUrl=String(form.get('image_url')||'').trim();
        if(!prompt)return json({error:'An image prompt is required.'},400);
        if(!env.AI)return json({error:'Nuvora AI is unavailable because the Cloudflare Workers AI binding is not active on this deployment. Deploy the current Nuvora Worker.'},503);
        const dimensions={'1024x1024':[1024,1024],'1536x1024':[1536,1024],'1024x1536':[1024,1536]};
        const [width,height]=dimensions[size]||dimensions['1024x1024'];
        try{
          let referenceBytes=null;
          if(source&&typeof source.arrayBuffer==='function'){
            referenceBytes=new Uint8Array(await source.arrayBuffer());
          }else if(imageUrl){
            let referenceResponse;
            try{referenceResponse=await fetch(imageUrl,{redirect:'follow',headers:{accept:'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'}})}
            catch(fetchError){return json({error:'Nuvora could not fetch the product image from its source. Upload the image to Nuvora first, then generate again.'},422)}
            if(!referenceResponse.ok)return json({error:'Nuvora could not fetch the product image from its source (HTTP '+referenceResponse.status+'). Upload the image to Nuvora first, then generate again.'},422);
            const contentType=referenceResponse.headers.get('content-type')||'';
            if(!contentType.toLowerCase().startsWith('image/'))return json({error:'The product image URL did not return an image. Upload the image to Nuvora first, then generate again.'},422);
            referenceBytes=new Uint8Array(await referenceResponse.arrayBuffer());
          }
          if(referenceBytes&&referenceBytes.byteLength>6*1024*1024)return json({error:'Reference image must be 6 MB or smaller for Nuvora AI.'},400);

          const negative='fake logos, watermarks, misleading text, extra products, distorted product, duplicate product, low quality';
          let result;
          if(referenceBytes){
            // Cloudflare's newer FLUX.2 models accept reference images through
            // multipart form data. SDXL is intentionally not used for reference
            // images here because the deployed account is returning 3030 for
            // SDXL's image tensor input.
            const form=new FormData();
            form.append('prompt',prompt);
            form.append('input_image_0',new Blob([referenceBytes],{type:'image/png'}),'reference.png');
            form.append('width',String(width));
            form.append('height',String(height));
            form.append('guidance','3.5');
            const formResponse=new Response(form);
            result=await env.AI.run('@cf/black-forest-labs/flux-2-klein-4b',{
              multipart:{
                body:formResponse.body,
                contentType:formResponse.headers.get('content-type')||'multipart/form-data'
              }
            });
          }else{
            result=await env.AI.run('@cf/stabilityai/stable-diffusion-xl-base-1.0',{
              prompt,negative_prompt:negative,width,height,num_steps:20,guidance:7.5
            });
          }
          const bytes=await aiResultBytes(result);
          return json({ok:true,provider:'cloudflare',image:'data:image/png;base64,'+bytesToBase64(bytes)});
        }catch(e){
          const code=String(e?.code||e?.error?.code||'');
          const status=Number(e?.status||e?.error?.status||0);
          const message=String(e?.message||e?.error?.message||'');
          if(code==='3036'||status===429&&/daily|allocation|neurons/i.test(message)){
            return json({error:'Nuvora AI has reached Cloudflare’s AI allocation. Please try again after the allowance resets.'},429);
          }
          if(code==='3040'||status===429){
            return json({error:'Cloudflare Workers AI is temporarily at capacity. Please try the image again later.'},429);
          }
          if(code==='5018'||/not allowed to access.*runwayml\/stable-diffusion-v1-5-img2img/i.test(message)){
            return json({error:'Nuvora AI reference-image generation is unavailable for the configured Cloudflare model on this deployment. The current image workflow uses FLUX.2 Klein.'},403);
          }
          return json({error:'Nuvora AI image generation failed: '+(message||'Cloudflare Workers AI returned an unknown error.')},502);
        }
      }

      if(url.pathname==='/api/admin/ai/copy'&&request.method==='POST'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const input=await body(request,64*1024);
        const product=input.product||{};
        if(!env.AI)return json({error:'Nuvora AI is unavailable because the Cloudflare Workers AI binding is not active on this deployment. Deploy the current Nuvora Worker.'},503);
        const prompt=`Create polished ecommerce copy for Nuvora. Return ONLY valid JSON with keys: title, description, features, seo_title, seo_description, social_caption. Keep claims factual and do not invent specifications, certifications, guarantees, discounts, or performance claims. Product data: ${JSON.stringify(product)}`;
        try{
          const response=await env.AI.run('@cf/google/gemma-4-26b-a4b-it',{
            messages:[
              {role:'system',content:'You write accurate ecommerce listings. Output only valid JSON with the requested keys. Never invent product facts.'},
              {role:'user',content:prompt}
            ],
            chat_template_kwargs:{enable_thinking:false}
          });
          const raw=String(response?.response||response?.choices?.[0]?.message?.content||'').trim();
          const clean=raw.replace(/^\`\`\`(?:json)?\s*/i,'').replace(/\s*\`\`\`$/,'').trim();
          let result;
          try{result=JSON.parse(clean)}catch{
            const match=clean.match(/\{[\s\S]*\}/);
            result=match?JSON.parse(match[0]):{title:clean};
          }
          return json({ok:true,provider:'cloudflare',...result});
        }catch(e){
          const code=String(e?.code||e?.error?.code||'');
          const status=Number(e?.status||e?.error?.status||0);
          const message=String(e?.message||e?.error?.message||'');
          if(code==='3036'||status===429&&/daily|allocation|neurons/i.test(message)){
            return json({error:'Nuvora AI has reached Cloudflare’s free daily AI allocation. The free allowance resets daily; no OpenAI credits are required for this feature.'},429);
          }
          if(code==='3040'||status===429){
            return json({error:'Cloudflare Workers AI is temporarily at capacity. Please try the AI again later.'},429);
          }
          return json({error:'Nuvora AI listing polish failed: '+(message||'Cloudflare Workers AI returned an unknown error.')},502);
        }
      }

      // Unknown API routes must stay JSON 404s; only browser routes use the SPA shell.
      if(url.pathname.startsWith('/api/')) return json({error:'API route not found.'},404);
      // Let Cloudflare Assets serve the SPA shell for every non-API route.
      // This is required for client-side routes such as /shop, /finds, /cart, etc.
      return serveAsset(env,request);
    } catch(e) {
      return json({error:e?.message||'Server error'},500);
    }
  }
};

function securityResponse(response){
  const headers=new Headers(response.headers);
  headers.set('Strict-Transport-Security','max-age=31536000; includeSubDomains');
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('X-Frame-Options','DENY');
  headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(self)');
  headers.set('Cross-Origin-Opener-Policy','same-origin-allow-popups');
  headers.set('Content-Security-Policy',[
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://*.supabase.co https://*.supabase.in https://*.supabase.com",
    "frame-src 'self' https://accounts.google.com https://client-store-platform.rayyung713.workers.dev",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'"
  ].join('; '));
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
async function serveAsset(env,request){
  const response=await env.ASSETS.fetch(request);
  const headers=new Headers(response.headers);
  const type=headers.get('content-type')||'';
  if(type.includes('text/html'))headers.set('cache-control','no-store, must-revalidate');
  return securityResponse(new Response(response.body,{status:response.status,statusText:response.statusText,headers}));
}
function isValidHttpUrl(value){try{const u=new URL(String(value??'').trim());return u.protocol==='http:'||u.protocol==='https:';}catch{return false;}}
const buckets = new Map();
function rateLimit(request,key,limit=120,windowMs=60000){
  const ip=(request.headers.get('cf-connecting-ip')||request.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim();
  const id=ip+'|'+key, now=Date.now(); let b=buckets.get(id);
  if(!b||now-b.start>=windowMs){b={start:now,count:0};buckets.set(id,b);}
  b.count++; if(b.count>limit)return Math.max(1,Math.ceil((windowMs-(now-b.start))/1000)); return 0;
}
function json(payload,status=200,extra={}){return securityResponse(new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json','cache-control':'no-store',...extra}}));}
async function body(request,limit=1024*1024){const len=Number(request.headers.get('content-length')||0);if(len>limit)throw new Error('Request body is too large.');const text=await request.text();if(text.length>limit)throw new Error('Request body is too large.');return text?JSON.parse(text):{};}
function env(name){return globalThis.__ENV?.[name]||'';}
async function aiResultBytes(result){
  if(result instanceof ReadableStream)return new Uint8Array(await new Response(result).arrayBuffer());
  if(result instanceof Response)return new Uint8Array(await result.arrayBuffer());
  if(result instanceof ArrayBuffer)return new Uint8Array(result);
  if(ArrayBuffer.isView(result))return new Uint8Array(result.buffer,result.byteOffset,result.byteLength);
  if(result&&typeof result.image==='string'){const raw=result.image.includes(',')?result.image.split(',').pop():result.image;const bin=atob(raw);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return bytes;}
  throw new Error('Cloudflare AI returned no image bytes.');
}
function bytesToBase64(bytes){let out='';const step=0x8000;for(let i=0;i<bytes.length;i+=step)out+=String.fromCharCode(...bytes.subarray(i,i+step));return btoa(out);}
function repairFragmentedText(value){
  return decodeHtmlEntities(String(value??''))
    .replace(/[\\u0000-\\u001F\\u007F]/g,' ')
    .replace(/\s+/g,' ')    .trim();
}
function looksFragmentedText(value){
  const s=String(value||'').trim(); if(!s)return false;
  const words=s.split(/\s+/).filter(Boolean);
  const fragmentPattern=/\b(?:mazon\.com|azon\.com|isit\s+the\s+tore|ack\s+cented|omatherapy\s+ndle|ndstone\s+elief|omedics\s+tore|hydra\s+ing|trea\s+men|ma\s+cha|an\s+ioxidan|mois\s+urizer|fea\s+uring|rou\s+ine|smoo\s+her|curren\s+re\s+ailer|lis\s+ing|produc\s+labels|la\s+es\s+de\s+ails|four-s\s+ep|discovery\s+se)\b/gi;
  const fragmentMarkers=s.match(fragmentPattern)||[];
  if(words.length<12)return fragmentMarkers.length>0;
  const singleLetters=words.filter(w=>/^[A-Za-z]$/.test(w)).length;
  const suspicious=(s.match(/\b[A-Za-z]{2,}\s+[A-Za-z]\b/g)||[]).length;
  const distinctFragments=new Set(fragmentMarkers.map(marker=>marker.toLowerCase()));
  return singleLetters>=Math.max(4,Math.ceil(words.length*0.08))||suspicious>=5||distinctFragments.size>=2;
}
function cleanText(value,max=10000){
  const text=String(value??'')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'')
    .replace(/(?:sale_list_token|order_receipt_token|refund_detail_token|bg_mail_token|payment_detail_token|email_token|[a-z0-9_]+_token)/gi,' ')
    .replace(/\s+/g,' ')
    .trim().slice(0,max);
  if(/^[\s✦★☆•*"',;:._-]*(?:ema(?:il)?)?[\s✦★☆•*"',;:._-]*$/i.test(text))return '';
  return text;
}
function cleanMultilineText(value,max=12000){
  const text=String(value??'')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'')
    .replace(/(?:sale_list_token|order_receipt_token|refund_detail_token|bg_mail_token|payment_detail_token|email_token|[a-z0-9_]+_token)/gi,' ')
    .replace(/\\r/g,'')
    .replace(/[ \\t]+/g,' ')
    .replace(/\n[ \\t]+/g,'\n')
    .replace(/\n{3,}/g,'\n\n')
    .trim().slice(0,max);
  if(/^[\s✦★☆•*"',;:._-]*(?:ema(?:il)?)?[\s✦★☆•*"',;:._-]*$/i.test(text))return '';
  return text;
}
function makeProductSlug(value){
  const base=cleanText(value,180).toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').replace(/-+/g,'-').slice(0,140);
  return (base||'product')+'-'+Math.random().toString(36).slice(2,8);
}

function validateSkinSiteConfig(value,options={}){
  if(!value||typeof value!=='object'||Array.isArray(value))return 'Skin site configuration must be an object.';
  let encoded;try{encoded=JSON.stringify(value);}catch{return 'Skin site configuration is not valid JSON.';}
  if(encoded.length>100000)return 'Skin site configuration is too large (maximum 100 KB).';
  if(!['soft-editorial','clean-minimal','sage-botanical'].includes(String(value.template||'soft-editorial')))return 'Unknown Skin Studio template.';
  if(value.accentColor!==undefined&&!/^#[0-9a-f]{6}$/i.test(String(value.accentColor)))return 'Skin Studio accent color must be a six-digit hex color.';
  if(value.heroImage){try{if(new URL(value.heroImage).protocol!=='https:')return 'Skin Studio hero image must use HTTPS.';}catch{return 'Skin Studio hero image URL is invalid.';}}
  if(value.productGuideTemplate!==undefined&&!['editorial','compact','minimal'].includes(String(value.productGuideTemplate)))return 'Skin Studio product guide layout is invalid.';
  const siteTextLimits={brandName:60,brandSuffix:60,headerTagline:120,announcementAside:120,headerCtaLabel:80,footerIntro:1200,footerStamp:120,footerExploreHeading:80,footerReadHeading:80,footerNoteHeading:100,footerNoteBody:1800,footerBottomTagline:180,footerCopyright:80,announcement:180,footerNote:1800,shopEyebrow:120,shopHeadline:180,shopHeadlineEmphasis:180,shopDescription:1200,journalEyebrow:120,journalHeadline:180,journalHeadlineEmphasis:180,journalDescription:1200,savedEyebrow:120,savedHeadline:180,savedHeadlineEmphasis:180,savedDescription:1200};
  for(const [key,max] of Object.entries(siteTextLimits)){if(value[key]!==undefined&&(typeof value[key]!=='string'||value[key].length>max))return 'Skin Studio '+key+' must be text no longer than '+max+' characters.';}
  for(const key of ['showSearch','showSaved','showHeaderCta'])if(value[key]!==undefined&&typeof value[key]!=='boolean')return 'Skin Studio '+key+' must be true or false.';
  const validateSiteLinks=(items,label,max)=>{
    if(items===undefined)return null;
    if(!Array.isArray(items))return label+' must be a list.';
    if(items.length>max)return label+' supports up to '+max+' links.';
    const ids=new Set();
    for(const item of items){
      if(!item||typeof item!=='object'||Array.isArray(item))return label+' contains an invalid link.';
      const id=String(item.id||''),text=String(item.label||''),path=String(item.url||'');
      if(!id||id.length>80||ids.has(id))return label+' link IDs must be unique and under 80 characters.';
      ids.add(id);
      if(!text.trim()||text.length>80)return label+' link labels must be 1–80 characters.';
      if(path.length>240||!path.startsWith('/')||path.startsWith('//')||path.includes(String.fromCharCode(10))||path.includes(String.fromCharCode(13)))return label+' destinations must be safe internal paths such as /shop or /journal.';
      if(item.visible!==undefined&&typeof item.visible!=='boolean')return label+' visibility must be true or false.';
    }
    return null;
  };
  for(const [key,label,max] of [['navigationItems','Navigation',20],['footerExploreLinks','Footer Explore links',12],['footerReadLinks','Footer Read links',12]]){
    const linkError=validateSiteLinks(value[key],label,max);if(linkError)return linkError;
  }
  if(value.productGuideFields!==undefined){
    const keys=['benefits','skinTypes','concerns','ingredients','usage','warnings','recommendations','size'];
    if(!value.productGuideFields||typeof value.productGuideFields!=='object'||Array.isArray(value.productGuideFields))return 'Skin Studio product guide visibility settings must be an object.';
    if(keys.some(key=>value.productGuideFields[key]!==undefined&&typeof value.productGuideFields[key]!=='boolean'))return 'Skin Studio product guide visibility values must be true or false.';
  }
  const allowedTypes=new Set(['hero','product-grid','editorial','featured-products','category-grid','journal-grid','routine-finder','image-block']);
  const checkSections=(sections,label)=>{
    if(!Array.isArray(sections))return label+' sections must be an array.';
    if(sections.length>40)return label+' supports up to 40 sections.';
    const ids=new Set();
    for(const section of sections){
      if(!section||typeof section!=='object'||Array.isArray(section))return 'Every '+label.toLowerCase()+' section must be an object.';
      if(!allowedTypes.has(String(section.type||'')))return 'A '+label.toLowerCase()+' section has an unsupported type.';
      const id=String(section.id||'');
      if(!id||id.length>80)return 'Every '+label.toLowerCase()+' section needs a short ID.';
      if(ids.has(id))return label+' section IDs must be unique.';
      ids.add(id);
      if(section.title!==undefined&&String(section.title).length>180)return label+' section titles are limited to 180 characters.';
      if(section.text!==undefined&&String(section.text).length>3000)return label+' section text is too long.';
      if(section.eyebrow!==undefined&&String(section.eyebrow).length>100)return label+' section eyebrows are limited to 100 characters.';
      if(section.image){try{if(new URL(section.image).protocol!=='https:')return label+' section image must use HTTPS.';}catch{return label+' section image URL is invalid.';}}
      if(section.backgroundColor!==undefined&&section.backgroundColor!==''&&!/^#[0-9a-f]{6}$/i.test(String(section.backgroundColor)))return label+' section background color is invalid.';
      if(section.imageAlignment!==undefined&&!['left','center','right'].includes(String(section.imageAlignment)))return label+' image alignment must be left, center, or right.';
      if(section.imageWidth!==undefined&&![20,30,40,50,60,70,80,90,100].includes(Number(section.imageWidth)))return label+' image width must be between 20% and 100%.';
      if(section.imageFreePosition!==undefined&&typeof section.imageFreePosition!=='boolean')return label+' free image positioning must be a boolean.';
      for(const key of ['imagePositionX','imagePositionY'])if(section[key]!==undefined&&(!Number.isFinite(Number(section[key]))||Number(section[key])<0||Number(section[key])>100))return label+' image positions must be between 0% and 100%.';
      if(section.product_ids!==undefined){
        if(!Array.isArray(section.product_ids)||section.product_ids.length>60)return 'A '+label.toLowerCase()+' section can place up to 60 products.';
        if(section.product_ids.some(id=>!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id))))return 'A placed product has an invalid product ID.';
      }
      if(section.columns!==undefined&&!([2,3,4].includes(Number(section.columns))))return label+' grid columns must be 2, 3, or 4.';
      if(section.filter!==undefined&&!['all','featured','top_pick','trending'].includes(String(section.filter)))return 'A '+label.toLowerCase()+' product filter is invalid.';
    }
    return null;
  };
  if(value.sections!==undefined&&!Array.isArray(value.sections))return 'Skin Studio sections must be an array.';
  const sections=Array.isArray(value.sections)?value.sections:[];
  const homeError=checkSections(sections,'Skin Studio');
  if(homeError)return homeError;
  if(options.requireProductGrid!==false&&!sections.some(section=>section.visible!==false&&(section.type==='product-grid'||section.type==='featured-products')))return 'Skin Studio needs at least one visible product grid.';
  if(value.pages!==undefined&&!Array.isArray(value.pages))return 'Skin Studio pages must be an array.';
  const pages=Array.isArray(value.pages)?value.pages:[];
  if(pages.length>30)return 'Skin Studio supports up to 30 custom pages.';
  const slugs=new Set(['home','shop','saved','journal']);
  for(const page of pages){
    if(!page||typeof page!=='object'||Array.isArray(page))return 'Every custom page must be an object.';
    const slug=String(page.slug||'');
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>80)return 'Every custom page needs a valid URL slug.';
    if(slugs.has(slug))return 'A custom page uses a reserved or duplicate URL slug.';
    slugs.add(slug);
    if(String(page.title||'').length>120)return 'Custom page titles are limited to 120 characters.';
    if(String(page.description||'').length>1200)return 'Custom page descriptions are limited to 1200 characters.';
    const pageError=checkSections(page.sections||[],'Custom page');
    if(pageError)return pageError;
  }
  if(value.customCategories!==undefined&&!Array.isArray(value.customCategories))return 'Skin Studio categories must be an array.';
  const cats=Array.isArray(value.customCategories)?value.customCategories:[];
  if(cats.length>60)return 'Skin Studio supports up to 60 custom categories.';
  const categorySlugs=new Set();
  for(const category of cats){
    if(!category||typeof category!=='object'||Array.isArray(category))return 'Every custom category must be an object.';
    const slug=String(category.slug||'');
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>80)return 'Every custom category needs a valid slug.';
    if(categorySlugs.has(slug))return 'Custom category slugs must be unique.';
    categorySlugs.add(slug);
    if(String(category.name||'').length>100)return 'Custom category names are limited to 100 characters.';
    if(String(category.description||'').length>1000)return 'Custom category descriptions are limited to 1000 characters.';
    if(category.image){try{if(new URL(category.image).protocol!=='https:')return 'Custom category images must use HTTPS.';}catch{return 'Custom category image URL is invalid.';}}
  }
  if(value.productCategoryMap!==undefined&&(!value.productCategoryMap||typeof value.productCategoryMap!=='object'||Array.isArray(value.productCategoryMap)))return 'Product category mapping must be an object.';
  if(value.productCategoryMap&&Object.keys(value.productCategoryMap).length>500)return 'Skin Studio can map up to 500 products to custom categories.';
  if(value.productCategoryMap&&Object.entries(value.productCategoryMap).some(([id,slug])=>String(id).length>100||String(slug).length>100))return 'A product category mapping is too long.';
  return null;
}
function productTitleQualityIssue(value){
  const name=cleanText(value,180);
  if(!name||/^(?:amazon(?:\.com)?|temu)(?:\s+product)?$/i.test(name))return 'This title is missing a real product name.';
  if(/^(?:azon\.|mazon\.com\b|isit the\b|isit\s+the\s+tore\b)/i.test(name))return 'This title appears to contain retailer-page text instead of the product name.';
  const words=name.match(/[A-Za-z0-9]+(?:['’][A-Za-z]+)*/g)||[];
  const isolated=words.filter(word=>/^[A-Za-z]$/.test(word)).length;
  if(words.length>=6&&isolated>=2)return 'This title appears incomplete or corrupted. Correct it from the retailer listing before publishing.';
  if(words.length>=10&&looksFragmentedText(name))return 'This title appears incomplete or corrupted. Correct it from the retailer listing before publishing.';
  if(/\b(?:ndles|omatherapy|rfect|ristmas|lentine|rthdays|iversaries)\b/i.test(name)&&/\b(?:isit|azon|rand|omedics|ahome|ndstone)\b/i.test(name))return 'This title appears incomplete or corrupted. Correct it from the retailer listing before publishing.';
  return '';
}
function isDisplayableProductImage(value){
  if(!isValidHttpUrl(value))return false;
  const url=String(value).toLowerCase();
  return !/(?:amazon-avatars-global|transparent-pixel|aax-[^/]+\/e\/is\/|\/nav[-_]|sprite|spacer|pixel\b|tracking)/i.test(url);
}
function validateProduct(product){
  if(!product||typeof product!=='object')return 'Product data is required.';
  const name=cleanText(product.name,180);
  const slug=cleanText(product.slug,180);
  const kind=cleanText(product.kind,40);
  if(!name||name==='placeholder')return 'Product name is required.';
  if(!slug||slug==='placeholder'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))return 'A valid product slug is required.';
  if(!['shop','find','learn'].includes(kind))return 'Product type must be shop, find, or learn.';
  if(product.display_price!==undefined&&product.display_price!==null&&(!Number.isFinite(Number(product.display_price))||Number(product.display_price)<0))return 'Product price is invalid.';
  if(product.published===true){
    const retailerIdentity=[product.retailer,product.source_type,product.destination_url,product.amazon_source_url,product.source_url].filter(Boolean).join(' ').toLowerCase();
    if(kind==='shop'&&/\b(?:amazon|temu)\b/i.test(retailerIdentity))return 'Amazon and Temu affiliate links must use the Finds catalog, not direct-checkout Shop products.';
    const titleIssue=productTitleQualityIssue(name);if(titleIssue)return titleIssue;
    const images=Array.isArray(product.image_urls)?product.image_urls.filter(isDisplayableProductImage):(isDisplayableProductImage(product.image_url)?[product.image_url]:[]);
    if(!images.length)return 'A published product needs a real product image, not a retailer logo, placeholder, or tracking image.';
    if(!isValidHttpUrl(product.destination_url))return 'A published product needs a valid destination or affiliate URL.';
    const customerDescription=cleanText(product.store_description,12000)||cleanText(product.description,12000);
    if(customerDescription&&looksFragmentedText(customerDescription))return 'The customer-facing description appears incomplete or corrupted. Correct it before publishing.';
  }
  return null;
}
function sbHeaders(env,service=false){
  const key=service?env.SUPABASE_SERVICE_ROLE_KEY:env.SUPABASE_ANON_KEY;
  return {'apikey':key||'','Authorization':'Bearer '+(key||''),'Content-Type':'application/json'};
}
async function supabaseUser(request,env){
  const auth=String(request.headers.get('authorization')||'');
  if(!/^Bearer\s+\S+$/i.test(auth)||!env.SUPABASE_URL||!env.SUPABASE_ANON_KEY)return null;
  try{
    const r=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:auth}});
    if(!r.ok)return null;
    return await r.json();
  }catch{return null;}
}
async function adminUser(request,env){
  const user=await supabaseUser(request,env);
  if(!user||!env.SUPABASE_SERVICE_ROLE_KEY)return null;
  try{
    const r=await fetch(env.SUPABASE_URL+'/rest/v1/profiles?id=eq.'+encodeURIComponent(user.id)+'&select=id,is_admin,role&limit=1',{headers:sbHeaders(env,true)});
    if(!r.ok)return null;
    const rows=await r.json();
    const profile=rows[0];
    return profile&&(profile.is_admin===true||profile.role==='admin')?user:null;
  }catch{return null;}
}
async function supabaseRest(env,method,table,payload=null,query=''){
  const url=env.SUPABASE_URL+'/rest/v1/'+table+String(query||'');
  const headers={...sbHeaders(env,true),'Prefer':'return=representation'};
  // Catalog and admin reads must reflect the latest saved record. Some edge
  // paths can retain GET responses even when the browser requests no-store.
  if(String(method).toUpperCase()==='GET'){
    headers['Cache-Control']='no-cache, no-store, max-age=0';
    headers['Pragma']='no-cache';
  }
  const options={method,headers};
  if(String(method).toUpperCase()==='GET'){
    // Bypass any upstream Cloudflare cache rule on Supabase REST reads.
    options.cf={cacheTtl:0,cacheEverything:false};
  }
  if(payload!==undefined&&payload!==null){
    options.body=JSON.stringify(payload);
  }
  const response=await fetch(url,options);
  const raw=await response.text();
  return {
    ok:response.ok,
    status:response.status,
    text:async()=>raw,
    json:async()=>{try{return raw?JSON.parse(raw):null}catch(e){return null;}}
  };
}