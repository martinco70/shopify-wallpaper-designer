// --- Initial Requires & App Setup (moved earlier by refactor) ---
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// Load environment variables from .env early (harmless if file missing)
try { require('dotenv').config(); } catch (_) {}
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
// Exports directory for downloadable CSVs and other generated files
try {
  const exportsDir = path.join(__dirname, 'exports');
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
  app.use('/exports', express.static(exportsDir, { maxAge: '1d' }));
  // Expose path for later use
  app.set('exportsDir', exportsDir);
} catch (e) {
  try { console.warn('[exports] setup failed', e?.message || e); } catch {}
}

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
const { getLastVariantExportUrl } = require('./services/imageImport');
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
    // Read stored config to enable client-side rehydration
    let record = null;
    try { record = cfg.readConfig(id); } catch { record = null; }
    const detailUrl = `/config/${id}/pdf`;
    const signedUrl = detailUrl;
    const payload = { configId: id, code, detailUrl, signedUrl, pdfUrl: detailUrl };
    if (record && typeof record === 'object') {
      // expose selected fields non-breaking (additive)
      const { wall, print, image, transform, price, calc, areaM2, product } = record;
      if (wall) payload.wall = wall;
      if (print) payload.print = print;
      if (image) payload.image = image;
      if (transform) payload.transform = transform;
      if (price) payload.price = price;
      if (calc) payload.calc = calc;
      if (areaM2 != null) payload.areaM2 = areaM2;
      if (product) payload.product = product;
    }
    return res.json(payload);
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
// NEU: Periodische Bereinigung abgelaufener Buckets
setInterval(() => {
  try {
    const now = Date.now();
    for (const [key, bucket] of rateBuckets) {
      if (!bucket || now >= bucket.reset) rateBuckets.delete(key);
    }
  } catch (_) {}
}, 60_000).unref?.();

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
const adminTokenPathFor = (shop) => path.join(TOKENS_DIR, `${normalizeShopName(shop)}-admin.json`);

// Resolve token file path with preference for <shop>-admin.json over <shop>.json
function resolveTokenFile(shop) {
  try {
    const shopName = normalizeShopName(shop);
    const adminPath = adminTokenPathFor(shopName);
    if (fs.existsSync(adminPath)) return adminPath;
    const exact = tokenPathFor(shopName);
    if (fs.existsSync(exact)) return exact;
    // Fallback: find any file that starts with shop name; prefer *-admin.json if present
    const files = fs.readdirSync(TOKENS_DIR).filter(f => f.endsWith('.json'));
    const lower = `${shopName}`;
    // Prefer files containing "-admin.json"
    const adminCand = files.find(f => (f.toLowerCase().startsWith(lower) || f.toLowerCase().includes(`${lower}-`)) && /-admin\.json$/i.test(f));
    if (adminCand) return path.join(TOKENS_DIR, adminCand);
    const cand = files.find(f => f.toLowerCase().startsWith(lower) || f.toLowerCase().includes(`${lower}-`));
    if (cand) return path.join(TOKENS_DIR, cand);
  } catch (e) {
    if (process.env.DEBUG_SHOPIFY_TOKEN) console.warn('[token][resolve] failed', e?.message || e);
  }
  return null;
}
// Flexibles Lesen eines Token-Files (JSON mit access_token | token | accessToken oder Plain-Text)
function readTokenFileFlexible(p) {
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8').trim();
    if (!raw) return null;
    try {
      const j = JSON.parse(raw);
      if (j && typeof j === 'object') {
        return j.access_token || j.token || j.accessToken || null;
      }
    } catch (_) {
      // not JSON: treat as plaintext token
  // Hyphen muss in dieser Klasse nicht escaped sein (ESLint no-useless-escape)
  if (/^[A-Za-z0-9_-]{20,}$/.test(raw)) return raw;
    }
  } catch (e) {
    if (process.env.DEBUG_SHOPIFY_TOKEN) console.warn('[token][flex] read failed', p, e?.message || e);
  }
  return null;
}
const getStoredToken = (shop) => {
  try {
    const p = resolveTokenFile(shop);
    if (p) return readTokenFileFlexible(p);
  } catch (e) {
    if (process.env.DEBUG_SHOPIFY_TOKEN) console.warn('[shopify][debug] token read failed', e?.message || e);
  }
  return null;
};
const saveToken = (shop, token) => {
  try {
    fs.writeFileSync(tokenPathFor(shop), JSON.stringify({ access_token: token }, null, 2));
  } catch (e) {
    console.error('[auth] Failed to persist token', e?.message || e);
  }
};

// NEU: Shop aus Token-Verzeichnis raten (wenn kein shop-Param übergeben wurde)
function guessShopFromTokens() {
  try {
    if (!fs.existsSync(TOKENS_DIR)) return null;
    const files = fs.readdirSync(TOKENS_DIR).filter(f => f.endsWith('.json'));
    if (!files.length) return null;
    // 1) Prefer env SHOPIFY_SHOP if matching token exists
    const envShop = normalizeShopName(process.env.SHOPIFY_SHOP || '');
    if (envShop) {
      const target = `${envShop}.json`;
      if (files.includes(target)) return envShop;
    }
    // 2) If exactly one token file, pick it
    if (files.length === 1) return normalizeShopName(path.basename(files[0], '.json'));
    // 3) No clear default
    return null;
  } catch { return null; }
}

// Debug endpoint to verify token discovery logic (requires DEBUG_SHOPIFY_TOKEN to be truthy)
app.get('/debug/token-check', (req, res) => {
  if (!process.env.DEBUG_SHOPIFY_TOKEN) return res.status(403).json({ error: 'disabled' });
  try {
    const rawShop = req.query.shop || legacyShopName;
    const normalized = normalizeShopName(rawShop);
    const expectedFile = tokenPathFor(normalized);
    const resolvedFile = resolveTokenFile(normalized);
    let exists = false, raw = '', parsed = null, parseError = null;
    let resolvedExists = false;
    try { exists = fs.existsSync(expectedFile); } catch {}
    try { resolvedExists = resolvedFile ? fs.existsSync(resolvedFile) : false; } catch {}
    if (resolvedExists) {
      try { raw = fs.readFileSync(resolvedFile, 'utf8'); } catch (e) { parseError = 'read_error:' + e.message; }
      if (raw) {
        try { parsed = JSON.parse(raw); } catch (e) { parseError = 'json_error:' + e.message; }
      }
    }
    return res.json({
      shopParam: rawShop,
      normalized,
      expectedFile,
      exists,
      resolvedFile,
      resolvedExists,
      rawSample: raw.slice(0, 120),
      hasAccessTokenKey: Boolean(parsed && Object.prototype.hasOwnProperty.call(parsed, 'access_token')),
      accessTokenPrefix: parsed && parsed.access_token ? parsed.access_token.slice(0, 12) + '...' : null,
      parseError
    });
  } catch (e) {
    return res.status(500).json({ error: 'debug_failed', details: e?.message || String(e) });
  }
}); // moved closing brace up; removed accidental nested /debug/env

// Standalone runtime env check (not nested)
app.get('/debug/env', (req, res) => {
  const raw = String(process.env.SHOPIFY_ACCESS_TOKEN || '');
  const sanitized = raw.trim().replace(/^['"]|['"]$/g, '');

  // Zusatz: Shop/Token-Datei-Infos
  const shopName = normalizeShopName(process.env.SHOPIFY_SHOP || legacyShopName);
  let expectedFile = null, exists = false, sample = null;
  try {
    expectedFile = tokenPathFor(shopName);
    exists = fs.existsSync(expectedFile);
    if (exists) {
      const rawFile = fs.readFileSync(expectedFile, 'utf8');
      sample = rawFile.slice(0, 80);
    }
  } catch {}

  res.json({
    SHOPIFY_SHOP: process.env.SHOPIFY_SHOP || null,
    normalizedShop: shopName,
    has_SHOPIFY_ACCESS_TOKEN: Boolean(sanitized),
    DEBUG_SHOPIFY_TOKEN: process.env.DEBUG_SHOPIFY_TOKEN || null,
    expectedTokenFile: expectedFile,
    tokenFileExists: exists,
    tokenFileSample: sample,
    cwd: process.cwd()
  });
});

// ------------------------------------------------------------
// Materials API: Group by custom.artikelgruppierung + vendor,
// material from custom.material; exclude Type=Muster; ignore
// unpublished; dedupe by material; sort client-side; provide
// detailed debug counters. This route is designed to be
// deployed to https://app.wirzapp.ch.
// ------------------------------------------------------------
function stripAccentsLower(s){
  try{ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }catch(_){ return String(s||'').toLowerCase().trim(); }
}
// Minimal: Material nicht mappen, nur trimmen (Dedupe erfolgt case/diakritik-insensitiv)
function canonMaterial(label){
  return String(label||'').trim();
}

async function shopifyGraphQL({ shop, token, query, variables }){
  const endpoint = `https://${shop}.myshopify.com/admin/api/2024-07/graphql.json`;
  const resp = await fetchFn(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    },
    body: JSON.stringify({ query, variables })
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(()=> '');
    throw new Error(`[shopify:gql] HTTP ${resp.status} ${txt.slice(0,200)}`);
  }
  const j = await resp.json();
  if (j.errors) throw new Error('[shopify:gql] ' + JSON.stringify(j.errors).slice(0,300));
  return j.data;
}

const PRODUCTS_QUERY = `
query ProductsByQuery($first:Int!, $after:String, $query:String){
  products(first: $first, after: $after, query: $query) {
    pageInfo { hasNextPage endCursor }
    edges {
      cursor
      node {
        handle
        title
        vendor
        productType
        status
        metafieldArtikel: metafield(namespace:"custom", key:"artikelgruppierung"){ value }
        metafieldMaterial: metafield(namespace:"custom", key:"material"){ value }
      }
    }
  }
}`;

app.get('/api/materials', rateLimitSimple({ max: 60, windowMs: 60_000 }), async (req, res) => {
  const t0 = Date.now();
  try {
    const rawGroup = String(req.query.group || '').trim();
    const rawVendor = String(req.query.vendor || '').trim();
    const rawShop = normalizeShopName(req.query.shop || legacyShopName);
    const limit = Math.min(8, Math.max(1, Number(req.query.limit || 8)));
  const debugWanted = String(req.query.debug || '0') === '1';
  const includeDraft = String(req.query.includeDraft || '0') === '1';
    const allowVendorFallback = String(req.query.allowVendorFallback || '0') === '1';
    if (!rawGroup) return res.status(400).json({ error: 'group_required' });

    const token = getStoredToken(rawShop) || legacyAccessToken;
    if (!token) return res.status(401).json({ error: 'no_token' });

    const normVendor = stripAccentsLower(rawVendor);
    const normGroup = stripAccentsLower(rawGroup);

    async function fetchCandidates(useVendorFilter){
      let fetched = 0; const out = [];
      // Debug counters across fetched candidates
      let withGroupMeta = 0;
      let groupMatched = 0;
      let vendorMatchedWithinGroup = 0;
      let vendorMismatchedWithinGroup = 0;
      let withMaterialWithinGroup = 0;
      const groupPool = []; // all products where group matched (for optional vendor-less fallback and debug)
      const sampleProducts = [];
      let after = null; let page = 0;
      // Build Admin search query: status:active unless includeDraft; hard-filter by group metafield; optional vendor
      const parts = [];
      if (!includeDraft) parts.push('status:active');
      if (rawGroup) {
        const escGroup = String(rawGroup).replace(/["\\]/g, '\\$&');
        parts.push(`metafield:${'custom'}.${'artikelgruppierung'}:"${escGroup}"`);
      }
      if (useVendorFilter && rawVendor) {
        // Escape single quotes in vendor
        const vq = rawVendor.replace(/'/g, "\\'");
        parts.push(`vendor:'${vq}'`);
      }
      const searchQuery = parts.join(' ');
      for (;;) {
        page++;
        const data = await shopifyGraphQL({ shop: rawShop, token, query: PRODUCTS_QUERY, variables: { first: 100, after, query: searchQuery } });
        const edges = data?.products?.edges || [];
        for (const e of edges) {
          const n = e?.node; if (!n) continue;
          fetched++;
          // Exclude Type=Muster
          if (stripAccentsLower(n.productType) === 'muster') continue;
          // Published/status via search query; keep a light guard on status unless includeDraft
          if (!includeDraft && n.status && String(n.status).toUpperCase() !== 'ACTIVE') continue;
          const grpValRaw = n.metafieldArtikel?.value || '';
          const grp = stripAccentsLower(grpValRaw);
          if (grpValRaw) withGroupMeta++;
          if (grp !== normGroup) continue; // group match strict
          groupMatched++;
          const vendOk = !rawVendor || (stripAccentsLower(n.vendor) === normVendor);
          if (vendOk) {
            vendorMatchedWithinGroup++;
            out.push({ node: n, vendOk: true });
          } else {
            vendorMismatchedWithinGroup++;
            groupPool.push(n);
          }
          // Capture a few sample group-matched products for diagnostics
          if (sampleProducts.length < 5) {
            sampleProducts.push({
              handle: n.handle,
              vendor: n.vendor,
              productType: n.productType,
              status: n.status,
              artikelgruppierung: grpValRaw,
              material: n.metafieldMaterial?.value || ''
            });
          }
          // Track material presence within group
          if ((n.metafieldMaterial?.value || '').trim()) withMaterialWithinGroup++;
          if (out.length >= 1000) break; // hard safety cap
        }
        if (out.length >= 1000) break;
        const pi = data?.products?.pageInfo;
        if (!pi?.hasNextPage) break;
        after = pi.endCursor || null;
        if (page >= 10) break; // safety: max 10 pages
      }
  return { fetched, out, counters: { withGroupMeta, groupMatched, vendorMatchedWithinGroup, vendorMismatchedWithinGroup, withMaterialWithinGroup }, groupPool, sampleProducts, searchQuery };
    }

    // Phase 1: strikt (mit Vendor falls übergeben)
    const phase = await fetchCandidates(true);
    const keptByGroup = phase.counters.groupMatched;
    const keptByVendor = phase.counters.vendorMatchedWithinGroup;
    let pool = phase.out.map(x => x.node);
    let withoutVendorCount = 0;
    let fallbackUsed = false;

    // Extract materials and build items
    let withMaterial = 0, excludedMuster = 0;
    const seen = new Set();
    const items = [];
    for (const n of pool) {
      if (stripAccentsLower(n.productType) === 'muster') { excludedMuster++; continue; }
      const matRaw = n.metafieldMaterial?.value || '';
      const mat = canonMaterial(matRaw);
      if (!mat) continue;
      withMaterial++;
      const key = stripAccentsLower(mat);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ handle: n.handle, title: n.title, vendor: n.vendor, material: mat });
      if (items.length >= limit) break;
    }

    // Optional vendor-less fallback: Re-run search WITHOUT vendor filter when nothing found
    if (items.length === 0 && allowVendorFallback) {
      const phase2 = await fetchCandidates(false);
      const seen2 = new Set();
      withoutVendorCount = 0;
      for (const n of phase2.out.map(x => x.node).concat(phase2.groupPool || [])) {
        if (stripAccentsLower(n.productType) === 'muster') continue;
        const matRaw = n.metafieldMaterial?.value || '';
        const mat = canonMaterial(matRaw);
        if (!mat) continue;
        const key = stripAccentsLower(mat);
        if (seen2.has(key)) continue;
        seen2.add(key);
        withoutVendorCount++;
        items.push({ handle: n.handle, title: n.title, vendor: n.vendor, material: mat });
        if (items.length >= limit) break;
      }
      if (items.length > 0) fallbackUsed = true;
    }

    const payload = { items };
    if (debugWanted) {
      payload.debug = {
  search: phase.searchQuery,
  searchNoVendor: allowVendorFallback ? (await (async()=>{ try{ const parts=[]; if(!includeDraft) parts.push('status:active'); if(rawGroup){ const esc=String(rawGroup).replace(/["\\]/g,'\\$&'); parts.push(`metafield:${'custom'}.${'artikelgruppierung'}:"${esc}"`);} return parts.join(' ');}catch(_){ return null; } })()) : null,
        shop: rawShop,
        tokenFile: tokenPathFor(rawShop),
        vendorNormalized: normVendor,
        groupNormalized: normGroup,
        includeDraft,
        fetched: phase.fetched,
        keptByGroup,
        keptByVendor,
        withMaterial,
        excludedMuster,
        withoutVendorCount,
        counts: phase.counters,
        fallbackUsed,
        samples: phase.sampleProducts,
        tookMs: Date.now() - t0
      };
    }
    return res.json(payload);
  } catch (e) {
    try { console.error('[api/materials] error', e?.message || e); } catch {}
    const debugWanted = String(req.query.debug || '0') === '1';
    if (debugWanted) {
      return res.json({ items: [], debug: { error: true, details: e?.message || String(e), group: String(req.query.group||''), vendor: String(req.query.vendor||''), shop: normalizeShopName(req.query.shop||legacyShopName) } });
    }
    return res.status(500).json({ error: 'materials_failed', details: e?.message || String(e) });
  }
});

// Inspect a single product's relevant metafields (artikelgruppierung/material) to aid debugging
// GET /api/materials/inspect?shop=<name>&(id=123456789|gid=gid://shopify/Product/123|handle=foo|title=Bar)
// Optional: includeDraft=1
app.get('/api/materials/inspect', async (req, res) => {
  try {
    const rawShop = normalizeShopName(req.query.shop || legacyShopName);
    const token = getStoredToken(rawShop) || legacyAccessToken;
    if (!token) return res.status(401).json({ error: 'no_token' });
    const includeDraft = String(req.query.includeDraft || '0') === '1';

    const idParam = String(req.query.id || req.query.gid || '').trim();
    const handle = String(req.query.handle || '').trim();
    const title = String(req.query.title || '').trim();
    if (!idParam && !handle && !title) return res.status(400).json({ error: 'missing_locator', want: ['id|gid', 'handle', 'title'] });

    const toGid = (idish) => {
      const n = Number(String(idish).replace(/.*\/(\d+)$/, '$1'));
      return Number.isFinite(n) && n > 0 ? `gid://shopify/Product/${n}` : null;
    };

    // Queries
    const Q_BY_ID = `query($id:ID!){ product(id:$id){ id handle title vendor status metafieldArtikel: metafield(namespace:"custom", key:"artikelgruppierung"){ value } metafieldMaterial: metafield(namespace:"custom", key:"material"){ value } } }`;
    const Q_BY_HANDLE = `query($h:String!){ productByHandle(handle:$h){ id handle title vendor status metafieldArtikel: metafield(namespace:"custom", key:"artikelgruppierung"){ value } metafieldMaterial: metafield(namespace:"custom", key:"material"){ value } } }`;
    const Q_BY_TITLE = `query($q:String!,$first:Int!){ products(first:$first, query:$q){ edges{ node{ id handle title vendor status metafieldArtikel: metafield(namespace:"custom", key:"artikelgruppierung"){ value } metafieldMaterial: metafield(namespace:"custom", key:"material"){ value } } } } }`;

    let resolvedBy = null;
    let product = null;

    if (idParam) {
      const gid = toGid(idParam);
      if (!gid) return res.status(400).json({ error: 'invalid_id', id: idParam });
      const data = await shopifyGraphQL({ shop: rawShop, token, query: Q_BY_ID, variables: { id: gid } });
      product = data?.product || null;
      resolvedBy = 'id';
    } else if (handle) {
      const data = await shopifyGraphQL({ shop: rawShop, token, query: Q_BY_HANDLE, variables: { h: handle } });
      product = data?.productByHandle || null;
      resolvedBy = 'handle';
    } else {
      // title
      const esc = (s) => String(s).replace(/["\\]/g, '\\$&');
      const parts = [];
      if (!includeDraft) parts.push('status:active');
      parts.push(`title:"${esc(title)}"`);
      const search = parts.join(' ');
      const data = await shopifyGraphQL({ shop: rawShop, token, query: Q_BY_TITLE, variables: { q: search, first: 5 } });
      const edges = Array.isArray(data?.products?.edges) ? data.products.edges : [];
      product = edges[0]?.node || null;
      resolvedBy = 'title';
    }

    if (!product) return res.status(404).json({ error: 'not_found' });
    const groupRaw = product?.metafieldArtikel?.value || '';
    const materialRaw = product?.metafieldMaterial?.value || '';
    return res.json({
      shop: `${rawShop}.myshopify.com`,
      resolvedBy,
      product: {
        id: Number(String(product.id || '').replace(/.*\/(\d+)$/, '$1')) || null,
        handle: product.handle,
        title: product.title,
        vendor: product.vendor,
        status: product.status
      },
      artikelgruppierung: { raw: groupRaw, normalized: stripAccentsLower(groupRaw) },
      material: { raw: materialRaw, normalized: stripAccentsLower(materialRaw) }
    });
  } catch (e) {
    return res.status(500).json({ error: 'inspect_failed', details: e?.message || String(e) });
  }
});

// Scan a group across the shop to see which products match and which vendors they belong to
// GET /api/materials/group-scan?shop=<name>&group=<value>[&vendor=...][&includeDraft=1][&limit=20]
app.get('/api/materials/group-scan', async (req, res) => {
  try {
    const rawShop = normalizeShopName(req.query.shop || legacyShopName);
    const token = getStoredToken(rawShop) || legacyAccessToken;
    if (!token) return res.status(401).json({ error: 'no_token' });
    const rawGroup = String(req.query.group || '').trim();
    if (!rawGroup) return res.status(400).json({ error: 'group_required' });
    const rawVendor = String(req.query.vendor || '').trim();
    const includeDraft = String(req.query.includeDraft || '0') === '1';
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 20));

    const normGroup = stripAccentsLower(rawGroup);
    const normVendor = stripAccentsLower(rawVendor);

    // Use the same PRODUCTS_QUERY as main materials route and filter strictly here
    const parts = [];
    if (!includeDraft) parts.push('status:active');
    // Include group filter in Admin search to avoid scanning unrelated products; optional vendor to narrow down further
    if (rawGroup) {
      const escGroup = String(rawGroup).replace(/["\\]/g, '\\$&');
      parts.push(`metafield:${'custom'}.${'artikelgruppierung'}:"${escGroup}"`);
    }
    if (rawVendor) {
      const vq = rawVendor.replace(/'/g, "\\'");
      parts.push(`vendor:'${vq}'`);
    }
    const searchQuery = parts.join(' ');

    let fetched = 0;
    let withGroupMeta = 0;
    let groupMatched = 0;
    let vendorMatched = 0;
    const items = [];
    let after = null;
    let pages = 0;
    while (items.length < limit && pages < 10) {
      pages++;
      const data = await shopifyGraphQL({ shop: rawShop, token, query: PRODUCTS_QUERY, variables: { first: 100, after, query: searchQuery } });
      const edges = data?.products?.edges || [];
      for (const e of edges) {
        const n = e?.node; if (!n) continue;
        fetched++;
        if (!includeDraft && n.status && String(n.status).toUpperCase() !== 'ACTIVE') continue;
        const grpRaw = n.metafieldArtikel?.value || '';
        if (grpRaw) withGroupMeta++;
        if (stripAccentsLower(grpRaw) !== normGroup) continue;
        groupMatched++;
        const vendOk = !rawVendor || stripAccentsLower(n.vendor) === normVendor;
        if (vendOk) vendorMatched++;
        items.push({ handle: n.handle, title: n.title, vendor: n.vendor, status: n.status, artikelgruppierung: grpRaw, material: n.metafieldMaterial?.value || '' });
        if (items.length >= limit) break;
      }
      const pi = data?.products?.pageInfo;
      if (!pi?.hasNextPage || items.length >= limit) break;
      after = pi.endCursor || null;
    }
    return res.json({
      shop: `${rawShop}.myshopify.com`,
      search: searchQuery,
      counts: { fetched, withGroupMeta, groupMatched, vendorMatched },
      items
    });
  } catch (e) {
    return res.status(500).json({ error: 'group_scan_failed', details: e?.message || String(e) });
  }
});

// Debug: Token speichern (nur wenn DEBUG_SHOPIFY_TOKEN gesetzt ist)
app.post('/debug/token-save', (req, res) => {
  if (!process.env.DEBUG_SHOPIFY_TOKEN) return res.status(403).json({ error: 'disabled' });
  try {
    const shopRaw = req.body && (req.body.shop || process.env.SHOPIFY_SHOP) || legacyShopName;
    const tokenRaw = req.body && req.body.token;
    if (!tokenRaw) return res.status(400).json({ error: 'missing_token' });
    const shopName = normalizeShopName(shopRaw);
    const token = String(tokenRaw).trim().replace(/^['"]|['"]$/g, '');
    saveToken(shopName, token);
    const file = tokenPathFor(shopName);
    return res.json({
      ok: true,
      shop: `${shopName}.myshopify.com`,
      file,
      tokenPrefix: token.slice(0, 8) + '...'
    });
  } catch (e) {
    return res.status(500).json({ error: 'save_failed', details: e?.message || String(e) });
  }
});


const getShopFromReq = (req) => {
  const q = req.query.shop || req.headers['x-shopify-shop-domain'] || req.headers['x-shopify-shop'];
    let name = q ? normalizeShopName(q) : null; // Normalize the shop name
  if (!name) {
    const fromTokens = guessShopFromTokens();
    if (fromTokens) name = fromTokens;
  }
  if (!name) name = legacyShopName;
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

// --- Image Import API (CSV/XLSX) ---
const { importImages, rowsFromFile, ensureProductIdByHandle, getLastResultsUrl } = require('./services/imageImport');
const uploadCsv = multer({ storage: multer.memoryStorage() });

// POST /import/images: multipart/form-data with field 'file'
// Optional query/body: prefer=jpeg|png, concurrency=number
app.post('/import/images', uploadCsv.single('file'), async (req, res) => {
  try {
    // Shop & Auth: prefer token file on disk, then sanitized env fallback
  const shopDomain = req.body?.shop ? `${normalizeShopName(req.body.shop)}.myshopify.com` : getShopFromReq(req);
    const shop = normalizeShopName(shopDomain);
    const envTokenRaw = String(process.env.SHOPIFY_ACCESS_TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
    const token = getStoredToken(shop) || getStoredToken(normalizeShopName(shop)) || (envTokenRaw || null);
    if (!token) return res.status(401).json({ error: 'missing_admin_token' });

    // Preflight: ensure write_products scope is granted, otherwise image uploads will 403
    try {
      const client = new Shopify({ shopName: shop, accessToken: token });
      let scopes = [];
      try {
        const list = await client.accessScope.list();
        scopes = Array.isArray(list) ? list.map(s => s.handle || s) : [];
      } catch (_) {
        // Fallback: direct REST call
        const r = await fetchFn(`https://${shop}.myshopify.com/admin/oauth/access_scopes.json`, { headers: { 'X-Shopify-Access-Token': token } });
        const b = await r.json().catch(() => ({}));
        scopes = Array.isArray(b?.access_scopes) ? b.access_scopes.map(s => s.handle) : [];
      }
      if (!scopes.includes('write_products')) {
        return res.status(403).json({
          error: 'missing_scope_write_products',
          message: 'Der aktuelle Token hat keine write_products-Berechtigung. Produktbilder können so nicht hochgeladen werden.',
          have_scopes: scopes,
          need_scopes: ['write_products'],
          fix: {
            reinstall: `/auth?shop=${shop}.myshopify.com`,
            note: 'App mit write_products erneut installieren oder Admin API Token mit write_products generieren und unter /backend/tokens/ speichern.'
          }
        });
      }
    } catch (e) {
      // Wenn die Scope-Prüfung selbst scheitert, fahren wir fort, aber loggen zur Diagnose
      try { console.warn('[import/images] scope preflight failed', e?.message || e); } catch {}
    }
    if (!req.file || !req.file.buffer || !req.file.originalname) return res.status(400).json({ error: 'missing_file' });

    const prefer = (req.body?.prefer || req.query?.prefer || 'jpeg').toString().toLowerCase() === 'png' ? 'png' : 'jpeg';
  const cc = Number(req.body?.concurrency || req.query?.concurrency || 4);
  const concurrency = Number.isFinite(cc) && cc > 0 && cc <= 8 ? cc : 4;

    // Parse rows without writing to disk
    let rows;
    const name = req.file.originalname.toLowerCase();
    if (name.endsWith('.csv')) {
      const { parse } = require('csv-parse');
      const text = req.file.buffer.toString('utf8');
      // Sniff delimiter from first non-empty line
      const firstLine = (text.split(/\r?\n/).find(l => l.trim().length > 0) || '').trim();
      const counts = {
        ';': (firstLine.match(/;/g) || []).length,
        ',': (firstLine.match(/,/g) || []).length,
        '\t': (firstLine.match(/\t/g) || []).length,
        '|': (firstLine.match(/\|/g) || []).length,
      };
      let delimiter = ',';
      let maxCount = -1;
      const order = [';', ',', '\t', '|'];
      for (const key of order) {
        const c = counts[key];
        if (c > maxCount) { maxCount = c; delimiter = key; }
      }
      // Parse with the chosen delimiter and lower-case headers
      rows = await new Promise((resolve, reject) => {
        parse(text, { columns: (h) => String(h).trim().toLowerCase(), skip_empty_lines: true, trim: true, delimiter }, (err, out) => {
          if (err) return reject(err);
          resolve(out);
        });
      });
      // If somehow we still only got one column, attempt a last-resort try with semicolon
      const looksSingleCol = Array.isArray(rows) && rows.length > 0 && rows.every(r => Object.keys(r || {}).length <= 1);
      if (looksSingleCol && delimiter !== ';') {
        rows = await new Promise((resolve, reject) => {
          parse(text, { columns: (h) => String(h).trim().toLowerCase(), skip_empty_lines: true, trim: true, delimiter: ';' }, (err, out) => {
            if (err) return reject(err);
            resolve(out);
          });
        });
      }
      // Normalize keys and common variants (strip BOM, unify)
      rows = Array.isArray(rows) ? rows.map((r) => {
        if (!r || typeof r !== 'object') return r;
        const out = {};
        for (const [kRaw, vRaw] of Object.entries(r)) {
          let k = String(kRaw || '').replace(/^\uFEFF/, '').trim().toLowerCase();
          // unify key variants
          if (k === 'image url') k = 'image_url';
          if (k === 'bild url') k = 'bild-url';
          if (k === 'wd_picture' || k === 'wd picture') k = 'wd-picture';
          if (k === 'postition' || k === 'pos') k = 'position';
          // assign trimmed value (strings) or keep as-is
          const v = (vRaw == null) ? '' : (typeof vRaw === 'string' ? vRaw.trim() : vRaw);
          out[k] = v;
        }
        return out;
      }) : rows;
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const XLSX = require('xlsx');
      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      // Use header 1 and normalize to lowercase
      rows = XLSX.utils.sheet_to_json(sheet, { defval: '', header: 1 });
      if (Array.isArray(rows) && rows.length) {
        const rawHeaders = (rows[0] || []).map(h => String(h || '').trim().toLowerCase().replace(/^\uFEFF/, ''));
        const body = rows.slice(1);
        rows = body.map((arr) => {
          const obj = {};
          rawHeaders.forEach((h, i) => { obj[h] = (arr && arr[i] != null) ? (typeof arr[i] === 'string' ? arr[i].trim() : arr[i]) : ''; });
          return obj;
        });
      } else {
        rows = [];
      }
      // Normalize keys for XLSX too
      rows = Array.isArray(rows) ? rows.map((r) => {
        if (!r || typeof r !== 'object') return r;
        const out = {};
        for (const [kRaw, vRaw] of Object.entries(r)) {
          let k = String(kRaw || '').replace(/^\uFEFF/, '').trim().toLowerCase();
          if (k === 'image url') k = 'image_url';
          if (k === 'bild url') k = 'bild-url';
          if (k === 'wd_picture' || k === 'wd picture') k = 'wd-picture';
          if (k === 'postition' || k === 'pos') k = 'position';
          const v = (vRaw == null) ? '' : (typeof vRaw === 'string' ? vRaw.trim() : vRaw);
          out[k] = v;
        }
        return out;
      }) : rows;
      // Normalize keys for XLSX too
      rows = Array.isArray(rows) ? rows.map((r) => {
        if (!r || typeof r !== 'object') return r;
        const out = {};
        for (const [kRaw, vRaw] of Object.entries(r)) {
          let k = String(kRaw || '').replace(/^\uFEFF/, '').trim().toLowerCase();
          if (k === 'image url') k = 'image_url';
          if (k === 'bild url') k = 'bild-url';
          if (k === 'wd_picture' || k === 'wd picture') k = 'wd-picture';
          if (k === 'postition' || k === 'pos') k = 'position';
          const v = (vRaw == null) ? '' : (typeof vRaw === 'string' ? vRaw.trim() : vRaw);
          out[k] = v;
        }
        return out;
      }) : rows;
    } else {
      return res.status(400).json({ error: 'unsupported_file' });
    }

    // Quick diagnostic: log first row keys for troubleshooting (limited)
    try {
      if (Array.isArray(rows) && rows.length) {
        const keys = Object.keys(rows[0] || {});
        console.log('[import/images] firstRowKeys', keys);
      }
    } catch (_) {}

    // Decide response mode: JSON (default) or SSE (when progress=sse)
    const wantsSse = String(req.body?.progress || req.query?.progress || '').toLowerCase() === 'sse';
    if (wantsSse) {
      // Stream progress via Server-Sent Events
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        // CORS headers are already handled by cors(), but SSE often benefits from explicit flush
        'X-Accel-Buffering': 'no'
      });
      const total = rows.length;
      let processed = 0, okc = 0, failc = 0;
      const send = (event, dataObj) => {
        try {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(dataObj)}\n\n`);
        } catch (e) {
          // client likely disconnected
        }
      };
      // initial event
      send('start', { total, shop: `${shop}.myshopify.com` });
      const onProgress = (p) => {
        processed += Number(p?.processed || 0);
        okc += Number(p?.ok || 0);
        failc += Number(p?.fail || 0);
        send('progress', { total, processed, ok: okc, fail: failc, last: p?.last });
      };
      try {
        const results = await importImages({ shop, token, rows, prefer, concurrency, onProgress });
        const ok = results.filter(r => r.ok).length;
        const fail = results.length - ok;
        let exportUrl = null; try { exportUrl = getLastVariantExportUrl && getLastVariantExportUrl(); } catch {}
        let resultsUrl = null; try { resultsUrl = getLastResultsUrl && getLastResultsUrl(); } catch {}
  // 'ok' doppelt war ein ESLint-Fehler (no-dupe-keys). Umbennen in okCount für Klarheit.
  send('done', { ok: true, shop: `${shop}.myshopify.com`, total: results.length, okCount: ok, fail, results, exportUrl, resultsUrl });
      } catch (e) {
        send('error', { ok: false, error: e?.message || String(e) });
      } finally {
        try { res.end(); } catch {}
      }
      return; // already responded
    }

  // Process rows with batching & configured concurrency (JSON response)
  const results = await importImages({ shop, token, rows, prefer, concurrency });
    const ok = results.filter(r => r.ok).length;
    const fail = results.length - ok;
  let exportUrl = null; try { exportUrl = getLastVariantExportUrl && getLastVariantExportUrl(); } catch {}
  let resultsUrl = null; try { resultsUrl = getLastResultsUrl && getLastResultsUrl(); } catch {}
  return res.json({ shop: `${shop}.myshopify.com`, total: results.length, ok, fail, results, exportUrl, resultsUrl });
  } catch (e) {
    console.error('[import/images] failed', e?.message || e);
    return res.status(500).json({ error: 'import_failed', message: e?.message || String(e) });
  }
});

// Provide last generated variant export URL (xlsx/csv) for download after an import
app.get('/import/images/last-variant-export', (req, res) => {
  try {
    const url = getLastVariantExportUrl && getLastVariantExportUrl();
    if (!url) return res.json({ ok: true, available: false });
    return res.json({ ok: true, available: true, url });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Provide last detailed import results (JSON) URL or inline
app.get('/import/images/last-results', (req, res) => {
  try {
    const url = getLastResultsUrl && getLastResultsUrl();
    if (!url) return res.json({ ok: true, available: false });
    // Inline mode: if ?inline=1, read and return JSON content directly
    const inline = String(req.query.inline || '').toLowerCase() === '1';
    if (!inline) return res.json({ ok: true, available: true, url });
    try {
      const p = path.join(__dirname, url.replace(/^\/?exports\//, 'exports/'));
      if (!fs.existsSync(p)) return res.status(404).json({ ok: false, error: 'not_found' });
      const raw = fs.readFileSync(p, 'utf8');
      const json = JSON.parse(raw);
      return res.json({ ok: true, available: true, inline: true, data: json });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Debug: wd-picture Metafield für ein Produkt prüfen (nach ID oder Handle)
app.get('/debug/product-wd-picture', async (req, res) => {
  try {
    const idParam = req.query.id ? Number(req.query.id) : null;
    const handle = (req.query.handle || '').toString().trim().toLowerCase();
    if (!idParam && !handle) return res.status(400).json({ error: 'missing_id_or_handle' });
    const shopDomain = req.query.shop ? `${normalizeShopName(req.query.shop)}.myshopify.com` : getShopFromReq(req);
    const shopName = normalizeShopName(shopDomain);
    const token = getStoredToken(shopName) || String(process.env.SHOPIFY_ACCESS_TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
    if (!token) return res.status(401).json({ error: 'missing_admin_token' });
    const client = new Shopify({ shopName, accessToken: token });
    let productId = idParam;
    if (!productId && handle) {
      // Try productByHandle
      let raw = await client.graphql(`query($h:String!){ productByHandle(handle:$h){ id } }`, { h: handle });
      let obj; try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = raw; }
      let gid = obj?.data?.productByHandle?.id || null;
      if (!gid) {
        // Try products query
        raw = await client.graphql(`query($q:String!){ products(first:1, query:$q){ edges{ node{ id handle } } } }`, { q: `handle:${handle}` });
        try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = raw; }
        gid = obj?.data?.products?.edges?.[0]?.node?.id || null;
      }
      if (!gid) {
        // Last resort: REST scan for exact handle
        try {
          let since_id = undefined; const limit = 250; let found = null;
          while (!found) {
            const params = { limit, published_status: 'any', status: 'any' }; if (since_id) params.since_id = since_id;
            const products = await client.product.list(params); if (!products?.length) break;
            for (const p of products) { if (String(p.handle||'').toLowerCase() === handle) { found = p; break; } }
            if (found) break; since_id = products[products.length-1]?.id; if (!since_id || products.length < limit) break;
          }
          if (found) gid = `gid://shopify/Product/${found.id}`;
        } catch {}
      }
      if (!gid) return res.status(404).json({ error: 'product_not_found', handle });
      productId = Number(String(gid).replace(/.*\/(\d+)$/, '$1'));
    }
    if (!productId) return res.status(404).json({ error: 'product_not_found' });
    const gid = `gid://shopify/Product/${productId}`;
    const q = `query($id:ID!){ product(id:$id){ id handle title metafield(namespace:"custom", key:"wd-picture"){ id type value reference{ __typename ... on MediaImage { id } ... on File { id } } } } }`;
    const raw = await client.graphql(q, { id: gid });
    let obj; try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = raw; }
    const p = obj?.data?.product || null;
    if (!p) return res.status(404).json({ error: 'product_not_found' });
    return res.json({ shop: `${shopName}.myshopify.com`, product_id: productId, handle: p.handle, title: p.title, wd_picture: p.metafield || null });
  } catch (e) {
    return res.status(500).json({ error: 'wd_picture_inspect_failed', details: e?.message || String(e) });
  }
});

// Debug: wd-picture Metafield-Definition prüfen
app.get('/debug/wd-picture-definition', async (req, res) => {
  try {
    const shopDomain = req.query.shop ? `${normalizeShopName(req.query.shop)}.myshopify.com` : getShopFromReq(req);
    const shopName = normalizeShopName(shopDomain);
    const token = getStoredToken(shopName) || String(process.env.SHOPIFY_ACCESS_TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
    if (!token) return res.status(401).json({ error: 'missing_admin_token' });
    const client = new Shopify({ shopName, accessToken: token });
    const q = `query($ownerType: MetafieldOwnerType!, $namespace:String!, $key:String!){ metafieldDefinitionByOwnerTypeAndKey(ownerType:$ownerType, namespace:$namespace, key:$key){ id name pinned type{ name category } validations{ name value } } }`;
    const raw = await client.graphql(q, { ownerType: 'PRODUCT', namespace: 'custom', key: 'wd-picture' });
    let obj; try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = raw; }
    return res.json({ shop: `${shopName}.myshopify.com`, definition: obj?.data?.metafieldDefinitionByOwnerTypeAndKey || null });
  } catch (e) {
    return res.status(500).json({ error: 'definition_inspect_failed', details: e?.message || String(e) });
  }
});

// Debug endpoint: parse CSV/XLSX and show first 5 rows after normalization (no import)
app.post('/import/images/parse-only', uploadCsv.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer || !req.file.originalname) return res.status(400).json({ error: 'missing_file' });
    const name = req.file.originalname.toLowerCase();
    let rows;
    if (name.endsWith('.csv')) {
      const { parse } = require('csv-parse');
      const text = req.file.buffer.toString('utf8');
      const firstLine = (text.split(/\r?\n/).find(l => l.trim().length > 0) || '').trim();
      const counts = { ';': (firstLine.match(/;/g) || []).length, ',': (firstLine.match(/,/g) || []).length, '\t': (firstLine.match(/\t/g) || []).length, '|': (firstLine.match(/\|/g) || []).length };
      let delimiter = ','; let maxCount = -1; for (const key of [';',',','\t','|']) { const c = counts[key]; if (c > maxCount) { maxCount = c; delimiter = key; } }
      rows = await new Promise((resolve, reject) => {
        parse(text, { columns: (h) => String(h).trim().toLowerCase(), skip_empty_lines: true, trim: true, delimiter }, (err, out) => {
          if (err) return reject(err); resolve(out);
        });
      });
      rows = Array.isArray(rows) ? rows.map((r) => {
        const out = {}; for (const [kRaw, vRaw] of Object.entries(r||{})) {
          let k = String(kRaw||'').replace(/^\uFEFF/,'').trim().toLowerCase();
          if (k === 'image url') k = 'image_url'; if (k === 'bild url') k = 'bild-url'; if (k === 'wd_picture' || k === 'wd picture') k = 'wd-picture'; if (k === 'postition' || k === 'pos') k = 'position';
          const v = (vRaw == null) ? '' : (typeof vRaw === 'string' ? vRaw.trim() : vRaw); out[k] = v;
        }
        return out;
      }) : rows;
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const XLSX = require('xlsx'); const wb = XLSX.read(req.file.buffer, { type: 'buffer' }); const sheet = wb.Sheets[wb.SheetNames[0]]; rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      rows = Array.isArray(rows) ? rows.map((r) => {
        const out = {}; for (const [kRaw, vRaw] of Object.entries(r||{})) {
          let k = String(kRaw||'').replace(/^\uFEFF/,'').trim().toLowerCase();
          if (k === 'image url') k = 'image_url'; if (k === 'bild url') k = 'bild-url'; if (k === 'wd_picture' || k === 'wd picture') k = 'wd-picture'; if (k === 'postition' || k === 'pos') k = 'position';
          const v = (vRaw == null) ? '' : (typeof vRaw === 'string' ? vRaw.trim() : vRaw); out[k] = v;
        }
        return out;
      }) : rows;
    } else { return res.status(400).json({ error: 'unsupported_file' }); }
    return res.json({ preview: Array.isArray(rows) ? rows.slice(0, 5) : [], count: Array.isArray(rows) ? rows.length : 0 });
  } catch (e) {
    return res.status(500).json({ error: 'parse_failed', details: e?.message || String(e) });
  }
});

// Debug: Produkt-ID über Handle prüfen (nur wenn DEBUG_IMPORT gesetzt ist)
app.get('/debug/product-id', async (req, res) => {
  if (!(process.env.DEBUG_IMPORT || process.env.DEBUG_SHOPIFY_TOKEN)) return res.status(403).json({ error: 'disabled' });
  const handle = String(req.query.handle || '').trim().toLowerCase();
  if (!handle) return res.status(400).json({ error: 'missing_handle' });
  try {
    const shopDomain = req.query.shop ? `${normalizeShopName(req.query.shop)}.myshopify.com` : getShopFromReq(req);
    const shop = normalizeShopName(shopDomain);
    const envTokenRaw = String(process.env.SHOPIFY_ACCESS_TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
    const token = getStoredToken(shop) || getStoredToken(normalizeShopName(shop)) || (envTokenRaw || null);
    if (!token) return res.status(401).json({ error: 'missing_admin_token', shop });
    const client = new Shopify({ shopName: shop, accessToken: token });
    const id = await ensureProductIdByHandle(client, handle);
    return res.json({ ok: true, shop: `${shop}.myshopify.com`, handle, product_id: id });
  } catch (e) {
    return res.status(404).json({ ok: false, shop: `${normalizeShopName(process.env.SHOPIFY_SHOP || legacyShopName)}.myshopify.com`, handle, error: e?.message || String(e) });
  }
});

// Debug: Freiform-Suche über Admin GraphQL products(query: ...) – nur mit DEBUG_IMPORT
app.get('/debug/search-products', async (req, res) => {
  if (!(process.env.DEBUG_IMPORT || process.env.DEBUG_SHOPIFY_TOKEN)) return res.status(403).json({ error: 'disabled' });
  const q = String(req.query.q || '').trim();
  const first = Math.max(1, Math.min(25, parseInt(req.query.first, 10) || 5));
  if (!q) return res.status(400).json({ error: 'missing_q' });
  try {
    const shopDomain = req.query.shop ? `${normalizeShopName(req.query.shop)}.myshopify.com` : getShopFromReq(req);
    const shop = normalizeShopName(shopDomain);
    const envTokenRaw = String(process.env.SHOPIFY_ACCESS_TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
    const token = getStoredToken(shop) || getStoredToken(normalizeShopName(shop)) || (envTokenRaw || null);
    if (!token) return res.status(401).json({ error: 'missing_admin_token', shop });
    const client = new Shopify({ shopName: shop, accessToken: token });
    const raw = await client.graphql(
      `query($q:String!,$first:Int!){ products(first:$first, query:$q){ edges{ node{ id handle title status publishedAt } } } }`,
      { q, first }
    );
    let obj; try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = raw; }
    const data = obj && (obj.data || obj);
    const edges = data && data.products && Array.isArray(data.products.edges) ? data.products.edges : [];
    const items = edges.map(e => ({ id: e?.node?.id || null, handle: e?.node?.handle || null, title: e?.node?.title || null, status: e?.node?.status || null, publishedAt: e?.node?.publishedAt || null }));
    return res.json({ shop: `${shop}.myshopify.com`, count: items.length, items });
  } catch (e) {
    return res.status(500).json({ error: 'search_failed', details: e?.message || String(e) });
  }
});

// Debug: REST-Paginierung – Handles per Substring finden (kostspielig). Nur mit DEBUG_IMPORT.
app.get('/debug/handles', async (req, res) => {
  if (!(process.env.DEBUG_IMPORT || process.env.DEBUG_SHOPIFY_TOKEN)) return res.status(403).json({ error: 'disabled' });
  const contains = String(req.query.contains || '').toLowerCase();
  const limit = Math.max(1, Math.min(250, parseInt(req.query.limit, 10) || 250));
  const maxPages = Math.max(1, Math.min(50, parseInt(req.query.maxPages, 10) || 5));
  if (!contains) return res.status(400).json({ error: 'missing_contains' });
  try {
    const shopify = clientFor(req);
    const out = [];
    let since_id = undefined;
    let pages = 0;
    while (true) {
  const params = { limit, published_status: 'any', status: 'any' };
      if (since_id) params.since_id = since_id;
      const products = await shopify.product.list(params);
      if (!Array.isArray(products) || products.length === 0) break;
      for (const p of products) {
        const h = String(p.handle || '').toLowerCase();
        if (h.includes(contains)) out.push({ id: p.id, handle: p.handle, title: p.title, status: p.status, published_at: p.published_at });
      }
      since_id = products[products.length - 1]?.id;
      pages++;
      if (!since_id || products.length < limit) break;
      if (pages >= maxPages) break;
    }
    return res.json({ count: out.length, items: out });
  } catch (e) {
    return res.status(500).json({ error: 'handles_failed', details: e?.message || String(e) });
  }
});

// Debug: Produkt via REST-API nach ID holen und Basisdaten zurückgeben
app.get('/debug/product-by-id', async (req, res) => {
  if (!(process.env.DEBUG_IMPORT || process.env.DEBUG_SHOPIFY_TOKEN)) return res.status(403).json({ error: 'disabled' });
  const id = Number(req.query.id || 0);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'missing_or_invalid_id' });
  try {
    const shopify = clientFor(req);
    const product = await shopify.product.get(id);
    if (!product) return res.status(404).json({ error: 'not_found' });
    return res.json({ id: product.id, handle: product.handle, title: product.title, status: product.status, published_at: product.published_at });
  } catch (e) {
    const status = e.statusCode || e.status || 500;
    return res.status(status).json({ error: 'lookup_failed', details: e?.message || String(e) });
  }
});

// Debug: Produkt via GraphQL mit GID abfragen
app.get('/debug/product-graphql-by-id', async (req, res) => {
  if (!(process.env.DEBUG_IMPORT || process.env.DEBUG_SHOPIFY_TOKEN)) return res.status(403).json({ error: 'disabled' });
  const idNum = Number(req.query.id || 0);
  if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ error: 'missing_or_invalid_id' });
  try {
    const shopDomain = req.query.shop ? `${normalizeShopName(req.query.shop)}.myshopify.com` : getShopFromReq(req);
    const shop = normalizeShopName(shopDomain);
    const envTokenRaw = String(process.env.SHOPIFY_ACCESS_TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
    const token = getStoredToken(shop) || getStoredToken(normalizeShopName(shop)) || (envTokenRaw || null);
    if (!token) return res.status(401).json({ error: 'missing_admin_token', shop });
    const client = new Shopify({ shopName: shop, accessToken: token });
    const gid = `gid://shopify/Product/${idNum}`;
    const raw = await client.graphql(`query($id:ID!){ product(id:$id){ id handle title status publishedAt } }`, { id: gid });
    let obj; try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = raw; }
    const data = obj && (obj.data || obj);
    const p = data && data.product;
    if (!p) return res.status(404).json({ error: 'not_found' });
    return res.json({ shop: `${shop}.myshopify.com`, id: idNum, handle: p.handle, title: p.title, status: p.status, publishedAt: p.publishedAt });
  } catch (e) {
    const msg = e?.message || String(e);
    return res.status(500).json({ error: 'graphql_failed', details: msg });
  }
});

// Debug: Produkt über Variant-SKU auflösen (REST direct + Fallback-Scan)
app.get('/debug/product-by-sku', async (req, res) => {
  if (!(process.env.DEBUG_IMPORT || process.env.DEBUG_SHOPIFY_TOKEN)) return res.status(403).json({ error: 'disabled' });
  const sku = String(req.query.sku || '').trim();
  if (!sku) return res.status(400).json({ error: 'missing_sku' });
  try {
    const shopify = clientFor(req);

    // 0) GraphQL productVariants search (supports query by sku)
    try {
      const q = `sku:${sku}`;
      const raw = await shopify.graphql(
        `query($q:String!){ productVariants(first:5, query:$q){ edges{ node{ id sku title product{ id handle title status publishedAt } } } } }`,
        { q }
      );
      let obj; try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = raw; }
      const edges = obj?.data?.productVariants?.edges || [];
      if (edges.length) {
        const n = edges[0]?.node;
        const pid = n?.product?.id ? Number(String(n.product.id).replace(/.*\/(\d+)$/, '$1')) : null;
        if (pid) {
          return res.json({
            resolved_via: 'graphql_productVariants',
            product: { id: pid, handle: n.product.handle, title: n.product.title },
            variant: { id: n.id ? Number(String(n.id).replace(/.*\/(\d+)$/, '$1')) : null, sku: n.sku, title: n.title }
          });
        }
      }
    } catch (_) {}

    // 1) Direct variant lookup via REST
    try {
      const variants = await shopify.productVariant.list({ sku, limit: 1 });
      if (Array.isArray(variants) && variants.length) {
        const v = variants[0];
        const product = await shopify.product.get(v.product_id);
        return res.json({ resolved_via: 'variant.list', product: { id: product.id, handle: product.handle, title: product.title }, variant: { id: v.id, sku: v.sku, title: v.title } });
      }
    } catch (_) {}

    // 2) Fallback: scan products (consider all statuses)
    let since_id = undefined; const limit = 250; let pages = 0;
    const candidates = [];
    while (true) {
      const params = { limit, published_status: 'any', status: 'any' };
      if (since_id) params.since_id = since_id;
      const products = await shopify.product.list(params);
      if (!Array.isArray(products) || products.length === 0) break;
      for (const p of products) {
        // product-level SKU fallback (rare but possible)
        const topSku = String(p.sku || p.SKU || p.product_sku || p.productSku || '').trim();
        if (topSku && topSku === sku) {
          return res.json({ resolved_via: 'scan_product_sku', pages, product: { id: p.id, handle: p.handle, title: p.title } });
        }
        const exact = (p.variants || []).find(v => String(v.sku || '').trim() === sku);
        if (exact) return res.json({ resolved_via: 'scan', pages, product: { id: p.id, handle: p.handle, title: p.title }, variant: { id: exact.id, sku: exact.sku, title: exact.title } });
        const fuzzy = (p.variants || []).filter(v => String(v.sku || '').trim().includes(sku));
        if (fuzzy.length) candidates.push({ id: p.id, handle: p.handle, title: p.title, matches: fuzzy.map(v => ({ id: v.id, sku: v.sku, title: v.title })) });
      }
      since_id = products[products.length - 1]?.id;
      pages++;
      if (!since_id || products.length < limit) break;
      if (pages > 200) break;
    }

    if (candidates.length === 1 && candidates[0].matches.length) {
      const c = candidates[0];
      const v = c.matches[0];
      return res.json({ resolved_via: 'scan_fuzzy', fuzzy: true, product: { id: c.id, handle: c.handle, title: c.title }, variant: { id: v.id, sku: v.sku, title: v.title }, candidates });
    }

    return res.status(404).json({ error: 'sku_not_found', sku, candidates_count: candidates.length });
  } catch (e) {
    return res.status(500).json({ error: 'lookup_failed', details: e?.message || String(e) });
  }
});

function clientFor(req) {
  const shopDomain = getShopFromReq(req); // like mystore.myshopify.com
  const shopName = normalizeShopName(shopDomain);
  // 1) Datei-Token
  const fileToken = getStoredToken(shopName);
  if (fileToken) return new Shopify({ shopName, accessToken: fileToken });

  // 2) NEU: Dynamischer Env-Fallback (trim + versehentliche Quotes entfernen)
  const envTokenRaw = String(process.env.SHOPIFY_ACCESS_TOKEN || '');
  const envToken = envTokenRaw.trim().replace(/^['"]|['"]$/g, '');
  if (envToken) {
    const envShop = normalizeShopName(process.env.SHOPIFY_SHOP || shopName);
    return new Shopify({ shopName: envShop, accessToken: envToken });
  }

  // 3) Legacy-Client (falls vorhanden)
  if (legacyClient) return legacyClient;

  // 4) Diagnose bei fehlendem Token
  if (process.env.DEBUG_SHOPIFY_TOKEN) {
    try {
      const p = tokenPathFor(shopName);
      const exists = fs.existsSync(p);
      let raw = '';
      if (exists) {
        try { raw = fs.readFileSync(p, 'utf8'); } catch (e) { raw = `[read_error:${e.message}]`; }
      }
      console.warn('[shopify][debug] missing_shop_token', {
        shopDomain, shopName, tokenFile: p, exists, sample: raw.slice(0, 160),
        hasEnvToken: Boolean(envToken), envShop: process.env.SHOPIFY_SHOP || null
      });
    } catch (e) {
      console.warn('[shopify][debug] failed diagnostics', e?.message || e);
    }
  }
  throw new Error('missing_shop_token');
}

// --- Public Siblings Proxy (Plan B): query by metafield custom.designname via Admin GraphQL ---
// Contract:
// GET /public/siblings?group=<string>&limit=12&cursor=<endCursor>
// Optional: shop=<domain or name>
// Returns: { ok, items:[{handle,title,vendor,availableForSale,featuredImage}], pageInfo:{ hasNextPage, endCursor } }
// Safeguards: simple rate limit, tiny in-memory cache (60s), max limit 50
const siblingsCache = new Map(); // key -> { expires, value }
function cacheKeySiblings({ shop, group, limit, cursor }){
  return `${shop}::${group}::${limit}::${cursor||''}`;
}
function getCachedSiblings(key){ try{ const e = siblingsCache.get(key); if(e && e.expires > Date.now()) return e.value; }catch(_){} return null; }
function setCachedSiblings(key, val, ttlMs){ try{ siblingsCache.set(key, { expires: Date.now() + (ttlMs||60_000), value: val }); }catch(_){} }

// very simple per-IP rate limiter for this route
const siblingsRate = new Map(); // ip -> { count, reset }
function limitSiblings(req, res){
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  let b = siblingsRate.get(ip);
  if(!b || now >= b.reset){ b = { count: 0, reset: now + 10_000 }; } // 10s window
  b.count++;
  siblingsRate.set(ip, b);
  if (b.count > 30) { // 3 req/s avg
    res.setHeader('Retry-After', '10');
    res.status(429).json({ ok:false, error:'rate_limited' });
    return true;
  }
  return false;
}

async function handleSiblingsProxy(req, res) {
  try {
    if (limitSiblings(req, res)) return; // rate limited
    const groupRaw = String(req.query.group || '').trim();
    if (!groupRaw) return res.status(400).json({ ok:false, error:'missing_group' });
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 12));
    const cursor = req.query.cursor ? String(req.query.cursor) : null;
    const shopDomain = req.query.shop ? `${normalizeShopName(req.query.shop)}.myshopify.com` : getShopFromReq(req);
    const shopName = normalizeShopName(shopDomain);
    const token = getStoredToken(shopName) || String(process.env.SHOPIFY_ACCESS_TOKEN || '').trim().replace(/^['"]|['"]/g, '');
    if (!token) return res.status(401).json({ ok:false, error:'missing_admin_token' });
    const debugMode = req.query.debug === '1';
    const corrId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

    const key = cacheKeySiblings({ shop: shopName, group: groupRaw, limit, cursor });
    const cached = !debugMode ? getCachedSiblings(key) : null;
    if (cached) return res.json({ ok:true, cached:true, ...cached });

    // Admin GraphQL query: products with metafield value equals groupRaw
    const client = new Shopify({ shopName, accessToken: token });
    const escaped = groupRaw.replace(/["\\]/g, '\\$&');
  // Entferne unnötige Escapes in Template-Literals (ESLint no-useless-escape)
  const search = `metafield:${'custom'}.${'designname'}:"${escaped}"`;
  const qSearch = `query($first:Int!,$after:String){ products(first:$first, after:$after, query:${JSON.stringify(search)}){ edges{ node{ id handle title vendor status totalInventory featuredImage{ url width height altText } images(first:6){ nodes{ url width height altText } } metafield(namespace:"custom", key:"designname"){ value } } } pageInfo{ hasNextPage endCursor } } }`;
  const qWide = `query($first:Int!,$after:String){ products(first:$first, after:$after){ edges{ node{ id handle title vendor status totalInventory featuredImage{ url width height altText } images(first:6){ nodes{ url width height altText } } metafield(namespace:"custom", key:"designname"){ value } } } pageInfo{ hasNextPage endCursor } } }`;

    const want = String(groupRaw).toLowerCase();
    const norm = (s) => (s||'').toString().toLowerCase();
    let items = [];
    let endCursorOut = cursor || null;
    let hasNextOut = false;
    let after = cursor || null;
    let pages = 0;
    const maxPages = 10; // safety cap
    let useWideFallback = false;
    const diagnostics = debugMode ? { correlationId: corrId, searchString: search, pages: [], final: null } : null;

    while (items.length < limit && pages < maxPages) {
      pages++;
      let raw, result;
      try {
        const first = Math.min(50, Math.max(1, limit - items.length));
        raw = await client.graphql(qSearch, { first, after });
        result = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (result && result.errors) throw new Error('gql_errors');
      } catch (e) {
        useWideFallback = true;
      }

      if (useWideFallback) {
        try {
          const first = Math.min(50, Math.max(1, limit - items.length + 8));
          const raw2 = await client.graphql(qWide, { first, after });
          result = typeof raw2 === 'string' ? JSON.parse(raw2) : raw2;
          if (result && result.errors) return res.status(502).json({ ok:false, error:'gql_errors', errors: result.errors });
        } catch (e2) {
          const msg = e2?.message || 'graphql_failed';
          return res.status(502).json({ ok:false, error:'proxy_failed', details: msg });
        }
      }

      const prod = result?.data?.products || result?.products;
      if (!prod) {
        return res.status(500).json({ ok:false, error:'invalid_response', debug: { hasData: !!result?.data, keys: result ? Object.keys(result) : null } });
      }
      const edges = Array.isArray(prod.edges) ? prod.edges : [];
      for (const e of edges){
        const n = e?.node; if (!n) continue;
        const mf = n.metafield && n.metafield.value ? String(n.metafield.value) : '';
        // Immer strikt auf exakten Gruppenwert filtern (auch wenn qSearch benutzt wurde)
        if (norm(mf) !== want) continue;
        const available = (typeof n.totalInventory === 'number' ? n.totalInventory > 0 : true) && String(n.status || '').toUpperCase() !== 'ARCHIVED';
        const nodes = n.images && n.images.nodes ? n.images.nodes : [];
        const image2 = nodes && nodes.length>1 ? nodes[1] : (nodes[0] || null);
        items.push({ handle: n.handle, title: n.title, vendor: n.vendor, availableForSale: available, featuredImage: n.featuredImage || null, images: n.images || null, image2 });
        if (items.length >= limit) break;
      }
      hasNextOut = !!prod.pageInfo?.hasNextPage;
      endCursorOut = prod.pageInfo?.endCursor || null;
      if (!hasNextOut || items.length >= limit) break;
      after = endCursorOut;
    }

    const pageInfo = { hasNextPage: hasNextOut, endCursor: endCursorOut };
    const payload = { ok:true, items, pageInfo };
    if (!debugMode) setCachedSiblings(key, payload, 60_000);
    return res.json(payload);
  } catch (e) {
    return res.status(500).json({ ok:false, error:'proxy_failed', details: e?.message || String(e) });
  }
}
// Register under multiple public paths so Nginx/static mappings don't shadow it
app.get('/public/siblings', handleSiblingsProxy);
app.get('/api/siblings', handleSiblingsProxy);
app.get('/designer/siblings', handleSiblingsProxy);

// === Materials proxy: list material variants for a product group (custom.artikelgruppierung)
// Contract (preferred): GET /api/materials?group=...&shop=...[&vendor=...]
// Back-compat (fallback): GET /api/materials?title=...&vendor=...&shop=...
// Returns: { ok, items:[{handle,title,vendor,material,featuredImage?,image2?}], count }
// Rules: when group is provided, match metafield custom.artikelgruppierung exactly; optional vendor filter.
//        Exclude titles containing "muster"; dedupe by material; clamp limit<=8
const materialsCache = new Map(); // key -> { expires, value }
const materialsRate = new Map(); // ip -> { count, reset }
function normStr(s){ try{ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }catch(_){ return String(s||'').toLowerCase(); } }
function cacheKeyMaterials({ shop, title, vendor, limit, group }){ return `${shop}::${group||''}::${title||''}::${vendor||''}::${limit}`; }
function getCachedMaterials(key){ try{ const e = materialsCache.get(key); if(e && e.expires > Date.now()) return e.value; }catch(_){} return null; }
function setCachedMaterials(key, val, ttlMs){ try{ materialsCache.set(key, { expires: Date.now() + (ttlMs||60_000), value: val }); }catch(_){} }
function limitMaterials(req, res){
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  let b = materialsRate.get(ip);
  if(!b || now >= b.reset){ b = { count: 0, reset: now + 10_000 }; }
  b.count++; materialsRate.set(ip, b);
  if (b.count > 30){ res.setHeader('Retry-After','10'); res.status(429).json({ ok:false, error:'rate_limited' }); return true; }
  return false;
}
async function handleMaterialsProxy(req, res){
  try{
    if (limitMaterials(req, res)) return;
  const rawGroup = String(req.query.group || req.query.artikelgruppierung || '').trim();
  const rawTitle = String(req.query.title || '').trim();
  const rawVendor = String(req.query.vendor || '').trim();
  if (!rawGroup && (!rawTitle || !rawVendor)) return res.status(400).json({ ok:false, error:'missing_params', require:['group'] , fallback:['title','vendor'] });
    const limit = Math.max(1, Math.min(8, parseInt(req.query.limit, 10) || 8));
    const shopDomain = req.query.shop ? `${normalizeShopName(req.query.shop)}.myshopify.com` : getShopFromReq(req);
    const shopName = normalizeShopName(shopDomain);
    const token = getStoredToken(shopName) || String(process.env.SHOPIFY_ACCESS_TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
    if (!token) return res.status(401).json({ ok:false, error:'missing_admin_token' });

  const key = cacheKeyMaterials({ shop: shopName, group: rawGroup, title: rawTitle, vendor: rawVendor, limit });
    const cached = getCachedMaterials(key); if(cached) return res.json({ ok:true, cached:true, ...cached });

    const client = new Shopify({ shopName, accessToken: token });
    // Build Admin search query
    const esc = (s) => String(s).replace(/["\\]/g,'\\$&');
    let search, filterMode;
    if (rawGroup) {
      const mf = `metafield:${'custom'}.${'artikelgruppierung'}:"${esc(rawGroup)}"`;
      // Important: do NOT include vendor in search to avoid mismatches due to accents/whitespace; filter vendor after fetch.
      search = mf;
      filterMode = 'group';
    } else {
      search = `title:"${esc(rawTitle)}" AND vendor:"${esc(rawVendor)}"`;
      filterMode = 'title_vendor';
    }
  const q = `query($first:Int!){ products(first:$first, query:${JSON.stringify(search)}){ edges{ node{ id handle title vendor status totalInventory tags options{ name values } featuredImage{ url width height altText } images(first:2){ nodes{ url width height altText } } material: metafield(namespace:"custom", key:"material"){ value } artikel: metafield(namespace:"custom", key:"artikelgruppierung"){ value } } } pageInfo{ hasNextPage endCursor } } }`;

    let result;
    try{
      const raw = await client.graphql(q, { first: Math.min(50, limit + 16) });
      result = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if(result && result.errors) return res.status(502).json({ ok:false, error:'gql_errors', errors: result.errors });
    }catch(e){ return res.status(502).json({ ok:false, error:'proxy_failed', details: e?.message || String(e) }); }

  const edges = Array.isArray(result?.data?.products?.edges) ? result.data.products.edges : [];
  const debugMode = String(req.query.debug||'').toLowerCase() === '1' || String(req.query.debug||'').toLowerCase() === 'true';
    const wantTitle = normStr(rawTitle); const wantVendor = normStr(rawVendor); const wantGroup = normStr(rawGroup);
    const out = []; const seen = new Set();
    let dbg = debugMode ? { search, filterMode, wantGroup, wantVendor, fetched: edges.length, keptByGroup:0, keptByVendor:0, withMaterial:0, withoutVendorCount:0 } : null;
    for (const e of edges){
      const n = e?.node; if(!n) continue;
      // Unified filter implementation
      if (filterMode === 'group'){
        const groupField = n?.artikel && n.artikel.value ? String(n.artikel.value) : '';
        if (normStr(groupField) !== wantGroup) continue;
        if (dbg) dbg.keptByGroup++;
        if (rawVendor && normStr(n.vendor) !== wantVendor) continue;
        if (dbg) dbg.keptByVendor++;
      } else {
        if (normStr(n.title) !== wantTitle) continue;
        if (normStr(n.vendor) !== wantVendor) continue;
      }
      if (String(n.title||'').toLowerCase().includes('muster')) continue;
      let mat = n.material && n.material.value ? String(n.material.value).trim() : '';
      if (!mat && Array.isArray(n.options)){
        for (const o of n.options){ if(o && /material/i.test(String(o.name||'')) && Array.isArray(o.values) && o.values.length){ mat = String(o.values[0]||'').trim(); if(mat) break; } }
      }
      if (!mat && Array.isArray(n.tags)){
        const t = n.tags.find(t => /^material:/i.test(String(t||'')));
        if (t){ mat = String(t.split(':').slice(1).join(':')).trim(); }
      }
      if (!mat) continue;
      if (dbg) dbg.withMaterial++;
      const key2 = filterMode==='group' ? `${normStr(mat)}` : `${normStr(n.title)}|${normStr(mat)}`;
      if (seen.has(key2)) continue; seen.add(key2);
      const nodes = n.images && n.images.nodes ? n.images.nodes : [];
      const image2 = nodes && nodes.length>1 ? nodes[1] : (nodes[0] || null);
      out.push({ handle: n.handle, title: n.title, vendor: n.vendor, material: mat, featuredImage: n.featuredImage || null, image2 });
      if (out.length >= limit) break;
    }

    // Debug-only: if nothing found with vendor, check count without vendor filtering
    if (debugMode && out.length < 2 && rawVendor && wantGroup){
      let noVendorCount = 0; const seen2 = new Set();
      for (const e of edges){
        const n = e?.node; if(!n) continue;
        const groupField = n?.artikel && n.artikel.value ? String(n.artikel.value) : '';
        if (normStr(groupField) !== wantGroup) continue;
        if (String(n.title||'').toLowerCase().includes('muster')) continue;
        let mat = n.material && n.material.value ? String(n.material.value).trim() : '';
        if (!mat && Array.isArray(n.options)){
          for (const o of n.options){ if(o && /material/i.test(String(o.name||'')) && Array.isArray(o.values) && o.values.length){ mat = String(o.values[0]||'').trim(); if(mat) break; } }
        }
        if (!mat && Array.isArray(n.tags)){
          const t = n.tags.find(t => /^material:/i.test(String(t||'')));
          if (t){ mat = String(t.split(':').slice(1).join(':')).trim(); }
        }
        if (!mat) continue;
        const k = normStr(mat); if (seen2.has(k)) continue; seen2.add(k);
        noVendorCount++;
      }
      if (dbg) dbg.withoutVendorCount = noVendorCount;
    }

    // Sort by preference list then A–Z
    const pref = ['vlies','vinyl','textil','papier'];
    const rank = (m) => { const i = pref.indexOf(normStr(m)); return i === -1 ? 100 : i; };
    out.sort((a,b)=>{ const ra=rank(a.material), rb=rank(b.material); if(ra!==rb) return ra-rb; return String(a.material).localeCompare(String(b.material), 'de'); });

  const payload = debugMode ? { ok:true, items: out, count: out.length, debug: dbg } : { ok:true, items: out, count: out.length };
    setCachedMaterials(key, payload, 60_000);
    return res.json(payload);
  }catch(e){
    return res.status(500).json({ ok:false, error:'proxy_failed', details: e?.message || String(e) });
  }
}
// Note: Do not register another handler for '/api/materials' here to avoid conflicts with the primary implementation above.

// Resolve siblings by product handle (for collection pages)
async function handleSiblingsByHandle(req, res){
  try {
    if (limitSiblings(req, res)) return; // reuse simple rate limit
    const handle = String(req.query.handle || '').trim();
    if(!handle) return res.status(400).json({ ok:false, error:'missing_handle' });
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 12));
    const shopDomain = req.query.shop ? `${normalizeShopName(req.query.shop)}.myshopify.com` : getShopFromReq(req);
    const shopName = normalizeShopName(shopDomain);
    const token = getStoredToken(shopName) || String(process.env.SHOPIFY_ACCESS_TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
    if (!token) return res.status(401).json({ ok:false, error:'missing_admin_token' });

    // Step 1: fetch product to get its group metafield
    const client = new Shopify({ shopName, accessToken: token });
    const qProd = `query($h:String!){ productByHandle(handle:$h){ id handle title vendor status totalInventory featuredImage{ url width height altText } metafield(namespace:"custom", key:"designname"){ value } } }`;
    let raw = await client.graphql(qProd, { h: handle });
    let result = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (result && result.errors) return res.status(502).json({ ok:false, error:'gql_errors', errors: result.errors });
    const p = result?.data?.productByHandle;
    const groupVal = p?.metafield?.value ? String(p.metafield.value).trim() : '';
    if (!groupVal) {
      return res.json({ ok:true, items: [], pageInfo: { hasNextPage:false, endCursor:null }, group: null });
    }
    // Step 2: fetch siblings by group (reuse logic similar to handleSiblingsProxy)
    const escaped = groupVal.replace(/["\\]/g, '\\$&');
    const search = `metafield:${'custom'}.${'designname'}:"${escaped}"`;
  const qSibs = `query($first:Int!){ products(first:$first, query:${JSON.stringify(search)}){ edges{ node{ id handle title vendor status totalInventory featuredImage{ url width height altText } images(first:6){ nodes{ url width height altText } } metafield(namespace:"custom", key:"designname"){ value } } } pageInfo{ hasNextPage endCursor } } }`;
    let raw2 = await client.graphql(qSibs, { first: limit + 4 }); // fetch a bit more for +X calc
    let result2 = typeof raw2 === 'string' ? JSON.parse(raw2) : raw2;
    if (result2 && result2.errors) return res.status(502).json({ ok:false, error:'gql_errors', errors: result2.errors });
    const prod = result2?.data?.products || result2?.products;
    const edges = Array.isArray(prod?.edges) ? prod.edges : [];
    const items = [];
    const norm = (s) => (s||'').toString().toLowerCase();
    const want = norm(groupVal);
    for (const e of edges){
      const n = e?.node; if (!n) continue;
      if (n.handle === handle) continue; // exclude self
      const mf = n.metafield && n.metafield.value ? String(n.metafield.value) : '';
      if (norm(mf) !== want) continue;
      const available = (typeof n.totalInventory === 'number' ? n.totalInventory > 0 : true) && String(n.status || '').toUpperCase() !== 'ARCHIVED';
  items.push({ handle: n.handle, title: n.title, vendor: n.vendor, availableForSale: available, featuredImage: n.featuredImage || null, images: n.images || null });
    }
    const pageInfo = { hasNextPage: !!prod?.pageInfo?.hasNextPage, endCursor: prod?.pageInfo?.endCursor || null };
    return res.json({ ok:true, items, pageInfo, group: groupVal });
  } catch (e) {
    return res.status(500).json({ ok:false, error:'proxy_failed', details: e?.message || String(e) });
  }
}
app.get('/api/siblings/by-handle', handleSiblingsByHandle);

// Minimal HMAC validator
function validHmac(query) {
  const { hmac, ...rest } = query;
  if (!hmac) return false;
  const msg = Object.keys(rest)
    .sort()
    .map(k => `${k}=${Array.isArray(rest[k]) ? rest[k].join(',') : rest[k]}`)
    .join('&');
  const digest = crypto
    .createHmac('sha256', OAUTH.API_SECRET)
    .update(msg)
    .digest('hex');
  try {
    const a = Buffer.from(String(hmac), 'utf8');
    const b = Buffer.from(String(digest), 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
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
  const params = { limit, published_status: 'any' };
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
  const params = { limit, published_status: 'any' };
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

// --- SKU Export helpers and route ---
function normalizeShopDomain(shopInput) {
  const raw = String(shopInput || '').trim().toLowerCase();
  if (!raw) return null;
  return raw.endsWith('.myshopify.com') ? raw : `${raw}.myshopify.com`;
}

async function fetchAllProductsWithVariants(shopify) {
  const all = [];
  let since_id = undefined;
  const limit = 250;
  let pages = 0;
  while (true) {
    const params = { limit, published_status: 'any' };
    if (since_id) params.since_id = since_id;
    const products = await shopify.product.list(params);
    if (!Array.isArray(products) || products.length === 0) break;
    all.push(...products);
    since_id = products[products.length - 1]?.id;
    pages++;
    if (!since_id || products.length < limit) break;
  if (pages > 5000) break; // safety cap
  }
  return all;
}

function toCsv(rows) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = ['shop','product_id','handle','title','variant_id','sku'];
  const out = [header.join(',')];
  for (const r of rows) {
    out.push([esc(r.shop),esc(r.product_id),esc(r.handle),esc(r.title),esc(r.variant_id),esc(r.sku)].join(','));
  }
  return out.join('\r\n');
}

app.get('/debug/export-skus', async (req, res) => {
  try {
    const shopDomain = normalizeShopDomain(req.query.shop || getShopFromReq(req));
    if (!shopDomain) return res.status(400).json({ error: 'missing_shop' });
    const shopName = normalizeShopName(shopDomain);
    const shopify = new Shopify({ shopName, accessToken: getStoredToken(shopName) || (String(process.env.SHOPIFY_ACCESS_TOKEN || '').trim().replace(/^['"]|['"]$/g, '')) });
    // Validate
    try { await shopify.shop.get(); } catch (e) { return res.status(401).json({ error: 'invalid_token_or_shop', details: e?.message || String(e) }); }
    // Fetch
    const products = await fetchAllProductsWithVariants(shopify);
    const rows = [];
    for (const p of products) {
      const variants = Array.isArray(p.variants) ? p.variants : [];
      for (const v of variants) {
        const sku = (v && v.sku) ? String(v.sku).trim() : '';
        if (!sku) continue;
        rows.push({ shop: `${shopName}.myshopify.com`, product_id: p.id, handle: p.handle || '', title: p.title || '', variant_id: v.id, sku });
      }
    }
    const csv = toCsv(rows);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `skus-${shopName}-${stamp}.csv`;
    const exportsDir = req.app.get('exportsDir') || path.join(__dirname, 'exports');
    try { if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true }); } catch {}
    const filePath = path.join(exportsDir, fileName);
    fs.writeFileSync(filePath, csv, 'utf8');
    return res.json({ ok: true, shop: `${shopName}.myshopify.com`, products: products.length, variants_with_sku: rows.length, file: `/exports/${fileName}` });
  } catch (e) {
    return res.status(500).json({ error: 'export_failed', details: e?.message || String(e) });
  }
});

// List access scopes granted to the current token (helps verify permissions)
app.get('/shopify/access-scopes', async (req, res) => {
  try {
    const shopDomain = getShopFromReq(req);
    const shopName = normalizeShopName(shopDomain);
    // Prefer file token; fall back to env (sanitized)
    const tokenFilePath = resolveTokenFile(shopName);
    const fileTok = tokenFilePath ? readTokenFileFlexible(tokenFilePath) : null;
    const envTok = String(process.env.SHOPIFY_ACCESS_TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
    const token = fileTok || envTok;
    if (!token) return res.status(401).json({ error: 'missing_admin_token' });
    const url = `https://${shopName}.myshopify.com/admin/oauth/access_scopes.json`;
    const r = await fetchFn(url, { headers: { 'X-Shopify-Access-Token': token } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: 'scopes_failed', status: r.status, body });
    // body.access_scopes: [{handle:"read_products"}, ...]
    const scopes = Array.isArray(body.access_scopes) ? body.access_scopes.map(s => s.handle) : [];
    const tokenSource = fileTok ? 'file' : (envTok ? 'env' : 'none');
    const tokenSourceFilename = fileTok ? path.basename(tokenFilePath) : null;
    return res.json({ shop: `${shopName}.myshopify.com`, count: scopes.length, scopes, tokenSource, tokenSourceFilename });
  } catch (e) {
    return res.status(500).json({ error: 'scopes_error', details: e?.message || String(e) });
  }
});

// Quick product count (includes unpublished via REST count param)
app.get('/debug/products-count', async (req, res) => {
  try {
    const shopify = clientFor(req);
    // product.count supports published_status filter
    const countAny = await shopify.product.count({ published_status: 'any' });
    return res.json({ shop: getShopFromReq(req), count_any: countAny });
  } catch (e) {
    const status = e.statusCode || e.status || 500;
    return res.status(status).json({ error: 'count_failed', details: e?.message || String(e) });
  }
});

// Full product + variant SKU listing (paginated aggregation) – may be heavy for large catalogs
app.get('/debug/products-skus', async (req, res) => {
  try {
    const shopify = clientFor(req);
    const limit = Math.max(1, Math.min(250, parseInt(req.query.limit, 10) || 250));
    const maxPages = Math.max(1, Math.min(200, parseInt(req.query.maxPages, 10) || 50));
    let since_id = undefined;
    let pages = 0;
    const out = [];
    while (true) {
      const params = { limit, published_status: 'any' };
      if (since_id) params.since_id = since_id;
      const products = await shopify.product.list(params);
      if (!Array.isArray(products) || products.length === 0) break;
      for (const p of products) {
        const variants = Array.isArray(p.variants) ? p.variants.map(v => ({ id: v.id, sku: v.sku, title: v.title })) : [];
        out.push({ id: p.id, handle: p.handle, title: p.title, status: p.status, variants });
      }
      since_id = products[products.length - 1]?.id;
      pages++;
      if (!since_id || products.length < limit) break;
      if (pages >= maxPages) break;
    }
    res.json({ shop: getShopFromReq(req), pages, count: out.length, products: out });
  } catch (e) {
    const status = e.statusCode || e.status || 500;
    res.status(status).json({ error: 'list_failed', details: e?.message || String(e) });
  }
});
// NEU: detaillierte Diagnose für Health (Shop-Auswahl + Tokenquelle)
app.get('/shopify/health-diag', async (req, res) => {
  try {
    const qShop = String(req.query.shop || '');
    const chosenDomain = getShopFromReq(req);
    const chosenName = normalizeShopName(chosenDomain);
    let tokenSource = 'none';
    let tokenPreview = null;

    // Determine token source
    const fileTok = getStoredToken(chosenName);
    if (fileTok) { tokenSource = 'file'; tokenPreview = fileTok.slice(0, 8) + '...'; }
    else {
      const envTok = String(process.env.SHOPIFY_ACCESS_TOKEN || '').trim().replace(/^['"]|['"]$/g, '');
      if (envTok) { tokenSource = 'env'; tokenPreview = envTok.slice(0, 8) + '...'; }
      else if (legacyClient) tokenSource = 'legacy';
    }

    // Try to fetch basic shop info to verify token
    let shopInfo = null;
    try {
      const shopify = clientFor(req);
      const s = await shopify.shop.get({});
      shopInfo = { name: s?.name || null, domain: s?.myshopify_domain || null };
    } catch (err) {
      shopInfo = { error: err?.message || String(err) };
    }

    return res.json({
      ok: true,
      queryShop: qShop || null,
      chosenDomain,
      chosenName,
      tokenSource,
      tokenPreview,
      shop: shopInfo
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'diag_failed', details: e?.message || String(e) });
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
        const params = { limit, status: 'any', published_status: 'any' };
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
    // NEU: Nach erfolgreicher Installation ins Admin-Apps-UI umleiten (liefert host-Param automatisch)
    return res.redirect(`https://${shopName}.myshopify.com/admin/apps/${OAUTH.API_KEY}`);
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
        var shop = ${JSON.stringify(`${shopName}.myshopify.com`)};
        var disable = ${disableAB ? 'true' : 'false'};

        // NEU: Fallback – wenn kein host vorhanden (z. B. direkter Aufruf nach OAuth), ins Admin-Apps-UI springen
        if (!disable && !host && shop && apiKey) {
          try { window.top.location.href = 'https://' + shop + '/admin/apps/' + apiKey; return; } catch (e) {}
        }

        if (!disable && AppBridge && apiKey && host) {
          var app = AppBridge.createApp({ apiKey: apiKey, host: host, forceRedirect: true });
        } else if (!disable && window.createApp && apiKey && host) {
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

// Serve the Designer frontend
try {
  // Cache policy: HTML is no-store; assets are long-lived immutable
  const setDesignerCacheHeaders = (res, filePath) => {
    try {
      const ext = path.extname(filePath || '').toLowerCase();
      if (ext === '.html') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    } catch {
      res.setHeader('Cache-Control', 'no-store');
    }
  };

  // Build candidate directories in priority order:
  // 1) Explicit env path (e.g., DESIGNER_STATIC_DIR=/opt/wallpaper-app/public/designer)
  const candidates = [];
  const envDir = (process.env.DESIGNER_STATIC_DIR || '').trim();
  if (envDir && fs.existsSync(envDir)) candidates.push(envDir);
  // 2) Common default deployed path (absolute)
  const defaultDeployed = '/opt/wallpaper-app/public/designer';
  try { if (fs.existsSync(defaultDeployed)) candidates.push(defaultDeployed); } catch {}
  // 3) Backend bundled public/designer (typical for local/dev)
  const designerPublic = path.join(__dirname, 'public', 'designer');
  try { if (fs.existsSync(designerPublic)) candidates.push(designerPublic); } catch {}
  // 4) Sibling projectRoot/public/designer (alternate deploy layout)
  try {
    const altDesigner = path.join(__dirname, '..', 'public', 'designer');
    if (fs.existsSync(altDesigner)) candidates.push(altDesigner);
  } catch {}
  // 5) Built dist from frontend (dev/local)
  const designerDist = path.join(__dirname, '..', 'frontend', 'dist');
  try { if (fs.existsSync(path.join(designerDist, 'index.html'))) candidates.push(designerDist); } catch {}

  // Deduplicate while preserving order
  const seen = new Set();
  const uniqueCandidates = candidates.filter((d) => {
    if (seen.has(d)) return false; seen.add(d); return true;
  });

  // Register static middleware for each existing candidate
  if (uniqueCandidates.length === 0) {
    const fallbackDir = designerPublic;
    app.use('/designer', express.static(fallbackDir, { maxAge: 0, etag: true, setHeaders: setDesignerCacheHeaders }));
    console.log('[designer] Serving from fallback', fallbackDir);
  } else {
    console.log('[designer] Static roots (priority order):');
    for (const dir of uniqueCandidates) {
      console.log(' -', dir);
      app.use('/designer', express.static(dir, { maxAge: 0, etag: true, setHeaders: setDesignerCacheHeaders }));
    }
  }
} catch (e) {
  const fallbackDir = path.join(__dirname, 'public', 'designer');
  app.use('/designer', express.static(fallbackDir, { maxAge: 0, etag: true, setHeaders: (res, p) => {
    try { res.setHeader('Cache-Control', path.extname(p).toLowerCase() === '.html' ? 'no-store, no-cache, must-revalidate' : 'public, max-age=31536000, immutable'); } catch { res.setHeader('Cache-Control', 'no-store'); }
  }}));
  try { console.warn('[designer] Fallback static serving due to error:', e?.message || e); } catch {}
}
// Serve public assets (widget.js) at root for storefront usage
// Ensure the materials script isn't cached aggressively so editor changes show up immediately
try {
  app.get('/wpd-materials.js', (req, res) => {
    try { res.set('Cache-Control', 'no-store, no-cache, must-revalidate'); } catch {}
    return res.sendFile(path.join(__dirname, 'public', 'wpd-materials.js'));
  });
} catch(_) {}
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
// Serve export files (CSV, etc.)
try {
  const exportsDir = path.join(__dirname, 'exports');
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
  app.use('/exports', express.static(exportsDir, { maxAge: 0 }));
} catch (e) { console.warn('[exports] setup failed', e?.message || e); }

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
  // Früh prüfen, ob Multer eine Datei akzeptiert hat (fileFilter kann false liefern)
  if (!req.file) {
    return res.status(400).json({ error: 'Ungültiger oder fehlender Upload. Erlaubte Dateitypen: JPG, TIFF, EPS, SVG, PDF.' });
  }

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
  } catch {}

  console.log('[upload-filetype]', {
    originalname: req.file.originalname,
    mimetype: uploadMime,
    ext: uploadExt,
    detectedExt,
    detectedMime,
    path: uploadPath
  });

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
  // PATCH: Endung/MIME-Type im image-Objekt speichern und robuste Vektor/PDF-Erkennung
  const fileMeta = {
    url: req.file && req.file.path ? req.file.path : '',
    mimetype: req.file && req.file.mimetype ? req.file.mimetype : '',
    detectedMime: detectedMime || '',
    filename: req.file && req.file.originalname ? req.file.originalname : '',
  };
  const isVectorOrPdf = isVectorOrPdfFile({
    url: fileMeta.url,
    mimetype: fileMeta.mimetype,
    detectedMime: fileMeta.detectedMime,
    filename: fileMeta.filename
  });

  return res.json({
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
      const params = { limit, status: 'any', published_status: 'any' };
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

// Export aller Produkte/Varianten + SKUs als CSV
app.get('/debug/export-skus', async (req, res) => {
  try {
    const shopify = clientFor(req);
    const shopDomain = getShopFromReq(req);
    const limit = 250;
    let since_id = undefined; let pages = 0;
    const rows = [];
    while (true) {
      const params = { limit, published_status: 'any' };
      if (since_id) params.since_id = since_id;
      const products = await shopify.product.list(params);
      if (!Array.isArray(products) || products.length === 0) break;
      for (const p of products) {
        const variants = Array.isArray(p.variants) ? p.variants : [];
        if (!variants.length) {
          rows.push({ product_id: p.id, handle: p.handle, product_title: p.title, variant_id: '', variant_title: '', sku: '' });
        } else {
          for (const v of variants) {
            rows.push({ product_id: p.id, handle: p.handle, product_title: p.title, variant_id: v.id, variant_title: v.title, sku: v.sku || '' });
          }
        }
      }
      since_id = products[products.length - 1]?.id;
      pages++;
      if (!since_id || products.length < limit) break;
      if (pages > 200) break; // Sicherheit
    }
    const cols = ['product_id','handle','product_title','variant_id','variant_title','sku'];
    const esc = (s) => {
      const v = s == null ? '' : String(s);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v;
    };
    const csv = cols.join(',') + '\n' + rows.map(r => cols.map(c => esc(r[c])).join(',')).join('\n');
    const fileBase = `skus-${normalizeShopName(shopDomain)}-${Date.now()}.csv`;
    const filePathAbs = path.join(__dirname, 'exports', fileBase);
    fs.writeFileSync(filePathAbs, csv);
    return res.json({ shop: shopDomain, variant_rows: rows.length, file: `/exports/${fileBase}`, sample: rows.slice(0, 5) });
  } catch (e) {
    const status = e.statusCode || e.status || 500;
    return res.status(status).json({ error: 'export_failed', details: e?.message || String(e) });
  }
});

// NEU: 404-Handler für unbekannte Routen
// Material-Katalog wurde zurückgebaut (Rollback). Frühere Route /api/material-catalog entfernt.
// Falls ein alter Frontend-Build diese Route weiterhin aufruft, antworten wir mit 410 Gone statt 404
// um klar zu signalisieren, dass die Funktionalität nicht mehr existiert.
app.get('/api/material-catalog', (req, res) => {
  // Rollback stub: original route removed. If this still returns 200 somewhere, an old process is running.
  try { res.setHeader('X-WPD-Rollback', '1'); } catch (_) {}
  res.status(410).json({ error: 'removed', message: 'Material-Katalog wurde entfernt (Rollback).' });
});

// (Rollback Option A) Rücksprung-Validierung entfernt. Frühere Route /api/validate-return existiert nicht mehr.

app.use((req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// NEU: Zentrale Fehlerbehandlung
app.use((err, req, res, next) => {
  try { console.error('[unhandled]', err && err.stack || err); } catch {}
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'internal_error' });
});

// --- Server Start (nur wenn direkt gestartet) ---
// Für Tests (supertest) exportieren wir die App, ohne sofort zu lauschen.
if (require.main === module) {
  // NEU: Prozessweite Fehlerlogs
  try {
    process.on('unhandledRejection', (e) => console.error('[process] unhandledRejection', e && e.stack || e));
    process.on('uncaughtException', (e) => console.error('[process] uncaughtException', e && e.stack || e));
  } catch (_) {}

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
// Transitional: short-code to UUID PDF redirect
app.get('/codepdf/:code', (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    const id = cfg.idFromCode(code);
    if (!id) return res.status(404).type('text/plain').send('Konfiguration nicht gefunden');
    return res.redirect(302, `/config/${id}/pdf`);
  } catch (e) {
    return res.status(500).type('text/plain').send('Fehler');
  }
});

// Export der Express-App für Tests (supertest) und externe Starter
// Hinweis: Beim direkten Start (node index.js) wird oben per require.main der Server gebunden.
module.exports = app;
