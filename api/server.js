// Lightweight .env loader (keeps local startup working even when npm dependencies are not installed).
const fs = require('fs');
const path = require('path');
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 1) continue;
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if ((value.startsWith('\"') && value.endsWith('\"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
const http = require('http');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const port = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.sql':'text/plain','.csv':'text/csv'};
const rateBuckets=new Map();
function clientIp(req){return String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim();}
function rateLimit(req,key,limit=120,windowMs=60000){const now=Date.now(),id=clientIp(req)+'|'+key;let b=rateBuckets.get(id);if(!b||now-b.start>=windowMs){b={start:now,count:0};rateBuckets.set(id,b);}b.count++;if(b.count>limit)return Math.max(1,Math.ceil((windowMs-(now-b.start))/1000));return 0;}
setInterval(()=>{const cutoff=Date.now()-120000;for(const [k,b] of rateBuckets)if(b.start<cutoff)rateBuckets.delete(k);},60000).unref();

function json(res,status,payload){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(payload));}
async function body(req,limit=1024*1024){let size=0,s='';for await(const c of req){size+=c.length;if(size>limit)throw new Error('Request body is too large.');s+=c;}return s?JSON.parse(s):{};}
function env(name){return process.env[name]||'';}
function configured(){return {supabase:!!env('SUPABASE_URL')&&!!env('SUPABASE_ANON_KEY')&&!!env('SUPABASE_SERVICE_ROLE_KEY'),shopify:!!env('SHOPIFY_STORE_DOMAIN')&&!!env('SHOPIFY_STOREFRONT_ACCESS_TOKEN'),shopifyAdmin:!!env('SHOPIFY_STORE_DOMAIN')&&!!env('SHOPIFY_ADMIN_ACCESS_TOKEN'),amazon:!!env('AMAZON_CLIENT_ID')&&!!env('AMAZON_CLIENT_SECRET')&&!!env('AMAZON_PARTNER_TAG')}}
async function supabaseUser(req){
  const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!token||!env('SUPABASE_URL')) return null;
  const r=await fetch(env('SUPABASE_URL')+'/auth/v1/user',{headers:{apikey:env('SUPABASE_ANON_KEY'),authorization:'Bearer '+token}});
  return r.ok?await r.json():null;
}
async function adminUser(req){
  const u=await supabaseUser(req);
  if(!u) return null;
  if(!env('SUPABASE_URL')||!env('SUPABASE_SERVICE_ROLE_KEY')) return null;
  const r=await fetch(`${env('SUPABASE_URL')}/rest/v1/profiles?id=eq.${encodeURIComponent(u.id)}&select=*`,{headers:{apikey:env('SUPABASE_SERVICE_ROLE_KEY'),authorization:'Bearer '+env('SUPABASE_SERVICE_ROLE_KEY')}});
  if(!r.ok)return null;
  const rows=await r.json(); const profile=rows[0];
  return profile && (profile.is_admin===true || profile.role==='admin') ? u : null;
}
async function supabaseRest(method,table,data,query=''){
  const h={apikey:env('SUPABASE_SERVICE_ROLE_KEY'),authorization:'Bearer '+env('SUPABASE_SERVICE_ROLE_KEY'),'content-type':'application/json','prefer':'return=representation'};
  return fetch(`${env('SUPABASE_URL')}/rest/v1/${table}${query}`,{method,headers:h,body:data===undefined?undefined:JSON.stringify(data)});
}
function asinFromUrl(url){const m=url.match(/(?:\/dp\/|\/gp\/product\/|\/dp%2F)([A-Z0-9]{10})/i);return m?m[1].toUpperCase():null;}
let amazonToken={value:null,expires:0};
async function getAmazonToken(){
  if(amazonToken.value && Date.now()<amazonToken.expires)return amazonToken.value;
  const r=await fetch(env('AMAZON_TOKEN_ENDPOINT')||'https://api.amazon.com/auth/o2/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'client_credentials',client_id:env('AMAZON_CLIENT_ID'),client_secret:env('AMAZON_CLIENT_SECRET'),scope:'creatorsapi::default'})});
  if(!r.ok)throw new Error('Amazon authentication failed'); const j=await r.json(); amazonToken={value:j.access_token,expires:Date.now()+(j.expires_in-60)*1000}; return amazonToken.value;
}
async function amazonGetItem(asin){
  const token=await getAmazonToken();
  const payload={itemIds:[asin],itemIdType:'ASIN',partnerTag:env('AMAZON_PARTNER_TAG'),marketplace:env('AMAZON_MARKETPLACE')||'www.amazon.com',resources:['images.primary.large','images.primary.medium','images.variants.large','itemInfo.title','itemInfo.features','itemInfo.byLineInfo','itemInfo.productInfo','offersV2.listings.price','offersV2.listings.availability']};
  const r=await fetch('https://creatorsapi.amazon/catalog/v1/getItems',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-marketplace':payload.marketplace},body:JSON.stringify(payload)});
  if(!r.ok)throw new Error(`Amazon API returned ${r.status}`); const j=await r.json(); return j.itemsResult?.items?.[0]||null;
}
async function shopifyGraphql(query,variables={},admin=false){
  const domain=env('SHOPIFY_STORE_DOMAIN'); const token=admin?env('SHOPIFY_ADMIN_ACCESS_TOKEN'):env('SHOPIFY_STOREFRONT_ACCESS_TOKEN');
  if(!domain||!token)throw new Error('Shopify is not configured');
  const version=env('SHOPIFY_API_VERSION')||'2026-07'; const base=admin?`https://${domain}/admin/api/${version}/graphql.json`:`https://${domain}/api/${version}/graphql.json`;
  const r=await fetch(base,{method:'POST',headers:{'content-type':'application/json',...(admin?{'X-Shopify-Access-Token':token}:{'X-Shopify-Storefront-Access-Token':token})},body:JSON.stringify({query,variables})});
  const j=await r.json(); if(!r.ok||j.errors)throw new Error(j.errors?.[0]?.message||`Shopify API returned ${r.status}`); return j.data;
}

function validUrl(v){if(!v)return true;try{const u=new URL(v);return ['http:','https:'].includes(u.protocol)}catch{return false}}
function cleanText(v,max=5000){return v==null?null:String(v).trim().slice(0,max)||null}
function validateProduct(product){
  if(!product||!cleanText(product.name,180))return 'Product name is required.';
  if(!cleanText(product.slug,180))return 'Product slug is required.';
  if(!['shop','find','learn'].includes(product.kind))return 'Product type must be shop, find, or learn.';
  if(product.display_price!==null&&product.display_price!==undefined&&product.display_price!==''&&(Number.isNaN(Number(product.display_price))||Number(product.display_price)<0))return 'Price must be a non-negative number.';
  for(const k of ['destination_url','amazon_source_url','image_url'])if(product[k]&&!validUrl(product[k]))return `${k} must be a valid http(s) URL.`;
  if(product.image_urls!==undefined&&!Array.isArray(product.image_urls))return 'image_urls must be an array.';
  if(Array.isArray(product.image_urls)&&product.image_urls.length>30)return 'A product can have at most 30 images.';
  return null;
}
const server=http.createServer(async(req,res)=>{
  try{
    if(req.url.startsWith('/api/')){const wait=rateLimit(req,'api',120,60000);if(wait){res.setHeader('retry-after',String(wait));return json(res,429,{error:'Too many requests. Please try again shortly.'});}}
    if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
    const u=new URL(req.url,`http://${req.headers.host}`);
    if(u.pathname==='/admin'||u.pathname==='/admin/') u.pathname='/admin.html';
    if(u.pathname==='/api/health')return json(res,200,{ok:true,configured:configured()});
    if(u.pathname==='/api/config')return json(res,200,{supabaseUrl:env('SUPABASE_URL'),supabaseAnonKey:env('SUPABASE_ANON_KEY')});
    if(u.pathname==='/api/analytics/events'&&req.method==='POST'){
      const wait=rateLimit(req,'analytics',180,60000); if(wait){res.setHeader('retry-after',String(wait));return json(res,429,{error:'Analytics rate limit reached.'});}
      const event=await body(req,128*1024); const name=String(event.event_name||'').trim().slice(0,80);
      if(!/^[a-z0-9_.-]+$/.test(name))return json(res,400,{error:'Invalid analytics event name.'});
      const row={event_name:name,product_id:event.product_id||null,session_id:String(event.session_id||'').slice(0,80)||null,metadata:event.metadata&&typeof event.metadata==='object'?event.metadata:{}};
      const r=await supabaseRest('POST','analytics_events',row); if(!r.ok)return json(res,400,{error:'Analytics event could not be saved.'}); return json(res,200,{ok:true});
    }

    if(u.pathname==='/api/admin/diagnostics'&&req.method==='GET'){
      const checks={environment:configured().supabase,auth:false,admin:false,products:false,settings:false,social:false};
      const u2=await supabaseUser(req); checks.auth=!!u2;
      if(u2&&env('SUPABASE_SERVICE_ROLE_KEY')){
        const pr=await fetch(`${env('SUPABASE_URL')}/rest/v1/profiles?id=eq.${encodeURIComponent(u2.id)}&select=*`,{headers:{apikey:env('SUPABASE_SERVICE_ROLE_KEY'),authorization:'Bearer '+env('SUPABASE_SERVICE_ROLE_KEY')}});
        if(pr.ok){const rows=await pr.json(); const p=rows[0]; checks.admin=!!p&&(p.is_admin===true||p.role==='admin');}
        for(const t of ['products','store_settings','social_posts']){const rr=await supabaseRest('GET',t,undefined,'?select=*&limit=1'); checks[t==='store_settings'?'settings':t==='social_posts'?'social':'products']=rr.ok;}
      }
      return json(res,200,{ok:Object.values(checks).every(Boolean),checks});
    }

    if(u.pathname==='/api/amazon/import'&&req.method==='POST'){
      const admin=await adminUser(req); if(!admin)return json(res,401,{error:'Admin authentication required'});
      if(!configured().amazon)return json(res,503,{error:'Amazon Creators API is not configured'});
      const {url}=await body(req,256*1024); if(!url||!validUrl(url))return json(res,400,{error:'A valid Amazon product URL is required'}); const asin=asinFromUrl(url||''); if(!asin)return json(res,400,{error:'Could not find an ASIN in that Amazon URL'});
      const item=await amazonGetItem(asin); if(!item)return json(res,404,{error:'Amazon returned no matching item'});
      const listing=item.offersV2?.listings?.[0]; const price=listing?.price?.money;
      const title=item.itemInfo?.title?.displayValue||'Amazon product';
      const features=item.itemInfo?.features?.displayValues||[];
      const brand=item.itemInfo?.byLineInfo?.brand?.displayValue||item.itemInfo?.byLineInfo?.manufacturer?.displayValue||'';
      const images=[item.images?.primary?.large?.url,item.images?.primary?.medium?.url,...(item.images?.variants||[]).flatMap(v=>[v?.large?.url,v?.medium?.url])].filter(Boolean);
      const availability=listing?.availability?.type||listing?.availability?.displayValue||null;
      return json(res,200,{draft:{name:title,slug:`amazon-${asin.toLowerCase()}-${crypto.randomBytes(3).toString('hex')}`,kind:'find',brand,image_url:images[0]||null,image_urls:[...new Set(images)],display_price:price?.amount??null,currency:price?.currency||null,destination_url:item.detailPageURL||url,retailer:'Amazon',amazon_asin:asin,amazon_source_url:url,description:features.join('\n')||null,features:features.join('\n')||null,availability,published:false,amazon_last_synced:new Date().toISOString()}});
    }

    if(u.pathname==='/api/shopify/cart'&&req.method==='POST'){
      if(!configured().shopify)return json(res,503,{error:'Shopify Storefront API is not configured'});
      const {lines}=await body(req); if(!Array.isArray(lines)||!lines.length)return json(res,400,{error:'Cart lines required'});
      const data=await shopifyGraphql(`mutation CartCreate($input: CartInput){cartCreate(input:$input){cart{id checkoutUrl totalQuantity}userErrors{field message}warnings{code message}}}`,{input:{lines}},false);
      const p=data.cartCreate; if(p.userErrors?.length)return json(res,400,{error:p.userErrors.map(x=>x.message).join('; ')}); return json(res,200,p.cart);
    }

    if(u.pathname==='/api/shopify/product'&&req.method==='POST'){
      const admin=await adminUser(req); if(!admin)return json(res,401,{error:'Admin authentication required'});
      if(!configured().shopifyAdmin)return json(res,503,{error:'Shopify Admin API is not configured'});
      const {product}=await body(req); if(!product?.title)return json(res,400,{error:'Product title required'});
      const data=await shopifyGraphql(`mutation ProductCreate($product:ProductCreateInput!){productCreate(product:$product){product{id title handle}userErrors{field message}}}`,{product:{title:product.title,descriptionHtml:product.description||'',status:product.status==='ACTIVE'?'ACTIVE':'DRAFT'}},true);
      const p=data.productCreate; if(p.userErrors?.length)return json(res,400,{error:p.userErrors.map(x=>x.message).join('; ')}); return json(res,200,p.product);
    }

    if((u.pathname==='/api/admin/categories'||u.pathname==='/api/admin/collections')&&(req.method==='GET'||req.method==='POST')){
      const admin=await adminUser(req); if(!admin)return json(res,401,{error:'Admin authentication required'});
      const table=u.pathname.endsWith('categories')?'categories':'collections';
      if(req.method==='GET'){
        const r=await supabaseRest('GET',table,undefined,'?select=*&order=created_at.desc');
        if(!r.ok)return json(res,500,{error:await r.text()}); return json(res,200,await r.json());
      }
      const item=await body(req);
      if(!item.name||!item.slug)return json(res,400,{error:'Name and slug are required'});
      const r=await supabaseRest('POST',table,item); if(!r.ok)return json(res,400,{error:await r.text()});
      return json(res,200,(await r.json())[0]);
    }

    if(u.pathname==='/api/admin/analytics'&&req.method==='GET'){
      const admin=await adminUser(req); if(!admin)return json(res,401,{error:'Admin authentication required'});
      const r=await supabaseRest('GET','analytics_events',undefined,'?select=event_name&limit=5000'); if(!r.ok)return json(res,500,{error:await r.text()});
      const rows=await r.json(); const counts={}; for(const x of rows)counts[x.event_name]=(counts[x.event_name]||0)+1; return json(res,200,{counts,total:rows.length});
    }

    if(u.pathname==='/api/admin/settings'&&(req.method==='GET'||req.method==='PATCH')){
      const admin=await adminUser(req); if(!admin)return json(res,401,{error:'Admin authentication required'});
      if(req.method==='GET'){
        const r=await supabaseRest('GET','store_settings',undefined,'?id=eq.true&select=*');
        if(!r.ok)return json(res,500,{error:await r.text()});
        return json(res,200,(await r.json())[0]||{});
      }
      const patch=await body(req); delete patch.id; patch.updated_at=new Date().toISOString();
      const r=await supabaseRest('PATCH','store_settings',patch,'?id=eq.true');
      if(!r.ok)return json(res,400,{error:await r.text()});
      return json(res,200,(await r.json())[0]||null);
    }

    if(u.pathname==='/api/admin/social-posts'&&(req.method==='GET'||req.method==='POST')){
      const admin=await adminUser(req); if(!admin)return json(res,401,{error:'Admin authentication required'});
      if(req.method==='GET'){
        const r=await supabaseRest('GET','social_posts',undefined,'?select=*&order=created_at.desc');
        if(!r.ok)return json(res,500,{error:await r.text()}); return json(res,200,await r.json());
      }
      const post=await body(req);
      if(!post.title||!post.caption||!post.platform)return json(res,400,{error:'Title, caption and platform are required'});
      post.created_by=admin.id; post.status=post.status||'draft';
      const r=await supabaseRest('POST','social_posts',post); if(!r.ok)return json(res,400,{error:await r.text()});
      return json(res,200,(await r.json())[0]);
    }
    const socialMatch=u.pathname.match(/^\/api\/admin\/social-posts\/([^/]+)$/);
    if(socialMatch&&(req.method==='PATCH'||req.method==='DELETE')){
      const admin=await adminUser(req); if(!admin)return json(res,401,{error:'Admin authentication required'});
      const id=decodeURIComponent(socialMatch[1]);
      if(req.method==='PATCH'){
        const patch=await body(req); patch.updated_at=new Date().toISOString();
        if(patch.status==='published')patch.published_at=new Date().toISOString();
        const r=await supabaseRest('PATCH','social_posts',patch,`?id=eq.${encodeURIComponent(id)}`);
        if(!r.ok)return json(res,400,{error:await r.text()}); return json(res,200,(await r.json())[0]||null);
      }
      const r=await supabaseRest('DELETE','social_posts',undefined,`?id=eq.${encodeURIComponent(id)}`);
      if(!r.ok)return json(res,400,{error:await r.text()}); return json(res,200,{ok:true});
    }

    if(u.pathname==='/api/admin/products/bulk'&&req.method==='POST'){
      const admin=await adminUser(req); if(!admin)return json(res,401,{error:'Admin authentication required'});
      const payload=await body(req,2*1024*1024); const items=Array.isArray(payload.items)?payload.items:[];
      if(!items.length)return json(res,400,{error:'No products supplied.'}); if(items.length>500)return json(res,400,{error:'CSV imports are limited to 500 rows per batch.'});
      const results=[];
      for(const raw of items){
        const product={...raw,published:false,slug:String(raw.slug||raw.name||'product').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,150)+'-'+crypto.randomBytes(3).toString('hex')};
        const validation=validateProduct(product); if(validation){results.push({ok:false,name:raw.name||'',error:validation});continue;}
        if(product.image_url&&!validUrl(product.image_url))product.image_url=null;
        const r=await supabaseRest('POST','products',product);
        if(!r.ok){results.push({ok:false,name:raw.name||'',error:(await r.text()).slice(0,500)});continue;}
        results.push({ok:true,name:product.name});
      }
      return json(res,200,{ok:results.every(x=>x.ok),results,imported:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length});
    }

    if(u.pathname==='/api/admin/products'&&req.method==='GET'){
      const admin=await adminUser(req); if(!admin)return json(res,401,{error:'Admin authentication required'});
      const r=await supabaseRest('GET','products',undefined,'?select=*&order=created_at.desc'); if(!r.ok)return json(res,500,{error:await r.text()}); return json(res,200,await r.json());
    }
    if(u.pathname==='/api/admin/products'&&req.method==='POST'){
      const admin=await adminUser(req); if(!admin)return json(res,401,{error:'Admin authentication required'});
      const product=await body(req,512*1024);
      const validation=validateProduct(product); if(validation)return json(res,400,{error:validation});
      product.name=String(product.name).trim().slice(0,180); product.slug=String(product.slug).trim().toLowerCase().slice(0,180);
      product.published=product.published===true;
      product.description=cleanText(product.description,10000); product.features=cleanText(product.features,10000); product.brand=cleanText(product.brand,180);
      if(Array.isArray(product.image_urls))product.image_urls=product.image_urls.filter(validUrl).slice(0,30);
      if(product.image_url&&!validUrl(product.image_url))product.image_url=null;
      const r=await supabaseRest('POST','products',product); if(!r.ok){const detail=await r.text(); return json(res,400,{error:'Supabase rejected the product.',detail});} return json(res,200,(await r.json())[0]);
    }
    const productMatch=u.pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
    if(productMatch&&(req.method==='PATCH'||req.method==='DELETE')){
      const admin=await adminUser(req); if(!admin)return json(res,401,{error:'Admin authentication required'});
      const id=decodeURIComponent(productMatch[1]);
      if(req.method==='PATCH'){
        const patch=await body(req,512*1024);
        const validation=validateProduct({...patch,name:patch.name||'placeholder',slug:patch.slug||'placeholder',kind:patch.kind||'shop'}); if(validation && (patch.name||patch.slug||patch.kind||patch.display_price||patch.destination_url||patch.image_url||patch.image_urls))return json(res,400,{error:validation});
        if(patch.name)patch.name=String(patch.name).trim().slice(0,180); if(patch.slug)patch.slug=String(patch.slug).trim().toLowerCase().slice(0,180); if(Array.isArray(patch.image_urls))patch.image_urls=patch.image_urls.filter(validUrl).slice(0,30);
        const r=await supabaseRest('PATCH','products',patch,`?id=eq.${encodeURIComponent(id)}`);
        if(!r.ok)return json(res,400,{error:await r.text()});
        const rows=await r.json(); return json(res,200,rows[0]||null);
      }
      const r=await supabaseRest('DELETE','products',undefined,`?id=eq.${encodeURIComponent(id)}`);
      if(!r.ok)return json(res,400,{error:await r.text()});
      return json(res,200,{ok:true});
    }

    let file=u.pathname==='/'?'/index.html':u.pathname; const safe=path.normalize(file).replace(/^([.][.][\\/])+/, ''); const full=path.join(root,safe);
    fs.readFile(full,(e,b)=>{if(e){res.writeHead(404);return res.end('Not found')};res.writeHead(200,{'content-type':mime[path.extname(full)]||'text/plain'});res.end(b)});
  }catch(e){json(res,500,{error:e.message||'Server error'});}
});
server.listen(port,HOST,()=>console.log(`Nuvora listening on http://${HOST}:${port}`));
