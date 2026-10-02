
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
        return serveAsset(env,new Request(new URL('/admin.html',request.url), {method:'GET',headers:request.headers}));
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
        const cfg=configured(env); const checks={environment:cfg.supabase,auth:false,admin:false,products:false,settings:false,social:false,analytics:false,workersAI:cfg.workersAI,shopifyStorefront:cfg.shopifyStorefront,shopifyEnvironment:cfg.shopifyAdmin,shopifyAuth:false,shopifyProducts:false};
        let shopifyError='';
        const shopifyMissing=[]; const aiMissing=[]; if(!env.AI)aiMissing.push('Workers AI binding');
        if(!(env.SHOPIFY_SHOP||env.SHOPIFY_STORE_DOMAIN))shopifyMissing.push('SHOPIFY_SHOP');
        if(!env.SHOPIFY_CLIENT_ID)shopifyMissing.push('SHOPIFY_CLIENT_ID');
        if(!env.SHOPIFY_CLIENT_SECRET)shopifyMissing.push('SHOPIFY_CLIENT_SECRET');
        const u=await supabaseUser(request,env); checks.auth=!!u;
        if(u&&env.SUPABASE_SERVICE_ROLE_KEY){
          const pr=await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(u.id)}&select=*`,{headers:sbHeaders(env,true)});
          if(pr.ok){const rows=await pr.json();const p=rows[0];checks.admin=!!p&&(p.is_admin===true||p.role==='admin');}
          for(const t of ['products','store_settings','social_posts','analytics_events']){
            const rr=await supabaseRest(env,'GET',t,undefined,'?select=*&limit=1');
            checks[t==='store_settings'?'settings':t==='social_posts'?'social':t==='analytics_events'?'analytics':'products']=rr.ok;
          }
          if(checks.admin&&checks.shopifyEnvironment){
            try{
              const data=await shopifyGraphql(env,'{ products(first: 1) { edges { node { id title } } } }',{},true);
              checks.shopifyAuth=true;
              checks.shopifyProducts=!!data?.products;
            }catch(e){shopifyError=String(e?.message||'Shopify authentication failed').slice(0,500);}
          }
        }
        const ok=checks.environment&&checks.auth&&checks.admin&&checks.products&&checks.settings&&checks.social&&checks.analytics&&checks.shopifyEnvironment&&checks.shopifyAuth&&checks.shopifyProducts&&checks.workersAI;
        return json({ok,checks,shopifyError,shopifyMissing,aiMissing});
      }

/* Amazon link/import hardening */
function validUrl(value){try{const u=new URL(String(value||'').trim());return u.protocol==='http:'||u.protocol==='https:';}catch{return false;}}
function amazonDecode(value){return String(value||'').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&nbsp;/gi,' ');}
function amazonHost(host){ const h=String(host||'').toLowerCase().replace(/^www\./,''); return h==='link.amazon'||h==='amzn.to'||h.includes('amazon.'); }
function extractUrls(value){ const m=String(value||'').match(/https?:\/\/[^\s<>]+/gi)||[]; return [...new Set(m.map(x=>x.replace(/[.,;]+$/,'').trim()).filter(Boolean))]; }
async function resolveAmazonUrl(sourceUrl){let current=String(sourceUrl||'').trim();for(let i=0;i<5;i++){const host=new URL(current).hostname.toLowerCase().replace(/^www\./,'');if(host!=='link.amazon'&&host!=='amzn.to')return current;const r=await fetch(current,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 Nuvora importer'}});if(r.url&&r.url!==current){current=r.url;continue;}break;}return current;}
function asinFromUrl(url){ const s=String(url||''); const m=s.match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/product\/|\/dp%2F)([A-Z0-9]{10})(?:[/?#]|$)/i); if(m)return m[1].toUpperCase(); const q=s.match(/[?&](?:asin|ASIN)=([A-Z0-9]{10})(?:&|$)/i); return q?q[1].toUpperCase():null; }
function htmlText(v){ return String(v||'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/\s+/g,' ').trim(); }
function metaValue(html,name){const n=String(name).replace(/[.*+?^$()|[\\]\\]/g,'\\$&');const r1=new RegExp('<meta[^>]+(?:name|property)=["\\']'+n+'["\\'][^>]+content=["\\']([^"\\']+)["\\']','i');const r2=new RegExp('<meta[^>]+content=["\\']([^"\\']+)["\\'][^>]+(?:name|property)=["\\']'+n+'["\\']','i');const m=html.match(r1)||html.match(r2);return m?htmlText(m[1]):'';}
function parseMoney(v){ const m=String(v||'').replace(/,/g,'').match(/([0-9]+(?:\.[0-9]{1,2})?)/); return m?Number(m[1]):null; }
function parseRating(v){ const m=String(v||'').match(/([0-5](?:\.[0-9])?)/); return m?Number(m[1]):null; }
function parseReviewCount(v){ const m=String(v||'').replace(/,/g,'').match(/([0-9]{1,9})/); return m?Number(m[1]):null; }
async function scrapeAmazonListing(sourceUrl,asin){const resolved=await resolveAmazonUrl(sourceUrl);const finalAsin=asinFromUrl(resolved)||asin;if(!finalAsin)return {error:'Could not find an ASIN after resolving the Amazon link.'};let html='';try{const r=await fetch(resolved,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (compatible; Nuvora/1.0)','accept-language':'en-US,en;q=0.9'}});if(!r.ok)throw new Error('Amazon returned HTTP '+r.status);html=await r.text();}catch(e){return {error:'Amazon product page could not be read: '+String(e?.message||e)}}const title=metaValue(html,'og:title')||metaValue(html,'twitter:title')||htmlText((html.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i)||[])[1]||'');const description=metaValue(html,'og:description')||metaValue(html,'description');const image=metaValue(html,'og:image')||metaValue(html,'twitter:image');const price=metaValue(html,'product:price:amount')||metaValue(html,'og:price:amount');const currency=metaValue(html,'product:price:currency')||metaValue(html,'og:price:currency')||'USD';const rating=parseRating(metaValue(html,'ratingValue'));const reviewCount=parseReviewCount(metaValue(html,'reviewCount')||metaValue(html,'ratingCount'));if(!title&&!image)return {error:'Amazon did not expose product data from this page.'};return {title:title||'Amazon product',description:description||null,brand:'',images:image?[image]:[],features:[],current_price:parseMoney(price),list_price:null,discount_percent:null,deal_text:null,rating,review_count:reviewCount,bought_past_month:null,shipping_text:null,tax_text:null,variations:[],currency,destination_url:resolved,resolved_url:resolved,asin:finalAsin};}
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
      if(url.pathname==='/api/admin/import/bulk'&&request.method==='POST'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const payload=await body(request,512*1024);
        const rawUrls=Array.isArray(payload?.urls)?payload.urls.join('\n'):String(payload?.urls||'');
        const urls=extractUrls(rawUrls);
        if(urls.length>30)return json({error:'Import up to 30 links at a time.'},400);
        const results=[]; let imported=0,skipped=0,failed=0;
        let categories=[];
        try{const cr=await supabaseRest(env,'GET','categories',undefined,'?select=id,slug,name');if(cr.ok)categories=await cr.json();}catch(e){}
        for(const sourceUrl of urls){
          const started=Date.now();
          try{
            if(!validUrl(sourceUrl))throw new Error('Invalid URL.');
            const parsed=new URL(sourceUrl),host=parsed.hostname.toLowerCase().replace(/^www\./,'');
            const isAmazon=amazonHost(host);
            const isTemu=host==='temu.com'||host.endsWith('.temu.com')||host==='temu.to';
            if(!isAmazon&&!isTemu)throw new Error('Only Amazon and Temu links are supported.');
            let listing=null,asin=null,productId=null;
            if(isAmazon){
              asin=asinFromUrl(sourceUrl);
              if(!asin&&(host==='link.amazon'||host==='amzn.to'))asin=asinFromUrl(await resolveAmazonUrl(sourceUrl));
              const rows=dup.ok?await dup.json():[];
              if(rows[0]){skipped++;results.push({ok:true,status:'skipped',retailer:'Amazon',source_url:sourceUrl,name:rows[0].name||'Existing product',reason:'Already imported',id:rows[0].id,duration_ms:Date.now()-started});continue;}
              listing=await scrapeAmazonListing(sourceUrl,asin);
              if(!listing||listing.error)throw new Error(listing?.error||'Amazon product data could not be read.');
              productId=asin;
            }else{
              listing=await scrapeTemuListing(sourceUrl);
              if(!listing||listing.error)throw new Error(listing?.error||'Temu product data could not be read.');
              productId=listing.id||null;
              if(productId){
                const dup=await supabaseRest(env,'GET','products',undefined,'?select=id,name,published,amazon_asin&retailer=eq.Temu&amazon_asin=eq.'+encodeURIComponent(productId)+'&limit=1');
                const rows=dup.ok?await dup.json():[];
                if(rows[0]){skipped++;results.push({ok:true,status:'skipped',retailer:'Temu',source_url:sourceUrl,name:rows[0].name||'Existing product',reason:'Already imported',id:rows[0].id,duration_ms:Date.now()-started});continue;}
              }
            }
            const retailer=isAmazon?'Amazon':'Temu';
            const title=cleanImportedTitle(listing.title||retailer+' product',listing.brand||'');
            const images=Array.isArray(listing.images)?[...new Set(listing.images.filter(Boolean))].slice(0,30):[];
            const features=Array.isArray(listing.features)?listing.features.filter(Boolean).slice(0,20):[];
            const description=String(listing.description||'').trim().slice(0,12000)||null;
            const categoryText=(title+' '+(description||'')+' '+(listing.brand||'')).toLowerCase();
            const category_id=categories.length?((categories.find(cat=>categoryText.includes(String(cat.name||'').toLowerCase()))||categories.find(cat=>categoryText.includes(String(cat.slug||'').toLowerCase().replace(/-/g,' ')))||null)?.id||null):null;
            const product={
              name:title,kind:'find',brand:listing.brand||null,description,features:features.join('\n')||null,
              image_url:images[0]||null,image_urls:images,display_price:listing.current_price??null,currency:listing.currency||'USD',
              destination_url:sourceUrl,retailer,category_id,amazon_asin:productId,amazon_source_url:sourceUrl,source_type:isAmazon?'amazon':'temu',
              amazon_list_price:listing.list_price??null,amazon_discount_percent:listing.discount_percent??null,
              amazon_deal_text:listing.deal_text||null,amazon_rating:listing.rating??null,amazon_review_count:listing.review_count??null,
              amazon_bought_past_month:listing.bought_past_month||listing.sold_count_text||null,amazon_shipping_text:listing.shipping_text||null,
              amazon_tax_text:listing.tax_text||null,amazon_variations:Array.isArray(listing.variations)?listing.variations:[],
              published:false
            };
            const slugBase=title.toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120);
            product.slug=(slugBase||'product')+'-'+Date.now().toString(36);
            const saved=await supabaseProductWrite(env,'POST',product);
            if(!saved.ok)throw new Error((await saved.text()).slice(0,500)||'Could not save product.');
            const row=(await saved.json())?.[0]||null;
            imported++;results.push({ok:true,status:'imported',retailer,source_url:sourceUrl,name:title,id:row?.id||null,captured:{images:images.length,description:!!description,features:features.length,price:listing.current_price!=null,rating:listing.rating!=null,reviews:listing.review_count!=null},duration_ms:Date.now()-started});
          }catch(e){
            failed++;results.push({ok:false,status:'failed',source_url:sourceUrl,error:String(e?.message||e).slice(0,500),duration_ms:Date.now()-started});
          }
        }
        return json({ok:true,imported,skipped,failed,total:urls.length,results});
      }

      if(url.pathname==='/api/amazon/prepare'&&request.method==='POST'){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const {url:amazonUrl}=await body(request,256*1024);
        if(!amazonUrl||!validUrl(amazonUrl))return json({error:'A valid Amazon product URL is required'},400);
        const parsed=new URL(amazonUrl);
        if(!/(^|\.)amazon\./i.test(parsed.hostname))return json({error:'Please paste an Amazon product URL.'},400);
        const asin=asinFromUrl(resolvedAmazonUrl); if(!asin)return json({error:'Could not find an ASIN in that Amazon URL'},400);
        const cleanPath=decodeURIComponent(parsed.pathname).replace(/^\/+|\/+$/g,'');
        const dpIndex=cleanPath.toLowerCase().indexOf('/dp/');
        const beforeDp=dpIndex>=0?cleanPath.slice(0,dpIndex):cleanPath;
        const titleHint=beforeDp.split('/').pop().replace(/[-_+]+/g,' ').replace(/\b(?:dp|gp|product)\b/gi,'').replace(/\s+/g,' ').trim().replace(/\b\w/g,c=>c.toUpperCase()).slice(0,180);
        let duplicate=null;
        try{const dup=await supabaseRest(env,'GET','products',undefined,'?select=id,name,published,amazon_asin&amazon_asin=eq.'+encodeURIComponent(asin)+'&limit=5');if(dup.ok){const rows=await dup.json();duplicate=rows[0]||null;}}catch(e){}
        let category_id=null;
        try{const cats=await supabaseRest(env,'GET','categories',undefined,'?select=id,slug,name');if(cats.ok){const categories=await cats.json();category_id=autoCategory(titleHint,'','',categories);}}catch(e){}
        let listing=null; try{listing=await scrapeAmazonListing(amazonUrl,asin);}catch(e){listing={error:String(e?.message||e).slice(0,300)};}
        return json({ok:true,asin,destination_url:amazonUrl,title_hint:listing?.title||titleHint||'Amazon product',retailer:'Amazon',kind:'find',category_id,duplicate,listing:listing||null});
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
    }
  }

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
        if(!temuUrl||!validUrl(temuUrl))return json({error:'A valid Temu product URL is required'},400);
        const parsed=new URL(temuUrl);
        const host=parsed.hostname.toLowerCase().replace(/^www\./,'');
        if(host!=='temu.com'&&!host.endsWith('.temu.com')&&host!=='temu.to')return json({error:'Please paste a Temu product URL.'},400);
        let listing=await scrapeTemuListing(temuUrl);
        if(listing?.error)return json(listing,502);
        listing.title=cleanImportedTitle(listing.title,listing.brand);
        const titleHint=(listing?.title||'Temu product').replace(/\s+/g,' ').trim().slice(0,180);
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
        const r=await supabaseRest(env,'POST',table,item); if(!r.ok)return json({error:await r.text()},400); return json((await r.json())[0]);
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
        const suspicious=products.filter(p=>{
          const amazon=String(p.retailer||'').toLowerCase()==='amazon'||!!p.amazon_asin||!!p.amazon_source_url;
          const text=String(p.description||'');
          return amazon&&(!p.display_price||Number(p.display_price)<=0||/keyboard shortcuts|prime video|all departments|deliver(?:ing|y) to|amazon fashion|sponsored/i.test(text)||!p.image_url);
        }).slice(0,5);
        const repairs=new Map();
        for(const p of suspicious){
          try{
            const source=p.amazon_source_url||p.destination_url;
            const asin=p.amazon_asin||asinFromUrl(source);
            if(source&&asin){
              const listing=await scrapeAmazonListing(source,asin);
              if(listing&&!listing.error){
                const patch={
                  name:listing.title||p.name,
                  brand:listing.brand||p.brand||null,
                  description:listing.description||p.description||null,
                  features:Array.isArray(listing.features)&&listing.features.length?listing.features.join('\n'):p.features||null,
                  image_url:Array.isArray(listing.images)&&listing.images[0]?listing.images[0]:p.image_url||null,
                  image_urls:Array.isArray(listing.images)?listing.images:[],
                  display_price:listing.current_price??p.display_price??null,
                  currency:p.currency||'USD',
                  amazon_list_price:listing.list_price??p.amazon_list_price??null,
                  amazon_discount_percent:listing.discount_percent??p.amazon_discount_percent??null,
                  amazon_deal_text:listing.deal_text||p.amazon_deal_text||null,
                  amazon_rating:listing.rating??p.amazon_rating??null,
                  amazon_review_count:listing.review_count??p.amazon_review_count??null,
                  amazon_bought_past_month:listing.bought_past_month||p.amazon_bought_past_month||null,
                  amazon_badges:listing.badges||p.amazon_badges||[],
                  amazon_shipping_text:listing.shipping_text||p.amazon_shipping_text||null,
                  amazon_tax_text:listing.tax_text||p.amazon_tax_text||null,
                  amazon_variations:listing.variations||p.amazon_variations||[],
                  amazon_last_synced:new Date().toISOString()
                };
                repairs.set(String(p.id),patch);
                await supabaseRest(env,'PATCH','products',patch,'?id=eq.'+encodeURIComponent(p.id));
              }
            }
          }catch(e){}
        }
        return json(products.map(p=>{
          const repaired=repairs.get(String(p.id));
          const source=repaired?{...p,...repaired}:p;
          const normalized=normalizeAmazonProduct(source);
          const safeText=v=>cleanMultilineText(v,12000)||null;
          return {
            ...source,
            name:normalized.name,
            brand:normalized.brand,
            description:normalized.description,
            features:normalized.features,
            image_url:normalized.image_url,
            image_urls:normalized.image_urls,
            display_price:normalized.display_price,
            currency:normalized.currency,
            amazon_rating:normalized.rating,
            amazon_review_count:normalized.review_count,
            amazon_deal_text:safeText(normalized.deal),
            deal_text:safeText(source.deal_text)||safeText(normalized.deal),
            temu_deal_text:safeText(source.temu_deal_text),
            amazon_shipping_text:safeText(source.amazon_shipping_text),
            amazon_tax_text:safeText(source.amazon_tax_text),
            category:source.category_id?categoryMap.get(String(source.category_id))||null:null,
            collection:source.collection_id?collectionMap.get(String(source.collection_id))||null:null
          };
        }));
      }
      async function supabaseProductWrite(env,method,product,query=''){
        const payload={...product};
        for(let attempt=0;attempt<12;attempt++){
          const r=await supabaseRest(env,method,'products',payload,query);
          if(r.ok)return r;
          const raw=await r.text();
          let bad=null;
          try{
            const j=JSON.parse(raw);
            const m=String(j.message||'').match(/Could not find the '([^']+)' column of 'products'/i);
            if(m)bad=m[1];
          }catch(e){}
          if(!bad || !(bad in payload)) return {ok:false,text:async()=>raw};
          delete payload[bad];
        }
        return {ok:false,text:async()=>JSON.stringify({message:'Too many unsupported product fields'})};
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
        if(Array.isArray(product.image_urls))product.image_urls=product.image_urls.filter(validUrl).slice(0,30);
        if(product.image_url&&!validUrl(product.image_url))product.image_url=null;
        const r=await supabaseProductWrite(env,'POST',product); if(!r.ok)return json({error:'Supabase rejected the product.',detail:(await r.text()).slice(0,2000)},400);
        return json((await r.json())[0]);
      }

      const productMatch=url.pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
      if(productMatch&&(request.method==='PATCH'||request.method==='DELETE')){
        const admin=await adminUser(request,env); if(!admin)return json({error:'Admin authentication required'},401);
        const id=decodeURIComponent(productMatch[1]);
        if(request.method==='PATCH'){
          const patch=await body(request);
          if(patch.name)patch.name=String(patch.name).trim().slice(0,180);
          if(patch.slug||patch.name)patch.slug=makeProductSlug(patch.slug||patch.name);
          const validation=validateProduct({...patch,name:patch.name||'placeholder',slug:patch.slug||'placeholder',kind:patch.kind||'shop'});
          if(validation && (patch.name||patch.slug||patch.kind||patch.display_price||patch.destination_url||patch.image_url||patch.image_urls))return json({error:validation},400);
          if(typeof patch.description==='string')patch.description=cleanMultilineText(patch.description,12000);
          if(typeof patch.features==='string')patch.features=cleanMultilineText(patch.features,12000);
          if(typeof patch.brand==='string')patch.brand=cleanText(patch.brand,180);
          if(typeof patch.deal_text==='string')patch.deal_text=cleanText(patch.deal_text,500);
          if(typeof patch.amazon_deal_text==='string')patch.amazon_deal_text=cleanText(patch.amazon_deal_text,500);
          if(typeof patch.temu_deal_text==='string')patch.temu_deal_text=cleanText(patch.temu_deal_text,500);
          if(Array.isArray(patch.image_urls))patch.image_urls=patch.image_urls.filter(validUrl).slice(0,30);
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
        if(!prompt)return json({error:'An image prompt is required.'},400);
        if(!env.AI)return json({error:'Nuvora AI is unavailable because the Cloudflare Workers AI binding is not active on this deployment. Deploy the current Nuvora Worker.'},503);
        const dimensions={'1024x1024':[1024,1024],'1536x1024':[1536,1024],'1024x1536':[1024,1536]};
        const [width,height]=dimensions[size]||dimensions['1024x1024'];
        try{
          let imageB64=null;
          if(source&&typeof source.arrayBuffer==='function'){
            const bytes=new Uint8Array(await source.arrayBuffer());
            if(bytes.byteLength>6*1024*1024)return json({error:'Reference image must be 6 MB or smaller for Nuvora AI.'},400);
            imageB64=bytesToBase64(bytes);
          }
          const input={
            prompt,
            negative_prompt:'fake logos, watermarks, misleading text, extra products, distorted product, duplicate product, low quality',
            width,height,num_steps:20,guidance:7.5
          };
          if(imageB64){input.image_b64=imageB64;input.strength=0.72;}
          const result=await env.AI.run('@cf/stabilityai/stable-diffusion-xl-base-1.0',input);
          const bytes=await aiResultBytes(result);
          return json({ok:true,provider:'cloudflare',image:'data:image/png;base64,'+bytesToBase64(bytes)});
        }catch(e){
          const code=String(e?.code||e?.error?.code||'');
          const status=Number(e?.status||e?.error?.status||0);
          const message=String(e?.message||e?.error?.message||'');
          if(code==='3036'||status===429&&/daily|allocation|neurons/i.test(message)){
            return json({error:'Nuvora AI has reached Cloudflare’s free daily AI allocation. The free allowance resets daily; no OpenAI credits are required for this feature.'},429);
          }
          if(code==='3040'||status===429){
            return json({error:'Cloudflare Workers AI is temporarily at capacity. Please try the image again later.'},429);
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

async function serveAsset(env,request){
  const response=await env.ASSETS.fetch(request);
  const headers=new Headers(response.headers);
  const type=headers.get('content-type')||'';
  if(type.includes('text/html'))headers.set('cache-control','no-store, must-revalidate');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
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
async function aiResultBytes(result){
  if(result instanceof ReadableStream)return new Uint8Array(await new Response(result).arrayBuffer());
  if(result instanceof Response)return new Uint8Array(await result.arrayBuffer());
  if(result instanceof ArrayBuffer)return new Uint8Array(result);
  if(ArrayBuffer.isView(result))return new Uint8Array(result.buffer,result.byteOffset,result.byteLength);
  if(result&&typeof result.image==='string'){const raw=result.image.includes(',')?result.image.split(',').pop():result.image;const bin=atob(raw);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return bytes;}
  throw new Error('Cloudflare AI returned no image bytes.');
}
function bytesToBase64(bytes){let out='';const step=0x8000;for(let i=0;i<bytes.length;i+=step)out+=String.fromCharCode(...bytes.subarray(i,i+step));return btoa(out);}
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
function validateProduct(product){
  if(!product||typeof product!=='object')return 'Product data is required.';
  const name=cleanText(product.name,180);
  const slug=cleanText(product.slug,180);
  const kind=cleanText(product.kind,40);
  if(!name||name==='placeholder')return 'Product name is required.';
  if(!slug||slug==='placeholder'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))return 'A valid product slug is required.';
  if(!['shop','find','learn'].includes(kind))return 'Product type must be shop, find, or learn.';
  if(product.display_price!==undefined&&product.display_price!==null&&(!Number.isFinite(Number(product.display_price))||Number(product.display_price)<0))return 'Product price is invalid.';
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
  const options={method,headers:{...sbHeaders(env,true),'Prefer':'return=representation'}};
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
