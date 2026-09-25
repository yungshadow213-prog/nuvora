
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) {
        const limited = rateLimit(request, 'api', 120, 60000);
        if (limited) return json({error:'Too many requests. Please try again shortly.'},429,{'retry-after':String(limited)});
      }
      if (request.method === 'OPTIONS') return new Response(null,{status:204});
      if (url.pathname === '/admin' || url.pathname === '/admin/') {
        return env.ASSETS.fetch(new Request(new URL('/admin.html',request.url), {method:'GET',headers:request.headers}));
      }
      if (url.pathname === '/api/health') return json({ok:true,configured:configured(env)});
      if (url.pathname === '/api/config') return json({supabaseUrl:env.SUPABASE_URL||'',supabaseAnonKey:env.SUPABASE_ANON_KEY||''});

      if (url.pathname === '/api/analytics/events' && request.method === 'POST') {
        const wait=rateLimit(request,'analytics',180,60000);
        if(wait) return json({error:'Analytics rate limit reached.'},429,{'retry-after':String(wait)});
        const event=await body(request,128*1024);
        const name=String(event.event_name||'').trim().slice(0,80);
        if(!/^[a-z0-9_.-]+$/.test(name)) return json({error:'Invalid analytics event name.'},400);
        const row={event_name:name,product_id:event.product_id||null,session_id:String(event.session_id||'').slice(0,80)||null,metadata:event.metadata&&typeof event.metadata==='object'?event.metadata:{}};
        const r=await supabaseRest(env,'POST','analytics_events',row);
        if(!r.ok) return json({error:'Analytics event could not be saved.'},400);
        return json({ok:true});
      }

      if(url.pathname==='/api/admin/diagnostics'&&request.method==='GET'){
        const checks={environment:configured(env).supabase,auth:false,admin:false,products:false,settings:false,social:false,shopifyEnvironment:configured(env).shopifyAdmin,shopifyAuth:false,shopifyProducts:false};
        const u=await supabaseUser(request,env); checks.auth=!!u;
        if(u&&env.SUPABASE_SERVICE_ROLE_KEY){
          const pr=await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(u.id)}&select=*`,{headers:sbHeaders(env,true)});
          if(pr.ok){const rows=await pr.json();const p=rows[0];checks.admin=!!p&&(p.is_admin===true||p.role==='admin');}
          for(const t of ['products','store_settings','social_posts']){
            const rr=await supabaseRest(env,'GET',t,undefined,'?select=*&limit=1');
            checks[t==='store_settings'?'settings':t==='social_posts'?'social':'products']=rr.ok;
          }
          if(checks.admin&&checks.shopifyEnvironment){
            try{
              const data=await shopifyGraphql(env,'{ products(first: 1) { edges { node { id title } } } }',{},true);
              checks.shopifyAuth=true;
              checks.shopifyProducts=!!data?.products;
            }catch(e){}
          }
        }
        const ok=checks.environment&&checks.auth&&checks.admin&&checks.products&&checks.settings&&checks.social&&checks.shopifyEnvironment&&checks.shopifyAuth&&checks.shopifyProducts;
        return json({ok,checks});
      }

      if(url.pathname==='/api/amazon/import'&&request.method==='POST'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        if(!configured(env).amazon)return json({error:'Amazon Creators API is not configured'},503);
        const {url:amazonUrl}=await body(request,256*1024);
        if(!amazonUrl||!validUrl(amazonUrl))return json({error:'A valid Amazon product URL is required'},400);
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
        if(!configured(env).shopify)return json({error:'Shopify Storefront API is not configured'},503);
        const {lines}=await body(request); if(!Array.isArray(lines)||!lines.length)return json({error:'Cart lines required'},400);
        const data=await shopifyGraphql(env,`mutation CartCreate($input: CartInput){cartCreate(input:$input){cart{id checkoutUrl totalQuantity}userErrors{field message}warnings{code message}}}`,{input:{lines}},false);
        const p=data.cartCreate; if(p.userErrors?.length)return json({error:p.userErrors.map(x=>x.message).join('; ')},400);
        return json(p.cart);
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
        const data=await shopifyGraphql(env,'query{products(first:100,sortKey:TITLE){nodes{id title handle descriptionHtml vendor productType status updatedAt featuredImage{url altText} images(first:20){nodes{url altText}} variants(first:100){nodes{id title price compareAtPrice selectedOptions{name value}}}}}}',{},true);
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
              shopify_product_id:p.id,shopify_variant_id:variant?.id||null
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

        // Existing products are already in Nuvora. Keep this sync request cheap;
        // they can be refreshed by a later sync without hitting one request per item.
        for(const x of existingItems){
          results.push({ok:true,skipped:true,synced:false,id:x.source.id,title:x.source.title});
        }

        if(newItems.length){
          const payloadRows=newItems.map(x=>x.product);
          let created=await supabaseRest(env,'POST','products',payloadRows);
          if(!created.ok){
            const errText=(await created.text()).slice(0,2000);
            // If the live database/cache does not yet expose the Shopify ID
            // columns, retry the whole batch once without those two columns.
            if(/PGRST204|schema cache|Could not find the '.*' column|shopify_product_id|shopify_variant_id/i.test(errText)){
              const legacyRows=payloadRows.map(row=>{
                const copy={...row};
                delete copy.shopify_product_id;
                delete copy.shopify_variant_id;
                return copy;
              });
              created=await supabaseRest(env,'POST','products',legacyRows);
              if(!created.ok){
                const legacyErr=(await created.text()).slice(0,2000);
                for(const x of newItems)results.push({ok:false,skipped:false,id:x.source.id,title:x.source.title,error:legacyErr,initialError:errText});
              }else{
                for(const x of newItems)results.push({ok:true,skipped:false,id:x.source.id,title:x.source.title,syncedWithoutShopifyIds:true});
              }
            }else{
              for(const x of newItems)results.push({ok:false,skipped:false,id:x.source.id,title:x.source.title,error:errText});
            }
          }else{
            for(const x of newItems)results.push({ok:true,skipped:false,id:x.source.id,title:x.source.title});
          }
        }

        return json({
          ok:results.every(x=>x.ok),
          results,
          imported:results.filter(x=>x.ok&&!x.skipped).length,
          skipped:results.filter(x=>x.skipped).length,
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
        const r=await supabaseRest(env,'POST',table,item); if(!r.ok)return json({error:await r.text()},400); return json((await r.json())[0]);
      }

      if(url.pathname==='/api/admin/analytics'&&request.method==='GET'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const r=await supabaseRest(env,'GET','analytics_events',undefined,'?select=event_name&limit=5000'); if(!r.ok)return json({error:await r.text()},500);
        const rows=await r.json(),counts={}; for(const x of rows)counts[x.event_name]=(counts[x.event_name]||0)+1;
        return json({counts,total:rows.length});
      }

      if(url.pathname==='/api/admin/settings'&&(request.method==='GET'||request.method==='PATCH')){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        if(request.method==='GET'){
          const r=await supabaseRest(env,'GET','store_settings',undefined,'?id=eq.true&select=*'); if(!r.ok)return json({error:await r.text()},500);
          return json((await r.json())[0]||{});
        }
        const patch=await body(request); delete patch.id; patch.updated_at=new Date().toISOString();
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
        for(const raw of items){
          const product={...raw,published:false,slug:String(raw.slug||raw.name||'product').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,150)+'-'+randHex(6)};
          const validation=validateProduct(product); if(validation){results.push({ok:false,name:raw.name||'',error:validation});continue;}
          if(product.image_url&&!validUrl(product.image_url))product.image_url=null;
          const r=await supabaseRest(env,'POST','products',product);
          if(!r.ok){results.push({ok:false,name:raw.name||'',error:(await r.text()).slice(0,500)});continue;}
          results.push({ok:true,name:product.name});
        }
        return json({ok:results.every(x=>x.ok),results,imported:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length});
      }

      if(url.pathname==='/api/admin/products'&&request.method==='GET'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const r=await supabaseRest(env,'GET','products',undefined,'?select=*&order=created_at.desc'); if(!r.ok)return json({error:await r.text()},500); return json(await r.json());
      }
      if(url.pathname==='/api/admin/products'&&request.method==='POST'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const product=await body(request,512*1024); const validation=validateProduct(product); if(validation)return json({error:validation},400);
        product.name=String(product.name).trim().slice(0,180); product.slug=String(product.slug).trim().toLowerCase().slice(0,180); product.published=product.published===true;
        product.description=cleanText(product.description,10000); product.features=cleanText(product.features,10000); product.brand=cleanText(product.brand,180);
        if(Array.isArray(product.image_urls))product.image_urls=product.image_urls.filter(validUrl).slice(0,30);
        if(product.image_url&&!validUrl(product.image_url))product.image_url=null;
        const r=await supabaseRest(env,'POST','products',product); if(!r.ok)return json({error:'Supabase rejected the product.',detail:(await r.text()).slice(0,2000)},400);
        return json((await r.json())[0]);
      }

      const productMatch=url.pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
      if(productMatch&&(request.method==='PATCH'||request.method==='DELETE')){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const id=decodeURIComponent(productMatch[1]);
        if(request.method==='PATCH'){
          const patch=await body(request);
          const validation=validateProduct({...patch,name:patch.name||'placeholder',slug:patch.slug||'placeholder',kind:patch.kind||'shop'});
          if(validation && (patch.name||patch.slug||patch.kind||patch.display_price||patch.destination_url||patch.image_url||patch.image_urls))return json({error:validation},400);
          if(patch.name)patch.name=String(patch.name).trim().slice(0,180); if(patch.slug)patch.slug=String(patch.slug).trim().toLowerCase().slice(0,180);
          if(Array.isArray(patch.image_urls))patch.image_urls=patch.image_urls.filter(validUrl).slice(0,30);
          const r=await supabaseRest(env,'PATCH','products',patch,`?id=eq.${encodeURIComponent(id)}`); if(!r.ok)return json({error:await r.text()},400);
          const rows=await r.json(); return json(rows[0]||null);
        }
        const r=await supabaseRest(env,'DELETE','products',undefined,`?id=eq.${encodeURIComponent(id)}`); if(!r.ok)return json({error:await r.text()},400);
        return json({ok:true});
      }

      // Let Cloudflare Assets serve the SPA shell for every non-API route.
      // This is required for client-side routes such as /shop, /finds, /cart, etc.
      // and also gives unknown paths the same SPA fallback instead of a JSON 404.
      return env.ASSETS.fetch(request);
    } catch(e) {
      return json({error:e?.message||'Server error'},500);
    }
  }
};

const buckets = new Map();
function rateLimit(request,key,limit=120,windowMs=60000){
  const ip=(request.headers.get('cf-connecting-ip')||request.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim();
  const id=ip+'|'+key, now=Date.now(); let b=buckets.get(id);
  if(!b||now-b.start>=windowMs){b={start:now,count:0};buckets.set(id,b);}
  b.count++; if(b.count>limit)return Math.max(1,Math.ceil((windowMs-(now-b.start))/1000)); return 0;
}
function json(payload,status=200,extra={}){return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json','cache-control':'no-store',...extra}});}
async function body(request,limit=1024*1024){const len=Number(request.headers.get('content-length')||0);if(len>limit)throw new Error('Request body is too large.');const text=await request.text();if(text.length>limit)throw new Error('Request body is too large.');return text?JSON.parse(text):{};}
function env(name){return globalThis.__ENV?.[name]||'';}
function configured(env){return {supabase:!!env.SUPABASE_URL&&!!env.SUPABASE_ANON_KEY&&!!env.SUPABASE_SERVICE_ROLE_KEY,shopify:!!(env.SHOPIFY_SHOP||env.SHOPIFY_STORE_DOMAIN),shopifyAdmin:!!(env.SHOPIFY_SHOP||env.SHOPIFY_STORE_DOMAIN)&&!!env.SHOPIFY_CLIENT_ID&&!!env.SHOPIFY_CLIENT_SECRET,amazon:!!env.AMAZON_CLIENT_ID&&!!env.AMAZON_CLIENT_SECRET&&!!env.AMAZON_PARTNER_TAG};}
function sbHeaders(env,service=true){const key=service?env.SUPABASE_SERVICE_ROLE_KEY:env.SUPABASE_ANON_KEY;return {apikey:key,authorization:'Bearer '+key,'content-type':'application/json','prefer':'return=representation'};}
async function supabaseUser(request,env){const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');if(!token||!env.SUPABASE_URL)return null;const r=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_ANON_KEY,authorization:'Bearer '+token}});return r.ok?await r.json():null;}
async function adminUser(request,env){const u=await supabaseUser(request,env);if(!u||!env.SUPABASE_SERVICE_ROLE_KEY)return null;const r=await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(u.id)}&select=*`,{headers:sbHeaders(env,true)});if(!r.ok)return null;const rows=await r.json(),profile=rows[0];return profile&&(profile.is_admin===true||profile.role==='admin')?u:null;}
async function supabaseRest(env,method,table,data,query=''){const r=await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${query||''}`,{method,headers:sbHeaders(env,true),body:data===undefined?undefined:JSON.stringify(data)});return r;}
function validUrl(v){if(!v)return true;try{const u=new URL(v);return ['http:','https:'].includes(u.protocol)}catch{return false}}
function cleanText(v,max=5000){return v==null?null:String(v).trim().slice(0,max)||null}
function validateProduct(p){if(!p||!cleanText(p.name,180))return 'Product name is required.';if(!cleanText(p.slug,180))return 'Product slug is required.';if(!['shop','find','learn'].includes(p.kind))return 'Product type must be shop, find, or learn.';if(p.display_price!==null&&p.display_price!==undefined&&p.display_price!==''&&(Number.isNaN(Number(p.display_price))||Number(p.display_price)<0))return 'Price must be a non-negative number.';for(const k of ['destination_url','amazon_source_url','image_url'])if(p[k]&&!validUrl(p[k]))return `${k} must be a valid http(s) URL.`;if(p.image_urls!==undefined&&!Array.isArray(p.image_urls))return 'image_urls must be an array.';if(Array.isArray(p.image_urls)&&p.image_urls.length>30)return 'A product can have at most 30 images.';return null}
function asinFromUrl(url){const m=String(url).match(/(?:\/dp\/|\/gp\/product\/|\/dp%2F)([A-Z0-9]{10})/i);return m?m[1].toUpperCase():null}
let amazonToken={value:null,expires:0};
async function getAmazonToken(env){if(amazonToken.value&&Date.now()<amazonToken.expires)return amazonToken.value;const r=await fetch(env.AMAZON_TOKEN_ENDPOINT||'https://api.amazon.com/auth/o2/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'client_credentials',client_id:env.AMAZON_CLIENT_ID,client_secret:env.AMAZON_CLIENT_SECRET,scope:'creatorsapi::default'})});if(!r.ok)throw new Error('Amazon authentication failed');const j=await r.json();amazonToken={value:j.access_token,expires:Date.now()+(j.expires_in-60)*1000};return amazonToken.value}
async function amazonGetItem(env,asin){const token=await getAmazonToken(env);const marketplace=env.AMAZON_MARKETPLACE||'www.amazon.com';const payload={itemIds:[asin],itemIdType:'ASIN',partnerTag:env.AMAZON_PARTNER_TAG,marketplace,resources:['images.primary.large','images.primary.medium','images.variants.large','itemInfo.title','itemInfo.features','itemInfo.byLineInfo','itemInfo.productInfo','offersV2.listings.price','offersV2.listings.availability']};const r=await fetch('https://creatorsapi.amazon/catalog/v1/getItems',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-marketplace':marketplace},body:JSON.stringify(payload)});if(!r.ok)throw new Error(`Amazon API returned ${r.status}`);const j=await r.json();return j.itemsResult?.items?.[0]||null}
let shopifyAdminToken={value:null,expires:0};
async function getShopifyAdminToken(env){
  if(shopifyAdminToken.value&&Date.now()<shopifyAdminToken.expires)return shopifyAdminToken.value;
  const shop=env.SHOPIFY_SHOP||env.SHOPIFY_STORE_DOMAIN;
  const clientId=env.SHOPIFY_CLIENT_ID;
  const clientSecret=env.SHOPIFY_CLIENT_SECRET;
  if(!shop||!clientId||!clientSecret)throw new Error('Shopify Admin credentials are not configured');
  const r=await fetch(`https://${shop}/admin/oauth/access_token`,{
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      grant_type:'client_credentials',
      client_id:clientId,
      client_secret:clientSecret
    })
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.access_token)throw new Error(j.error_description||j.error||`Shopify authentication returned ${r.status}`);
  shopifyAdminToken={value:j.access_token,expires:Date.now()+Math.max(60,(Number(j.expires_in)||86400)-60)*1000};
  return shopifyAdminToken.value;
}
async function shopifyGraphql(env,query,variables={},admin=false){
  const domain=env.SHOPIFY_SHOP||env.SHOPIFY_STORE_DOMAIN;
  let token;
  if(admin)token=await getShopifyAdminToken(env);
  else token=env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  if(!domain)throw new Error('Shopify is not configured');
  const version=env.SHOPIFY_API_VERSION||'2026-07';
  const base=admin?`https://${domain}/admin/api/${version}/graphql.json`:`https://${domain}/api/${version}/graphql.json`;
  const r=await fetch(base,{method:'POST',headers:{'content-type':'application/json',...(admin?{'X-Shopify-Access-Token':token}:{'X-Shopify-Storefront-Access-Token':token})},body:JSON.stringify({query,variables})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.errors)throw new Error(j.errors?.[0]?.message||`Shopify API returned ${r.status}`);
  return j.data;
}
function autoCategory(title,description,productType,categories){
  const t=(String(title||'')+' '+String(description||'')+' '+String(productType||'')).toLowerCase();
  const rules=[
    ['fashion-men',['men','mens','male','jogger','sweatpants','trousers','pants','shirt','hoodie','jacket','jeans']],
    ['fashion-women',['women','womens','female','dress','skirt','blouse','leggings']],
    ['fashion-kids',['kids','children','child','boy','girl']],
    ['fashion-shoes',['shoe','sneaker','boots','sandal','footwear']],
    ['fashion-bags',['bag','backpack','handbag','purse','wallet']],
    ['fashion-accessories',['watch','belt','hat','cap','scarf','sunglasses','necklace','bracelet']],
    ['electronics-phone',['iphone','android','phone case','phone charger','power bank','screen protector']],
    ['electronics-computer',['keyboard','mouse','laptop','computer','webcam','usb hub','monitor']],
    ['electronics-audio',['headphone','earbud','speaker','microphone','soundbar']],
    ['electronics-gaming',['gaming','gamepad','controller','console']],
    ['home-kitchen',['kitchen','cookware','utensil','pan ','pot ','knife','cutlery']],
    ['home-bedroom',['bedroom','pillow','bedsheet','blanket','mattress']],
    ['home-bathroom',['bathroom','shower','towel','toilet']],
    ['home-storage',['storage','organizer','shelf','shelving','container']],
    ['home-decor',['home decor','decoration','vase','wall art','curtain','lamp']],
    ['beauty-skincare',['skincare','skin care','serum','moisturizer','cleanser','sunscreen']],
    ['beauty-hair',['shampoo','conditioner','wig','hair dryer','hair brush']],
    ['beauty-makeup',['makeup','foundation','lipstick','mascara','eyeshadow','concealer']],
    ['sports-gym',['gym','fitness','workout','running','yoga','dumbbell']],
    ['sports-outdoor',['camping','hiking','outdoor','tent','fishing']],
    ['automotive',['car accessory','car accessories','automotive','vehicle']],
    ['pets',['pet','dog','cat','leash','collar']],
    ['gifts',['gift','birthday','present']]
  ];
  for(const [slug,words] of rules) if(words.some(w=>t.includes(w))){
    const c=(categories||[]).find(x=>x.slug===slug);
    if(c)return c.id;
  }
  return (categories||[]).find(x=>x.slug==='gifts-lifestyle')?.id||null;
}
function randHex(bytes){const a=new Uint8Array(bytes);crypto.getRandomValues(a);return Array.from(a,x=>x.toString(16).padStart(2,'0')).join('')}

