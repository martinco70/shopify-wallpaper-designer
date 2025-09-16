// --- Initial Requires & App Setup (moved earlier by refactor) ---
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
// fetch: Node 18+ global; fallback dynamic require if older (ignored errors)
let fetchFn = global.fetch; try { if (!fetchFn) fetchFn = require('node-fetch'); } catch {}
const { execFile } = require('child_process');
// pdfkit may be optional
let PDFDocument = null; try { PDFDocument = require('pdfkit'); } catch { PDFDocument = null; }
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(require('cors')());

// Config Store (ausgelagert) ersetzt das frühere Inline-Konstrukt
const { cfg } = require('./services/configStore');
function fileFor(id) { try { const p = path.join(__dirname, 'configs', id + '.json'); return p; } catch { return path.join(__dirname, 'configs', id + '.json'); } }
// Signing helpers (existing environment variable PDF_TOKEN_SECRET)
const PDF_TOKEN_SECRET = process.env.PDF_TOKEN_SECRET || '';
function signPdfToken(id, exp) { if(!PDF_TOKEN_SECRET) return null; const h = crypto.createHmac('sha256', PDF_TOKEN_SECRET).update(id + ':' + exp).digest('hex'); return `${exp}.${h}`; }
function verifyPdfToken(id, token){ try { if(!PDF_TOKEN_SECRET) return { ok:false, reason:'disabled' }; const [expStr, sig] = String(token).split('.'); const exp = Number(expStr); if(!exp || exp < Date.now()) return { ok:false, reason:'expired' }; const h = crypto.createHmac('sha256', PDF_TOKEN_SECRET).update(id + ':' + exp).digest('hex'); if (crypto.timingSafeEqual(Buffer.from(h,'hex'), Buffer.from(sig,'hex'))) return { ok:true }; return { ok:false, reason:'mismatch' }; } catch(e){ return { ok:false, reason:'error' }; } }

// ImageMagick & Ghostscript command resolution
const magickCmd = process.platform === 'win32' ? 'magick' : 'magick';
const ghostscriptCmd = process.platform === 'win32' ? 'gswin64c' : 'gs';

// --- PATCH: Logging und Speicherung von Endung/MIME-Type beim Upload (rückbaubar) ---
function getFileExtension(filename) {
  return (filename && filename.match(/\.([a-z0-9]+)$/i) || [])[1] || '';
}
// --- PATCH: Hilfsfunktion zur sicheren Dateierkennung (rückbaubar) ---
function isVectorOrPdfFile({ url, mimetype, detectedMime, filename }) {
  const ext = (url && url.match(/\.([a-z0-9]+)$/i) || [])[1]
    || (filename && filename.match(/\.([a-z0-9]+)$/i) || [])[1]
    || '';
  const lowerExt = ext.toLowerCase();
  if (['pdf','svg','eps','ai'].includes(lowerExt)) return true;
  const mt = (mimetype || '').toLowerCase();
  const dmt = (detectedMime || '').toLowerCase();
  if (mt.includes('pdf') || mt.includes('svg') || mt.includes('postscript') || mt.includes('illustrator')) return true;
  if (dmt.includes('pdf') || dmt.includes('svg') || dmt.includes('postscript') || dmt.includes('illustrator')) return true;
  return false;
}

// PDF Proof Route (refactored to use services/pdfProof.js)
const { buildProofPdf } = require('./services/pdfProof');
app.get('/config/:id/pdf', async (req, res) => {
  try {
    const rawId = String(req.params.id || '').trim();
    let id = rawId;
    if (!rawId.includes('-') && rawId.length <= 12) {
      const via = cfg.idFromCode(rawId); if (via) id = via;
    }
    if (req.query.sig) {
      const ver = verifyPdfToken(id, String(req.query.sig));
      if (!ver.ok) return res.status(403).type('text/plain').send('Signierter Link ungültig oder abgelaufen');
    } else {
      const t = req.query.t;
      if (t) {
        const v = cfg.verifyToken(String(t));
        if (!v.ok || v.id !== id) return res.status(403).type('text/plain').send('Link abgelaufen oder ungültig');
      } else if (PDF_TOKEN_SECRET) {
        return res.status(403).type('text/plain').send('Signatur erforderlich');
      }
    }
    let data; try { data = cfg.readConfig(id); } catch { return res.status(404).type('text/plain').send('Konfiguration nicht gefunden'); }
    const code = cfg.shortCodeFrom(id);
    if (!PDFDocument) {
      const content = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 842 595]/Contents 4 0 R/Resources<<>> >>endobj\n4 0 obj<</Length 120>>stream\nBT /F1 18 Tf 72 540 Td (Konfiguration ${code}) Tj ET\nendstream endobj\nxref\n0 5\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \n0000000116 00000 n \n0000000200 00000 n \ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n300\n%%EOF`;
      res.setHeader('Content-Type', 'application/pdf');
      return res.send(Buffer.from(content, 'utf8'));
    }
    const { doc, fallbackUsed } = await buildProofPdf(data, { code });
    if (fallbackUsed || !doc) return res.status(500).type('text/plain').send('PDFKit nicht verfügbar');
    const chunks = []; let errored = false;
    doc.on('data', c => chunks.push(c));
    doc.on('error', e => { errored = true; console.error('[pdf] stream error', e?.message || e); });
    doc.on('end', () => {
      if (errored) return;
      const buf = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${code}.pdf"`);
      res.setHeader('Content-Length', String(buf.length));
      res.send(buf);
    });
    doc.end();
  } catch (e) {
    console.error('[pdf] route error', e?.message || e);
    if (!res.headersSent) res.status(500).type('text/plain').send('PDF konnte nicht erstellt werden');
  }
});

// Sample config helper route
app.get('/config-sample', (req, res) => {
  try {
    // Modes:
    // 1) Default: w,h are PRINT dims
    // 2) wall=1: w,h are WALL dims and print = wall - bleed (cm) on each dimension
    const asWall = String(req.query.wall || '').toLowerCase() === '1' || String(req.query.mode||'').toLowerCase()==='wall';
    const wIn = Number(req.query.w || 240);
    const hIn = Number(req.query.h || 190);
    const bleed = Number(req.query.bleed || 10); // cm
    const img = String(req.query.img || 'https://via.placeholder.com/1200x800.png?text=Sample');

  // If inputs are wall dims, print = wall + bleed; else inputs are print dims, wall = print - bleed
  let wallW = asWall ? wIn : Math.max(1, wIn - bleed);
  let wallH = asWall ? hIn : Math.max(1, hIn - bleed);
  let printW = asWall ? (wIn + bleed) : wIn;
  let printH = asWall ? (hIn + bleed) : hIn;
    // Area by print size
    const area = ((printW/100)*(printH/100)).toFixed(3);

    const rec = cfg.create({
      wall: { widthCm: Math.round(wallW), heightCm: Math.round(wallH) },
      print: { widthCm: Math.round(printW), heightCm: Math.round(printH) },
      image: { url: img },
      transform: { zoom: 1 },
      areaM2: area
    });
    return res.json({ id: rec.id, code: rec.code, pdf: `/config/${rec.id}/pdf` });
  } catch (e) {
    return res.status(500).json({ error: 'sample_failed' });
  }
});

// Create a config from frontend
app.post('/config', (req, res) => {
  try {
    const payload = req.body || {};
    const rec = cfg.create(payload);
    const id = rec.id;
    const code = cfg.shortCodeFrom(id);
    const detailUrl = `/config/${id}/pdf`;
    const signedUrl = detailUrl; // no auth token for now
    return res.json({ configId: id, code, detailUrl, signedUrl });
  } catch (e) {
    return res.status(500).json({ error: 'create_failed' });
  }
});

// Resolve by short code
app.get('/config/by-code/:code', (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    const id = cfg.idFromCode(code);
    if (!id) return res.status(404).json({ error: 'not_found' });
    const detailUrl = `/config/${id}/pdf`;
    const signedUrl = detailUrl;
    return res.json({ configId: id, code, detailUrl, signedUrl, pdfUrl: detailUrl });
  } catch (e) {
    return res.status(500).json({ error: 'lookup_failed' });
  }
});

// Erzeuge signierten PDF-Link (HMAC) – Ablauf standard 2h
app.get('/config/:id/signed-link', (req, res) => {
  try {
    const rawId = String(req.params.id || '').trim();
    let id = rawId;
    if (!rawId.includes('-') && rawId.length <= 12) {
      const via = cfg.idFromCode(rawId); if (via) id = via;
    }
    if (!fs.existsSync(fileFor(id))) return res.status(404).json({ error: 'not_found' });
    if (!PDF_TOKEN_SECRET) return res.status(400).json({ error: 'feature_disabled' });
    const hours = Number(req.query.h || 2) || 2;
    const exp = Date.now() + Math.min(24, Math.max(0.1, hours)) * 3600 * 1000;
    const token = signPdfToken(id, exp);
    const pdfPath = `/config/${id}/pdf?sig=${encodeURIComponent(token)}`;
    return res.json({ id, pdf: pdfPath, expires: exp });
  } catch (e) {
    return res.status(500).json({ error: 'signed_link_failed' });
  }
});


// Simple in-memory rate limiting (per IP, per route)
const rateBuckets = new Map();
function rateLimitSimple({ max = 60, windowMs = 60_000 }) {
  return function (req, res, next) {
    try {
      const ip = req.ip || req.connection?.remoteAddress || 'unknown';
      const key = `${req.method}:${req.baseUrl || ''}${req.path}:${ip}`;
      const now = Date.now();
      let bucket = rateBuckets.get(key);
      if (!bucket || now >= bucket.reset) {
        bucket = { count: 0, reset: now + windowMs };
      }
      bucket.count++;
      rateBuckets.set(key, bucket);
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
      res.setHeader('X-RateLimit-Reset', String(Math.floor(bucket.reset / 1000)));
      if (bucket.count > max) {
        return res.status(429).json({ error: 'Rate limit exceeded. Please try again shortly.' });
      }
      next();
    } catch (_) {
      next();
    }
  };
}

const Shopify = require('shopify-api-node');
function normalizeShopName(input) {
  if (!input) return 'aahoma';
  let s = String(input).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/\.myshopify\.com.*/, '');
  s = s.replace(/\/$/, '');
  return s;
}
// Legacy envs (fallback for private app/dev only)
const legacyShopName = normalizeShopName(process.env.SHOPIFY_SHOP || 'aahoma');
const legacyAccessToken = process.env.SHOPIFY_ACCESS_TOKEN;
const legacyApiKey = process.env.SHOPIFY_API_KEY;
const legacyPassword = process.env.SHOPIFY_PASSWORD;
const legacyClient = (legacyAccessToken || (legacyApiKey && legacyPassword))
  ? new Shopify(
      legacyAccessToken
        ? { shopName: legacyShopName, accessToken: legacyAccessToken }
        : { shopName: legacyShopName, apiKey: legacyApiKey, password: legacyPassword }
    )
  : null;

// OAuth config for public app
const OAUTH = {
  API_KEY: process.env.SHOPIFY_API_KEY || '',
  API_SECRET: process.env.SHOPIFY_API_SECRET || '',
  SCOPES: (process.env.SHOPIFY_SCOPES || 'read_products,write_products').split(',').map(s => s.trim()).filter(Boolean),
  APP_URL: process.env.APP_URL || 'https://app.example.com',
};

// Very simple token store (disk based)
const TOKENS_DIR = path.join(__dirname, 'tokens');
try { if (!fs.existsSync(TOKENS_DIR)) fs.mkdirSync(TOKENS_DIR, { recursive: true }); } catch {}
const tokenPathFor = (shop) => path.join(TOKENS_DIR, `${normalizeShopName(shop)}.json`);
const getStoredToken = (shop) => {
  try {
    const p = tokenPathFor(shop);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')).access_token;
  } catch {}
  return null;
};
const saveToken = (shop, token) => {
  try {
    fs.writeFileSync(tokenPathFor(shop), JSON.stringify({ access_token: token }, null, 2));
  } catch (e) {
    console.error('[auth] Failed to persist token', e?.message || e);
  }
};

const getShopFromReq = (req) => {
  const q = req.query.shop || req.headers['x-shopify-shop-domain'] || req.headers['x-shopify-shop'];
  const name = normalizeShopName(q || legacyShopName);
  return `${name}.myshopify.com`;
};

// Decode Shopify host param (base64url) like 'c2hvcC5teXNob3BpZnkuY29tL2FkbWlu'
function shopFromHostParam(hostParam) {
  try {
    if (!hostParam) return null;
    // base64url -> base64
    let b64 = String(hostParam).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    // Expect something like 'rtp0h2-cv.myshopify.com/admin'
    const domain = decoded.split('/')[0];
    if (domain && /\.myshopify\.com$/i.test(domain)) return domain.toLowerCase();
    return null;
  } catch (_) { return null; }
}

function clientFor(req) {
  const shopDomain = getShopFromReq(req); // like mystore.myshopify.com
  const shopName = normalizeShopName(shopDomain);
  const token = getStoredToken(shopName);
  if (token) return new Shopify({ shopName, accessToken: token });
  if (legacyClient) return legacyClient; // fallback
  throw new Error('missing_shop_token');
}

// Minimal HMAC validator
function validHmac(query) {
  const { hmac, ...rest } = query;
  const msg = Object.keys(rest)
    .sort()
    .map(k => `${k}=${Array.isArray(rest[k]) ? rest[k].join(',') : rest[k]}`)
    .join('&');
  const digest = crypto
    .createHmac('sha256', OAUTH.API_SECRET)
    .update(msg)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hmac, 'utf8'), Buffer.from(digest, 'utf8'));
}

// Simple state store (memory)
const stateStore = new Map();
const newState = () => crypto.randomBytes(16).toString('hex');

// Endpunkt: Alle Produkte und Varianten mit SKUs und Preisen auflisten
// Limit SKUs to 30 req/min/IP
app.get('/shopify/skus', rateLimitSimple({ max: 30, windowMs: 60_000 }), async (req, res) => {
  try {
    const shopify = clientFor(req);
    const wantPaged = String(req.query.paged || '').toLowerCase() === 'true' ||
      typeof req.query.limit !== 'undefined' || typeof req.query.since_id !== 'undefined';
    const limit = Math.max(1, Math.min(250, parseInt(req.query.limit, 10) || 250));
    let since_id = req.query.since_id ? Number(req.query.since_id) : undefined;

  const mapProducts = (products) => products.map(product => ({
      productId: product.id,
      title: product.title,
      variants: (product.variants || []).map(variant => ({
        variantId: variant.id,
    title: variant.title,
        sku: variant.sku,
        price: variant.price
      }))
    }));

    if (wantPaged) {
      const params = { limit };
      if (since_id) params.since_id = since_id;
      const products = await shopify.product.list(params);
      const items = mapProducts(products || []);
      const next_since_id = (products && products.length === limit)
        ? products[products.length - 1]?.id
        : undefined;
      const has_more = Boolean(next_since_id);
      res.setHeader('Cache-Control', 'private, max-age=30');
      return res.json({ items, next_since_id, has_more, count: items.length });
    }

    // Backward-compatible: return full list (all pages) when not paged
    const all = [];
    let pages = 0;
    while (true) {
      const params = { limit };
      if (since_id) params.since_id = since_id;
      const products = await shopify.product.list(params);
      if (!Array.isArray(products) || products.length === 0) break;
      all.push(...mapProducts(products));
      since_id = products[products.length - 1]?.id;
      pages++;
      if (!since_id || products.length < limit) break;
      if (pages > 200) break; // safety cap
    }
  res.setHeader('Cache-Control', 'private, max-age=120');
  res.json(all);
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Abrufen der SKUs', details: err.message });
  }
});

// Shopify Health-Check: prüft, ob API erreichbar und Credentials gültig sind
app.get('/shopify/health', async (req, res) => {
  try {
    const shopify = clientFor(req);
    const shop = await shopify.shop.get();
    return res.json({ ok: true, shop: { name: shop.name, domain: shop.myshopify_domain } });
  } catch (err) {
    const status = err.statusCode || err.status || 500;
    const details = err?.response?.body || err?.body || undefined;
    return res.status(500).json({ ok: false, error: err.message, status, details });
  }
});

// Preis-Endpunkt für Material-SKU
// Limit price lookups to 120 req/min/IP
app.get('/price/:sku', rateLimitSimple({ max: 120, windowMs: 60_000 }), async (req, res) => {
  const sku = String(req.params.sku || '').trim();
  try {
    // Shopify-Client einmalig initialisieren, damit Fallbacks ihn ebenfalls nutzen können
    const shopify = clientFor(req);

    // 1) REST: Direkter Variant-Lookup per SKU (schnellste Option)
    try {
      const variants = await shopify.productVariant.list({ sku, limit: 1 });
      if (Array.isArray(variants) && variants.length && variants[0].price != null) {
        return res.json({ price: Number(variants[0].price) });
      }
    } catch (e) {
      // Ignorieren und weiter mit Fallbacks (z.B. falls API 404/422 liefert)
    }

    // 2) Fallback: REST-Scan mit Pagination (alle Produkte durchsuchen)
    let price = null;
    try {
      const limit = 250;
      let since_id = undefined;
      let pages = 0;
      while (true) {
        const params = { limit };
        if (since_id) params.since_id = since_id;
        const products = await shopify.product.list(params);
        if (!Array.isArray(products) || products.length === 0) break;
        for (const product of products) {
          if (product.variants && product.variants.length) {
            const v = product.variants.find(v => String(v.sku || '').trim() === sku);
            if (v) { price = v.price; break; }
          }
        }
        if (price != null) break;
        since_id = products[products.length - 1]?.id;
        pages++;
        if (!since_id || products.length < limit) break;
        if (pages > 200) break; // safety cap
      }
    } catch (e) {
      // ignorieren; lokaler Fallback folgt
    }
    if (price != null) {
      return res.json({ price: Number(price) });
    }

    // 3) Lokaler Fallback: materials.json
    try {
      const materialsPath = path.join(__dirname, 'materials.json');
      const raw = fs.readFileSync(materialsPath, 'utf8');
      const mats = JSON.parse(raw);
      const match = Array.isArray(mats) ? mats.find(m => m.sku === sku) : null;
      if (match && match.price != null) {
        return res.json({ price: Number(match.price) });
      }
    } catch {}

    return res.status(404).json({ error: 'SKU nicht gefunden' });
  } catch (err) {
    // Letzter Fallback bei API-Fehlern
    try {
      const materialsPath = path.join(__dirname, 'materials.json');
      const raw = fs.readFileSync(materialsPath, 'utf8');
      const mats = JSON.parse(raw);
      const match = Array.isArray(mats) ? mats.find(m => m.sku === sku) : null;
      if (match && match.price != null) {
        return res.json({ price: Number(match.price) });
      }
    } catch {}
    return res.status(500).json({ error: 'Fehler beim Preisabruf', details: err.message });
  }
});

// OAuth: entry point to install/authorize the app for a shop
app.get('/auth', (req, res) => {
  try {
    const raw = req.query.shop;
    if (!raw) return res.status(400).send('Missing shop');
    const shop = `${normalizeShopName(raw)}.myshopify.com`;
    const state = newState();
    stateStore.set(state, Date.now() + 10 * 60_000); // valid for 10 minutes
    const redirectUri = `${OAUTH.APP_URL.replace(/\/$/, '')}/auth/callback`;
    const url = new URL(`https://${shop}/admin/oauth/authorize`);
    url.searchParams.set('client_id', OAUTH.API_KEY);
    url.searchParams.set('scope', OAUTH.SCOPES.join(','));
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    res.redirect(String(url));
  } catch (e) {
    res.status(500).send('Auth init failed');
  }
});

// OAuth callback: verify HMAC and exchange code for token
app.get('/auth/callback', async (req, res) => {
  try {
    const { shop, hmac, code, state } = req.query;
    if (!shop || !hmac || !code || !state) return res.status(400).send('Missing params');
    const exp = stateStore.get(state);
    stateStore.delete(state);
    if (!exp || exp < Date.now()) return res.status(400).send('Invalid state');
    if (!validHmac(req.query)) return res.status(400).send('Invalid HMAC');
  const tokenRes = await fetchFn(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: OAUTH.API_KEY, client_secret: OAUTH.API_SECRET, code })
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      return res.status(500).send(`Token exchange failed: ${tokenRes.status} ${text}`);
    }
    const data = await tokenRes.json();
    const token = data.access_token;
    const shopName = normalizeShopName(shop);
    saveToken(shopName, token);
    // Minimal app page after install
    res.redirect(`/app?shop=${shopName}.myshopify.com`);
  } catch (e) {
    res.status(500).send('Auth callback error');
  }
});

// Minimal embedded app page
app.get('/app', (req, res) => {
  const host = req.query.host || '';
  const fromHost = shopFromHostParam(host);
  const shop = req.query.shop || fromHost || '';
  const shopName = normalizeShopName(shop || legacyShopName);
  const token = getStoredToken(shopName);
  const hasLegacy = Boolean(legacyClient);
  // Allow disabling App Bridge redirect for debugging/custom-app flows
  const noRedirect = String(req.query.noRedirect || req.query.no_redirect || '').toLowerCase();
  const disableAB = noRedirect === '1' || noRedirect === 'true' || noRedirect === 'yes';
  res.setHeader('Content-Security-Policy', "frame-ancestors https://*.myshopify.com https://admin.shopify.com");
  res.type('html').send(`<!doctype html>
  <html><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Wallpaper Designer</title>
    <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
    <script>
      (function(){
        try {
    var host = ${JSON.stringify(String(req.query.host || ''))};
          var apiKey = ${JSON.stringify(OAUTH.API_KEY)};
          if (host && apiKey && window.appBridge == null && window['app-bridge'] == null && window.createApp == null) {
            // app-bridge v3 exposes createApp globally
          }
        } catch (e) {}
      })();
    </script>
  </head>
  <body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px;">
  <h1>Wallpaper Designer</h1>
  <p>Shop: <strong>${shopName}.myshopify.com</strong></p>
  ${(token || hasLegacy) ? '<p>App ist installiert. Sie können die Funktionen nutzen.</p>' : `<p>App ist noch nicht installiert. <a href="/auth?shop=${shopName}.myshopify.com">Jetzt installieren</a></p>`}
  <p><a href="/shopify/health?shop=${shopName}.myshopify.com" target="_blank">Shopify Health prüfen</a></p>
  <p style="margin-top:16px; color:#666;">App Bridge: ${disableAB ? 'deaktiviert' : 'aktiv'}${host ? '' : ' (kein host übergeben)'} — fügen Sie <code>?noRedirect=1</code> hinzu, um die Weiterleitung zu deaktivieren.</p>
  <script>
    (function(){
      try {
        var AppBridge = window['app-bridge'];
  var host = ${JSON.stringify(String(req.query.host || ''))};
        var apiKey = ${JSON.stringify(OAUTH.API_KEY)};
  var disable = ${disableAB ? 'true' : 'false'};
  if (!disable && AppBridge && apiKey && host) {
          var app = AppBridge.createApp({ apiKey: apiKey, host: host, forceRedirect: true });
          // Optionally, set a title bar here
  } else if (!disable && window.createApp && apiKey && host) {
          // some versions expose createApp at window
          window.createApp({ apiKey: apiKey, host: host, forceRedirect: true });
        }
      } catch (e) { /* noop */ }
    })();
  </script>
  </body></html>`);
});
// Hinweis: Materialien-Verwaltung wurde entfernt. Ehemalige Routen deaktiviert.
app.all(['/admin/materials', '/materials', '/materials/*'], (req, res) => {
  res.status(410).json({ error: 'Die Materialverwaltung ist nicht mehr verfügbar.' });
});
// Statische Bereitstellung der Uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// Serve the Designer frontend
try {
  const designerDist = path.join(__dirname, '..', 'frontend', 'dist');
  if (fs.existsSync(path.join(designerDist, 'index.html'))) {
    app.use('/designer', express.static(designerDist, { maxAge: 0, etag: false, setHeaders: (res)=>{ res.setHeader('Cache-Control','no-store'); } }));
  } else {
    const designerPublic = path.join(__dirname, 'public', 'designer');
    app.use('/designer', express.static(designerPublic, { maxAge: 0, etag: false, setHeaders: (res)=>{ res.setHeader('Cache-Control','no-store'); } }));
    // Also support sibling public/designer (when deploy puts assets outside backend/)
    try {
      const altDesigner = path.join(__dirname, '..', 'public', 'designer');
      if (fs.existsSync(altDesigner)) {
        app.use('/designer', express.static(altDesigner, { maxAge: 0, etag: false, setHeaders: (res)=>{ res.setHeader('Cache-Control','no-store'); } }));
      }
    } catch(_) {}
  }
} catch (_) {
  const designerPublic = path.join(__dirname, 'public', 'designer');
  app.use('/designer', express.static(designerPublic, { maxAge: 0, etag: false, setHeaders: (res)=>{ res.setHeader('Cache-Control','no-store'); } }));
}
// Serve public assets (widget.js) at root for storefront usage
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));
// Also support sibling public/ for scenarios where assets were deployed to projectRoot/public
try {
  const altPublic = path.join(__dirname, '..', 'public');
  if (fs.existsSync(altPublic)) {
    app.use(express.static(altPublic, { maxAge: '1d' }));
  }
} catch(_) {}
// Serve uploaded previews so image URLs like /uploads/previews/... work
try {
  const uploadsDir = path.join(__dirname, 'uploads');
  if (fs.existsSync(uploadsDir)) {
    app.use('/uploads', express.static(uploadsDir, { maxAge: '5m' }));
  }
} catch(_) {}

// Backward-compatible alias: serve versioned launcher URLs from the current launcher
// Example: /wpd-launcher-20250902-10.js -> /public/wpd-launcher.js
app.get(/^\/wpd-launcher-\d{8}-\d{2}\.js$/, (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=3600');
    return res.sendFile(path.join(__dirname, 'public', 'wpd-launcher.js'));
  } catch (e) {
    return res.status(404).end();
  }
});
const port = process.env.PORT ? Number(process.env.PORT) : 3001;

// Speicherort für hochgeladene Dateien
// Ensure upload directories exist at startup to avoid ENOENT on first write
try {
  const uploadsDir = path.join(__dirname, 'uploads');
  const previewsDir = path.join(uploadsDir, 'previews');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  if (!fs.existsSync(previewsDir)) fs.mkdirSync(previewsDir, { recursive: true });
} catch (e) {
  console.warn('[init] Could not prepare upload directories:', e?.message || e);
}

const allowedMime = new Set([
  'image/jpeg',       // JPG
  'image/tiff',       // TIFF
  'application/pdf',  // PDF
  'image/svg+xml',    // SVG
  'application/postscript', // EPS (common)
  'application/eps',        // EPS (variant)
  'application/x-eps'       // EPS (variant)
]);
const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, path.join(__dirname, 'uploads'));
    },
    filename: function (req, file, cb) {
      cb(null, Date.now() + '-' + file.originalname);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 * 1024 }, // 50 GB
  fileFilter: function (req, file, cb) {
    if (allowedMime.has(file.mimetype)) return cb(null, true);
    return cb(null, false);
  }
});

// Entfernt: doppelte CORS-Middleware (express.json() bereits weiter oben aktiviert)

app.get('/', (req, res) => {
  res.send('Backend läuft!');
});

// Health: verify ImageMagick is callable
app.get('/imagemagick/health', async (req, res) => {
  try {
    const result = await new Promise((resolve, reject) => {
      const child = execFile(magickCmd, ['-version'], { windowsHide: true }, (err, stdout, stderr) => {
        if (err) return reject({ message: err.message, code: err.code, stderr });
        resolve({ stdout, stderr });
      });
      const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} reject({ message: 'timeout' }); }, 5000);
      child.on('exit', () => clearTimeout(t));
    });
    return res.json({ ok: true, cmd: magickCmd, version: result.stdout.split('\n')[0] || 'unknown' });
  } catch (e) {
    const details = typeof e === 'object' ? e : { message: String(e) };
    const code = details.code === 'ENOENT' ? 404 : 500;
    return res.status(code).json({ ok: false, cmd: magickCmd, error: details.message, stderr: details.stderr });
  }
});

// Health: verify Ghostscript (needed for PDF/EPS) — optional
app.get('/ghostscript/health', async (req, res) => {
  const gsCmd = 'gswin64c'; // common on 64-bit Windows; fallback will be ENOENT if missing
  try {
    const result = await new Promise((resolve, reject) => {
      const child = execFile(gsCmd, ['-version'], { windowsHide: true }, (err, stdout, stderr) => {
        if (err) return reject({ message: err.message, code: err.code, stderr });
        resolve({ stdout, stderr });
      });
      const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} reject({ message: 'timeout' }); }, 5000);
      child.on('exit', () => clearTimeout(t));
    });
    return res.json({ ok: true, cmd: gsCmd, version: (result.stdout || result.stderr || '').trim() });
  } catch (e) {
    const details = typeof e === 'object' ? e : { message: String(e) };
    const code = details.code === 'ENOENT' ? 404 : 500;
    return res.status(code).json({ ok: false, cmd: gsCmd, error: details.message, stderr: details.stderr });
  }
});

// Diagnostics: verify ImageMagick and Ghostscript availability from backend
app.get('/health/imagemagick', async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      const child = execFile(magickCmd, ['-version'], { windowsHide: true }, (err, stdout, stderr) => {
        if (err) return reject(Object.assign(err, { stdout, stderr }));
        resolve({ stdout, stderr });
      });
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} reject(new Error('timeout')); }, 5000);
    });
    return res.json({ ok: true, path: magickCmd });
  } catch (e) {
    if (e && e.code === 'ENOENT') return res.status(500).json({ ok: false, error: 'imagemagick_missing' });
    if (String(e.message || '').includes('timeout')) return res.status(504).json({ ok: false, error: 'timeout' });
    return res.status(500).json({ ok: false, error: 'unknown', details: String(e && e.message || '') });
  }
});

app.get('/health/ghostscript', async (req, res) => {
  const cmd = process.platform === 'win32' ? ghostscriptCmd : 'gs';
  try {
    await new Promise((resolve, reject) => {
      const child = execFile(cmd, ['-version'], { windowsHide: true }, (err, stdout, stderr) => {
        if (err) return reject(Object.assign(err, { stdout, stderr }));
        resolve({ stdout, stderr });
      });
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} reject(new Error('timeout')); }, 5000);
    });
    return res.json({ ok: true, command: cmd });
  } catch (e) {
    if (e && e.code === 'ENOENT') return res.status(500).json({ ok: false, error: 'ghostscript_missing' });
    if (String(e.message || '').includes('timeout')) return res.status(504).json({ ok: false, error: 'timeout' });
    return res.status(500).json({ ok: false, error: 'unknown', details: String(e && e.message || '') });
  }
});

// Bild-Upload-Endpunkt
app.post('/upload', upload.single('wallpaper'), async (req, res) => {
  // PATCH: Logging und Speicherung von Endung/MIME-Type
  const uploadExt = getFileExtension(req.file.originalname);
  const uploadMime = req.file.mimetype;
  const uploadPath = req.file.path;
  // Versuche, echten Typ mit file-type zu erkennen (falls installiert)
  let detectedExt = null, detectedMime = null;
  try {
    const fileType = require('file-type');
    const ft = await fileType.fromFile(uploadPath);
    if (ft) {
      detectedExt = ft.ext;
      detectedMime = ft.mime;
    }
  } catch (e) {
    // file-type nicht installiert oder Fehler ignorieren
  }
  console.log('[upload-filetype]', {
    originalname: req.file.originalname,
    mimetype: uploadMime,
    ext: uploadExt,
    detectedExt,
    detectedMime,
    path: uploadPath
  });
  if (!req.file) {
    return res.status(400).json({ error: 'Ungültiger oder fehlender Upload. Erlaubte Dateitypen: JPG, TIFF, EPS, SVG, PDF.' });
  }
  console.log(`Datei hochgeladen: ${req.file.filename}`);

  // Preview erzeugen
  const uploadsDir = path.join(__dirname, 'uploads');
  const previewsDir = path.join(uploadsDir, 'previews');
  try { if (!fs.existsSync(previewsDir)) fs.mkdirSync(previewsDir, { recursive: true }); } catch {}

  const inputPath = path.join(uploadsDir, req.file.filename);
  const baseName = req.file.filename.replace(/\.[^.]+$/, '');
  const previewName = `${baseName}-preview.jpg`;
  const previewPath = path.join(previewsDir, previewName);
  let preview = null;
  const displayableInBrowser = (mt) => mt === 'image/jpeg' || mt === 'image/svg+xml';
  let originalWidthPx = null;
  let originalHeightPx = null;
  const isRasterOrSvg = ['image/jpeg', 'image/tiff', 'image/svg+xml'].includes(req.file.mimetype);
  const generationTimeoutMs = 60_000; // 60s

  // Try to generate preview for common image/vector types using sharp (raster) or ImageMagick for PDF/EPS
  if (isRasterOrSvg) {
    // Try read original metadata (dimensions)
    try {
      const meta = await sharp(inputPath).metadata();
      originalWidthPx = meta.width || null;
      originalHeightPx = meta.height || null;
    } catch (_) {}
    try {
      await Promise.race([
        sharp(inputPath)
          .rotate()
          .jpeg({ quality: 85 })
          .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
          .toFile(previewPath),
        new Promise((_, reject) => setTimeout(() => reject(new Error('preview_timeout')), generationTimeoutMs))
      ]);
      preview = `uploads/previews/${previewName}`;
    } catch (e) {
      // For JPEG/SVG we can fall back to original; for TIFF we need preview to render
      if (req.file.mimetype === 'image/tiff') {
        if (e && String(e.message).includes('preview_timeout')) {
          return res.status(504).json({ error: 'timeout' });
        }
        // Other sharp failures
        return res.status(500).json({ error: 'preview_failed' });
      }
      // For JPEG/SVG: leave preview null, use original on client
    }
  } else if ([
    'application/pdf',
    'application/postscript',
    'application/eps',
    'application/x-eps'
  ].includes(req.file.mimetype)) {
    // Attempt with ImageMagick (v7) CLI: first page -> JPEG
    try {
      await new Promise((resolve, reject) => {
        const args = (process.platform === 'win32')
          ? [
              'convert',
              '-density','150',
              `${inputPath}[0]`,
              '-quality','85',
              '-resize','2000x2000',
              previewPath
            ]
          : [
              '-density','150',
              `${inputPath}[0]`,
              '-quality','85',
              '-resize','2000x2000',
              previewPath
            ];
        // Ensure Ghostscript bin directory is available in PATH for delegate
        let childEnv = { ...process.env };
        try {
          if (process.platform === 'win32' && path.isAbsolute(ghostscriptCmd)) {
            const gsDir = path.dirname(ghostscriptCmd);
            const sep = ';';
            childEnv.PATH = `${gsDir}${sep}${childEnv.PATH || ''}`;
          }
          // Point to local policy override directory if present
          const policyDir = path.join(__dirname, 'im-policy');
          if (fs.existsSync(policyDir)) {
            const key = 'MAGICK_CONFIGURE_PATH';
            childEnv[key] = policyDir + (process.platform === 'win32' ? ';' : ':') + (childEnv[key] || '');
          }
        } catch {}
        const child = execFile(magickCmd, args, { windowsHide: true, env: childEnv }, (err, stdout, stderr) => {
          if (err) {
            try { err.stdout = stdout; } catch {}
            try { err.stderr = stderr; } catch {}
            return reject(err);
          }
          resolve();
        });
        // enforce timeout
        const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} reject(new Error('preview_timeout')); }, generationTimeoutMs);
        child.on('exit', () => clearTimeout(t));
      });
      if (fs.existsSync(previewPath)) {
        preview = `uploads/previews/${previewName}`;
      }
    } catch (e) {
      const msg = String(e && e.message || '');
      const stderr = String(e && e.stderr || '');
      if (msg.includes('preview_timeout')) {
        return res.status(504).json({ error: 'timeout' });
      }
      // ENOENT often means executable not found; re-check the resolved path to avoid misleading users
      if (e && e.code === 'ENOENT') {
        let exists = true;
        try { exists = fs.existsSync(magickCmd); } catch { exists = true; }
        if (!exists) {
          console.error('[preview] ImageMagick binary not found at path:', magickCmd);
          return res.status(500).json({ error: 'imagemagick_missing', cmd: magickCmd, exists: false });
        }
        // If the binary exists, continue with further checks below
      }
      // Ghostscript/delegate/policy issues
      if (/no decode delegate/i.test(stderr) || /ghostscript/i.test(stderr) || /gswin64c/i.test(stderr)) {
        return res.status(500).json({ error: 'ghostscript_missing' });
      }
      if (/not authorized/i.test(stderr) && /policy/i.test(stderr)) {
        return res.status(500).json({ error: 'imagemagick_policy' });
      }
      console.error('[preview] ImageMagick conversion failed', { code: e?.code, message: e?.message, stderr });
      return res.status(500).json({ error: 'preview_failed', details: (stderr || e?.message || '').slice(0, 500) });
    }
  }
  // PATCH: Endung/MIME-Type im image-Objekt speichern
  // PATCH: isVectorOrPdf robust bestimmen
  const fileMeta = {
    url: req.file && req.file.path ? req.file.path : '',
    mimetype: req.file && req.file.mimetype ? req.file.mimetype : '',
    detectedMime: req.file && req.file.detectedMime ? req.file.detectedMime : '',
    filename: req.file && req.file.originalname ? req.file.originalname : '',
  };
  const isVectorOrPdf = isVectorOrPdfFile({
    url: fileMeta.url,
    mimetype: fileMeta.mimetype,
    detectedMime: fileMeta.detectedMime,
    filename: fileMeta.filename
  });
  res.json({
    message: 'Datei erfolgreich hochgeladen!',
    filename: req.file.filename,
    preview,
    originalWidthPx,
    originalHeightPx,
    originalUrl: `uploads/${req.file.filename}`,
    isVectorOrPdf,
    image: {
      url: preview ? preview : `uploads/${req.file.filename}`,
      originalUrl: `uploads/${req.file.filename}`,
      ext: uploadExt,
      mimetype: uploadMime,
      detectedExt,
      detectedMime,
      preview: preview || null
    }
  });
});

// Resolve a variant by SKU for the current shop (used by storefront widget)
// Limit lookups to 120 req/min/IP
app.get('/variant/by-sku', rateLimitSimple({ max: 120, windowMs: 60_000 }), async (req, res) => {
  try {
    const sku = String(req.query.sku || '').trim();
    if (!sku) return res.status(400).json({ error: 'Missing sku' });
    const shopify = clientFor(req);
    // 1) Try direct variant lookup
    try {
      const variants = await shopify.productVariant.list({ sku, limit: 1 });
      if (Array.isArray(variants) && variants.length) {
        const v = variants[0];
        return res.json({
          variantId: v.id,
          productId: v.product_id,
          sku: v.sku,
          price: v.price != null ? Number(v.price) : null,
          variantTitle: v.title || '',
        });
      }
    } catch (_) {}

    // 2) Fallback: scan products
    let since_id = undefined;
    const limit = 250;
    let pages = 0;
    while (true) {
      const params = { limit };
      if (since_id) params.since_id = since_id;
      const products = await shopify.product.list(params);
      if (!Array.isArray(products) || products.length === 0) break;
      for (const product of products) {
        const v = (product.variants || []).find(v => String(v.sku || '').trim() === sku);
        if (v) {
          return res.json({
            variantId: v.id,
            productId: product.id,
            sku: v.sku,
            price: v.price != null ? Number(v.price) : null,
            productTitle: product.title || '',
            variantTitle: v.title || ''
          });
        }
      }
      since_id = products[products.length - 1]?.id;
      pages++;
      if (!since_id || products.length < limit) break;
      if (pages > 200) break; // safety cap
    }

    return res.status(404).json({ error: 'variant_not_found' });
  } catch (err) {
    return res.status(500).json({ error: 'lookup_failed', details: err.message });
  }
});

// Endpunkt: Liste aller hochgeladenen Dateien
app.get('/files', (req, res) => {
  fs.readdir(path.join(__dirname, 'uploads'), (err, files) => {
    if (err) {
      return res.status(500).send('Fehler beim Lesen des Upload-Ordners.');
    }
    res.send({ files });
  });
});

// Extra diagnostics: list ImageMagick formats (filter for PDF/PS/EPS)
app.get('/health/imagemagick/formats', async (req, res) => {
  try {
    const out = await new Promise((resolve, reject) => {
      const child = execFile(magickCmd, ['-list', 'format'], { windowsHide: true }, (err, stdout, stderr) => {
        if (err) return reject({ message: err.message, stderr });
        resolve(stdout);
      });
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} reject({ message: 'timeout' }); }, 5000);
// Entfernt: SyntaxError durch verwaiste JSON-Response
    });
    const lines = (out || '').split(/\r?\n/).filter(l => /(PDF|PS|EPS)/i.test(l));
    res.json({ ok: true, formats: lines });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Extra diagnostics: list ImageMagick policy rules
app.get('/health/imagemagick/policy', async (req, res) => {
  try {
    const out = await new Promise((resolve, reject) => {
      const child = execFile(magickCmd, ['-list', 'policy'], { windowsHide: true }, (err, stdout, stderr) => {
        if (err) return reject({ message: err.message, stderr });
        resolve(stdout || stderr || '');
      });
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} reject({ message: 'timeout' }); }, 5000);
    });
    res.type('text/plain').send(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Lightweight health endpoint for reverse proxy checks
app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

// --- Server Start (nur wenn direkt gestartet) ---
// Für Tests (supertest) exportieren wir die App, ohne sofort zu lauschen.
if (require.main === module) {
  const bindHost = process.env.BIND_HOST || '0.0.0.0';
  const server = app.listen(port, bindHost, () => {
    console.log(`Backend läuft auf http://${bindHost === '0.0.0.0' ? 'localhost' : bindHost}:${port}`);
    console.log(`ImageMagick command: ${magickCmd}`);
    console.log(`Ghostscript command: ${process.platform === 'win32' ? 'gswin64c' : 'gs'}`);
    try {
      const httpMod = require('http');
      httpMod.get(`http://127.0.0.1:${port}/healthz`, (r)=>{ console.log('[selfcheck] /healthz status', r.statusCode); }).on('error', (e)=>{
        console.warn('[selfcheck] failed', e.message);
      });
    } catch (e) { console.warn('[selfcheck] error', e.message); }
  });
  server.on('close', () => console.log('[server] close event (server no longer accepting connections)'));
  server.on('error', (err) => console.error('[server] error event', err && err.message || err));
}

module.exports = app;
// Periodic keepalive nur aktiv, wenn Skript direkt läuft
if (require.main === module) {
  setInterval(() => {
    try {
      const uptime = process.uptime().toFixed(1);
      const mem = process.memoryUsage();
      console.log(`[keepalive] uptime=${uptime}s rss=${Math.round(mem.rss/1024/1024)}MB heapUsed=${Math.round(mem.heapUsed/1024/1024)}MB`);
    } catch (_) {}
  }, Number(process.env.KEEPALIVE_INTERVAL_MS || 60000));
}