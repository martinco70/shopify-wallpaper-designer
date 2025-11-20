// Direct HTTP check of Admin API token to rule out SDK issues
// Usage: node scripts/check-admin-token-http.js rtp0h2-cv tokens/rtp0h2-cv-admin.json

const fs = require('fs');
const path = require('path');

async function main() {
  try {
    const shopArg = process.argv[2] || '';
    if (!shopArg) throw new Error('missing_shop');
    const shop = String(shopArg).replace(/^https?:\/\//, '').replace(/\.myshopify\.com.*/, '').replace(/\/$/, '');
    const tokenFileArg = process.argv[3] || `tokens/${shop}-admin.json`;
    const tokenPath = path.resolve(__dirname, '..', tokenFileArg);
    const access_token = JSON.parse(fs.readFileSync(tokenPath, 'utf8')).access_token;
    if (!access_token) throw new Error('missing_access_token');
    const url = `https://${shop}.myshopify.com/admin/api/2025-01/shop.json`;
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': access_token } });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    if (!res.ok) {
      console.error(JSON.stringify({ ok: false, status: res.status, statusText: res.statusText, body: json || text.slice(0, 300) }));
      process.exit(1);
    }
    console.log(JSON.stringify({ ok: true, status: res.status, shop: json?.shop?.myshopify_domain || null }));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    process.exit(1);
  }
}

main();
