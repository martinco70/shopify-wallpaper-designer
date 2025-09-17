#!/usr/bin/env node
/**
 * Helper script to (re)create a Shopify access token file after a token loss.
 *
 * Usage examples:
 *   node scripts/set-shopify-token.js --shop aahoma --token shpua_XXXX
 *   SHOPIFY_SHOP=aahoma SHOPIFY_ACCESS_TOKEN=shpua_XXXX node scripts/set-shopify-token.js
 *   (with .env containing SHOPIFY_SHOP / SHOPIFY_ACCESS_TOKEN) -> node scripts/set-shopify-token.js
 *
 * It writes backend/tokens/<shop>.json with: { "access_token": "..." }
 * and prints a health check hint.
 */

const fs = require('fs');
const path = require('path');
try { require('dotenv').config(); } catch(_) {}

function parseArgs(argv){
  const out = {}; const a = argv.slice(2);
  for (let i=0;i<a.length;i++) {
    const cur = a[i];
    if (cur === '--shop' && a[i+1]) { out.shop = a[++i]; continue; }
    if (cur === '--token' && a[i+1]) { out.token = a[++i]; continue; }
  }
  return out;
}

function normalizeShopName(input) {
  if (!input) return '';
  let s = String(input).trim().toLowerCase();
  s = s.replace(/^https?:\/\//,'');
  s = s.replace(/\.myshopify\.com.*/,'');
  s = s.replace(/\/$/,'');
  return s;
}

const args = parseArgs(process.argv);
const shopRaw = args.shop || process.env.SHOPIFY_SHOP || '';
const token = args.token || process.env.SHOPIFY_ACCESS_TOKEN || '';
const shop = normalizeShopName(shopRaw);

if (!shop) {
  console.error('ERROR: Missing --shop (or SHOPIFY_SHOP env)');
  process.exit(1);
}
if (!token) {
  console.error('ERROR: Missing --token (or SHOPIFY_ACCESS_TOKEN env).');
  process.exit(2);
}

const tokensDir = path.join(__dirname, '..', 'tokens');
try { if (!fs.existsSync(tokensDir)) fs.mkdirSync(tokensDir, { recursive: true }); } catch(e) {}
const file = path.join(tokensDir, `${shop}.json`);

try {
  fs.writeFileSync(file, JSON.stringify({ access_token: token }, null, 2));
  console.log(`Token written to: ${file}`);
  console.log('\nNext steps:');
  console.log(`  curl -s http://127.0.0.1:3001/shopify/health?shop=${shop}.myshopify.com`);
  console.log('If you changed the token while the app is running under PM2, a restart may be required:');
  console.log('  pm2 restart wallpaper-backend');
} catch (e) {
  console.error('Failed to write token file:', e.message || e);
  process.exit(3);
}
