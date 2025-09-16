require('dotenv').config();
const Shopify = require('shopify-api-node');

async function main() {
  const normalizeShopName = (input) => {
    if (!input) return 'aahoma';
    let s = String(input).trim().toLowerCase();
    s = s.replace(/^https?:\/\//, '');
    s = s.replace(/\.myshopify\.com.*/, '');
    s = s.replace(/\/$/, '');
    return s;
  };
  const shopName = normalizeShopName(process.env.SHOPIFY_SHOP || 'aahoma');
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  const apiKey = process.env.SHOPIFY_API_KEY || 'c696c79546485248af4b6c088cf62dc5';
  const password = process.env.SHOPIFY_PASSWORD || '575337c2de182680fe2179ea80480dd5';
  const shopify = new Shopify(
    accessToken
      ? { shopName, accessToken }
      : { shopName, apiKey, password }
  );
  try {
    const shop = await shopify.shop.get();
    console.log(JSON.stringify({ ok: true, shop: { name: shop.name, domain: shop.myshopify_domain } }));
    process.exit(0);
  } catch (err) {
    const status = err.statusCode || err.status || 0;
    const details = err?.response?.body || err?.body || undefined;
    console.error(JSON.stringify({ ok: false, error: err.message, status, details }));
    process.exit(1);
  }
}

main();
