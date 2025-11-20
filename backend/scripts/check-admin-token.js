// Simple token check script for Admin API without relying on shell env vars
// Usage: node scripts/check-admin-token.js rtp0h2-cv tokens/rtp0h2-cv-admin.json

const fs = require('fs');
const path = require('path');
const Shopify = require('shopify-api-node');

async function main() {
  try {
    const shopArg = process.argv[2] || process.env.SHOPIFY_SHOP || '';
    if (!shopArg) {
      console.error(JSON.stringify({ ok: false, error: 'missing_shop' }));
      process.exit(1);
    }
    const shop = String(shopArg).replace(/^https?:\/\//, '').replace(/\.myshopify\.com.*/, '').replace(/\/$/, '');
    const tokenFileArg = process.argv[3] || `tokens/${shop}-admin.json`;
    const tokenPath = path.resolve(__dirname, '..', tokenFileArg);
    const raw = fs.readFileSync(tokenPath, 'utf8');
    const access_token = JSON.parse(raw).access_token;
    if (!access_token) {
      console.error(JSON.stringify({ ok: false, error: 'missing_access_token', file: tokenPath }));
      process.exit(1);
    }
    const client = new Shopify({ shopName: shop, accessToken: access_token });
    const shopInfo = await client.shop.get();
    console.log(JSON.stringify({ ok: true, shop: { name: shopInfo.name, domain: shopInfo.myshopify_domain } }));
    process.exit(0);
  } catch (err) {
    const status = err?.statusCode || err?.status || 0;
    const details = err?.response?.body || err?.body || undefined;
    console.error(JSON.stringify({ ok: false, error: err?.message || String(err), status, details }));
    process.exit(1);
  }
}

main();
