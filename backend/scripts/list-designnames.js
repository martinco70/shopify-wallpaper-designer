#!/usr/bin/env node
/**
 * List all distinct custom.designname metafield values (raw + normalized).
 * Usage: node scripts/list-designnames.js --shop rtp0h2-cv [--max 1000]
 */
const fs = require('fs');
const path = require('path');
const Shopify = require('shopify-api-node');

function argVal(name, def=null){
  const idx = process.argv.indexOf(`--${name}`);
  if(idx === -1) return def;
  const v = process.argv[idx+1];
  if(!v || v.startsWith('--')) return true; // flag style
  return v;
}

function normalizeShopName(input) {
  if (!input) return 'aahoma';
  let s = String(input).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/\.myshopify\.com.*/, '');
  s = s.replace(/\/$/, '');
  return s;
}

const TOKENS_DIR = path.join(__dirname, '..', 'tokens');
const tokenPathFor = (shop) => path.join(TOKENS_DIR, `${normalizeShopName(shop)}.json`);
const adminTokenPathFor = (shop) => path.join(TOKENS_DIR, `${normalizeShopName(shop)}-admin.json`);

function resolveTokenFile(shop){
  try {
    const shopName = normalizeShopName(shop);
    const adminPath = adminTokenPathFor(shopName);
    if(fs.existsSync(adminPath)) return adminPath;
    const exact = tokenPathFor(shopName);
    if(fs.existsSync(exact)) return exact;
    const files = fs.readdirSync(TOKENS_DIR).filter(f=>f.endsWith('.json'));
    const lower = `${shopName}`;
    const adminCand = files.find(f => (f.toLowerCase().startsWith(lower) || f.toLowerCase().includes(`${lower}-`)) && /-admin\.json$/i.test(f));
    if(adminCand) return path.join(TOKENS_DIR, adminCand);
    const cand = files.find(f => f.toLowerCase().startsWith(lower));
    if(cand) return path.join(TOKENS_DIR, cand);
  } catch(e){ /* ignore */ }
  return null;
}

function readTokenFileFlexible(p){
  try {
    if(!p || !fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p,'utf8').trim();
    if(!raw) return null;
    try {
      const j = JSON.parse(raw);
      if(j && typeof j === 'object') return j.access_token || j.token || j.accessToken || null;
    } catch(_) {
      if(/^[A-Za-z0-9_-]{20,}$/.test(raw)) return raw;
    }
  } catch(_) {}
  return null;
}

function normalizeFull(s){
  try {
    return String(s||'')
      .toLowerCase()
      .replace(/\s+/g,'')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'');
  } catch(_) {
    return String(s||'').toLowerCase().replace(/\s+/g,'');
  }
}

async function main(){
  const shop = argVal('shop') || process.env.SHOPIFY_SHOP || 'aahoma';
  const maxProducts = parseInt(argVal('max', '1500'),10); // safety limit
  const pageSize = 100; // GraphQL limit for products
  const tokenFile = resolveTokenFile(shop);
  const token = readTokenFileFlexible(tokenFile) || process.env.SHOPIFY_ACCESS_TOKEN;
  if(!token){
    console.error('ERROR: missing token for shop', shop, 'searched file:', tokenFile);
    process.exit(2);
  }
  const shopName = normalizeShopName(shop);
  const client = new Shopify({ shopName, accessToken: token });

  const distinctRaw = new Set();
  const distinctNorm = new Set();
  const samples = [];
  let cursor = null; let scanned = 0; let withField=0; let pages=0;

  while(scanned < maxProducts){
    pages++;
    const q = `query($first:Int!,$after:String){ products(first:$first, after:$after){ edges{ node{ id handle title metafield(namespace:"custom", key:"designname"){ value } } } pageInfo{ hasNextPage endCursor } } }`;
    let raw; try { raw = await client.graphql(q,{ first: Math.min(pageSize, maxProducts - scanned), after: cursor }); } catch(e){
      console.error('GraphQL request failed on page', pages, e.message || e);
      break;
    }
    const result = typeof raw==='string' ? JSON.parse(raw) : raw;
    if(result.errors){ console.error('GraphQL errors:', result.errors); break; }
    const prod = result?.data?.products || result?.products;
    const edges = Array.isArray(prod?.edges)? prod.edges:[];
    for(const ed of edges){
      const n = ed?.node; if(!n) continue;
      scanned++;
      const v = n.metafield && n.metafield.value ? String(n.metafield.value) : null;
      if(v!=null && v!==''){
        withField++;
        distinctRaw.add(v);
        const norm = normalizeFull(v);
        distinctNorm.add(norm);
        if(samples.length < 50){ samples.push({ raw: v, norm, handle: n.handle, title: n.title }); }
      }
      if(scanned >= maxProducts) break;
    }
    if(!prod?.pageInfo?.hasNextPage) break;
    cursor = prod?.pageInfo?.endCursor || null;
    if(!cursor) break;
    if(edges.length === 0) break; // safety
  }

  // Build normalized map collisions: norm -> count raw variants
  const collisionMap = new Map();
  for(const r of distinctRaw){
    const n = normalizeFull(r);
    const list = collisionMap.get(n) || [];
    list.push(r);
    collisionMap.set(n, list);
  }
  const collisions = [];
  for(const [norm,list] of collisionMap.entries()){
    if(list.length > 1){ collisions.push({ norm, variants: list }); }
  }

  const summary = {
    shop: `${shopName}.myshopify.com`,
    scannedProducts: scanned,
    withDesignnameMetafield: withField,
    distinctRawCount: distinctRaw.size,
    distinctNormalizedCount: distinctNorm.size,
    normalizationCollisionGroups: collisions.length,
    collisions: collisions.slice(0, 30), // limit output
    sampleValues: samples,
    tokenFile,
    pages,
    limitReached: scanned >= maxProducts
  };
  console.log(JSON.stringify(summary,null,2));
}

main().catch(e=>{ console.error('Fatal error', e); process.exit(1); });
