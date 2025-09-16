// ...existing code...
// ...existing code...
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const http = require('http');
const https = require('https');
const app = express();
// Behind Nginx proxy, trust X-Forwarded-* to get real client IPs
app.set('trust proxy', true);
const { execFile } = require('child_process');
const pathResolve = (...p) => path.join(...p);
const sharp = require('sharp');
const crypto = require('crypto');
let PDFDocument = null;
const { buildPreviewModel } = require('./preview-core');
// Points per centimeter (1 inch = 2.54cm, 72pt per inch)
const PT_PER_CM = 72 / 2.54;
// Load PDFKit if available
try { PDFDocument = require('pdfkit'); } catch(_) {}
// Ghostscript command path (used in some health endpoints)
const ghostscriptCmd = process.env.GHOSTSCRIPT_PATH || (process.platform === 'win32' ? 'gswin64c' : 'gs');
// Lazy Puppeteer (headless Chrome) setup for screenshot capture
let _browser = null;
// Global crash diagnostics
process.on('uncaughtException', (err) => {
  try { console.error('[fatal][uncaughtException]', err && err.stack || err); } catch {}
  // Do not exit immediately to allow inspecting state; could add process.exit(1) if desired
});
process.on('unhandledRejection', (reason) => {
  try { console.error('[fatal][unhandledRejection]', reason); } catch {}
});
async function getBrowser() {
  if (_browser) return _browser;
  const puppeteer = require('puppeteer');
  _browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu',
      '--font-render-hinting=medium'
    ]
  });
  _browser.on('disconnected', ()=>{ _browser = null; });
  return _browser;
}

// ----------------------------------------------------------------------------
// Simple config persistence (disk + in-memory index)
// ----------------------------------------------------------------------------
const CONFIG_DIR = path.join(__dirname, 'configs');
try { if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true }); } catch {}

// In-memory index: code -> id
const codeIndex = new Map();

function loadExistingConfigsIntoIndex() {
  try {
    const files = fs.readdirSync(CONFIG_DIR).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(CONFIG_DIR, f), 'utf8');
        const obj = JSON.parse(raw);
        if (obj && obj.id && obj.code) codeIndex.set(String(obj.code).toUpperCase(), obj.id);
      } catch(_) {}
    }
  } catch(_) {}
}
loadExistingConfigsIntoIndex();

function randomId() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }
function randomCode() { return crypto.randomBytes(4).toString('hex').slice(0,6).toUpperCase(); }

function fileFor(id) { return path.join(CONFIG_DIR, id + '.json'); }

const cfg = {
  create(data) {
    const id = randomId();
    let code;
    // ensure unique short code
    for (let i=0;i<20;i++) { const c = randomCode(); if (!codeIndex.has(c)) { code = c; break; } }
    if (!code) code = (Date.now().toString(36)+Math.random().toString(36).slice(2,8)).slice(0,6).toUpperCase();
    const createdAt = new Date().toISOString();
    const base = Object.assign({}, data || {});
    const wall = base.wall || {};
    const print = base.print || {};
    // derive area if missing (print size preferred)
    if (!base.areaM2) {
      const w = Number(print.widthCm || wall.widthCm || 0); const h = Number(print.heightCm || wall.heightCm || 0);
      if (w>0 && h>0) base.areaM2 = Number(((w/100)*(h/100)).toFixed(3));
    }
    const rec = { id, code, createdAt, status: 'draft', ...base };
    try { fs.writeFileSync(fileFor(id), JSON.stringify(rec, null, 2)); } catch(e) { /* ignore */ }
    codeIndex.set(code.toUpperCase(), id);
    return rec;
  },
  readConfig(id) {
    try { const raw = fs.readFileSync(fileFor(id), 'utf8'); return JSON.parse(raw); } catch { throw new Error('not_found'); }
  },
  updateConfig(id, patch) {
    const cur = this.readConfig(id);
    const next = { ...cur, ...patch, id: cur.id, code: cur.code };
    try { fs.writeFileSync(fileFor(id), JSON.stringify(next, null, 2)); } catch {}
    return next;
  },
  shortCodeFrom(id) {
    try { const c = this.readConfig(id).code; return c; } catch { return 'UNBEKANNT'; }
  },
  idFromCode(code) {
    if (!code) return null; const id = codeIndex.get(String(code).toUpperCase()); return id || null;
  },
  verifyToken(token) { return { ok: false }; }, // placeholder (no signed tokens yet)
};

function baseAppUrl(req) {
  return (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}
function detailUrlFor(id, req) { return `${baseAppUrl(req)}/config/${id}`; }
function pdfUrlFor(id, req) { return `${baseAppUrl(req)}/config/${id}/pdf`; }
// JSON body parser middleware (was missing -> caused ReferenceError)
const parseJsonBody = express.json({ limit: '2mb' });
// Define ImageMagick command path (used later in logging and endpoints)
const magickCmd = process.env.IMAGEMAGICK_PATH || (process.platform === 'win32' ? 'C:/Program Files/ImageMagick-7.1.2-Q16-HDRI/magick.exe' : 'magick');
app.post('/config/:id/confirm', parseJsonBody, (req, res) => {
  try {
    const id = String(req.params.id || '');
  const existing = cfg.readConfig(id);
  const update = { status: 'confirmed', priceLockedAt: new Date().toISOString(), detailUrl: detailUrlFor(id, req), pdfUrl: pdfUrlFor(id, req) };
    const next = cfg.updateConfig(id, update);
  res.json({ configId: id, detailUrl: next.detailUrl, pdfUrl: next.pdfUrl });
  } catch (e) {
    res.status(404).json({ error: 'Konfiguration nicht gefunden' });
  }
});

// ---------------------------------------------------------------------------
// Minimal Fallback Designer (HTML) so /pdf-shot works auch ohne Frontend-Build
// URL: /designer?code=ABC123 oder /designer?code=<id>
// Provides #preview element (selector candidates in pdf-shot) with optional image.
// ---------------------------------------------------------------------------
app.get('/designer', (req, res) => {
  try {
    const codeParam = String(req.query.code || '').trim();
    if (!codeParam) return res.status(400).send('<!DOCTYPE html><html><body>Missing code</body></html>');
    let id = cfg.idFromCode(codeParam);
    if (!id) id = codeParam; // maybe direct id
    let data; try { data = cfg.readConfig(id); } catch { /* ignore */ }
    if (!data) return res.status(404).send('<!DOCTYPE html><html><body>Konfiguration nicht gefunden</body></html>');
    const imgUrl = data?.image?.url || '';
    const wallW = Number(data?.wall?.widthCm || data?.print?.widthCm || 0);
    const wallH = Number(data?.wall?.heightCm || data?.print?.heightCm || 0);
    // Simple aspect box (max 1000x700) maintaining wall ratio if present
    let boxW = 1000, boxH = 700;
    if (wallW > 0 && wallH > 0) {
      const ratio = wallW / wallH;
      const maxW = 1000, maxH = 700;
      if (ratio >= (maxW / maxH)) { boxW = maxW; boxH = Math.round(maxW / ratio); } else { boxH = maxH; boxW = Math.round(maxH * ratio); }
    }
    const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8" />
<title>Designer Fallback</title>
<style>
html,body { margin:0; padding:0; background:#f5f5f5; font:14px system-ui,sans-serif; color:#222; }
#wrap { padding:20px; }
#preview { position:relative; width:${boxW}px; height:${boxH}px; box-shadow:0 0 0 2px #444 inset; background:#111; display:flex; align-items:center; justify-content:center; overflow:hidden; }
#preview img { max-width:100%; max-height:100%; object-fit:contain; image-rendering:auto; }
#meta { margin-top:12px; font-size:12px; color:#555; }
</style></head><body>
<div id="wrap">
  <h1 style="margin:0 0 10px;font-size:18px;">Fallback Designer</h1>
  <div id="preview" data-preview>
    ${imgUrl ? `<img src="${imgUrl}" alt="preview" />` : '<span style="color:#eee;font-size:24px;">Kein Bild</span>'}
  </div>
  <div id="meta">Code: ${data.code} | ID: ${data.id} | Wand: ${wallW}cm × ${wallH}cm</div>
</div>
</body></html>`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    return res.send(html);
  } catch (e) {
    return res.status(500).send('<!DOCTYPE html><html><body>Fehler</body></html>');
  }
});

// ---------------------------------------------------------------------------
// New lightweight preview route used for stable screenshot rendering
// /preview?code=ABC123 (prefers short code, falls back to id)
// Provides: #preview-root (primary selector) and [data-preview]
// Sets window.__PREVIEW_READY = true when DOM is ready.
// ---------------------------------------------------------------------------
app.get('/preview', async (req, res) => {
  try {
    const codeParam = String(req.query.code || '').trim();
    if (!codeParam) return res.status(400).send('Missing code');
    let id = cfg.idFromCode(codeParam);
    if (!id) id = codeParam;
    let data; try { data = cfg.readConfig(id); } catch { /* ignore */ }
    if (!data) return res.status(404).send('Konfiguration nicht gefunden');
    const model = buildPreviewModel(data);
    // Optional inline image (?inline=1) to avoid remote load timing issues in headless capture
    let imageUrl = model.imageUrl;
    if (imageUrl && String(req.query.inline||'') === '1') {
      try {
        const fetchUrl = imageUrl;
        const lib = /^https:/i.test(fetchUrl) ? https : http;
        const buf = [];
        await new Promise((resolve, reject) => {
          const reqImg = lib.get(fetchUrl, r => {
            if (r.statusCode && r.statusCode >= 400) { reject(new Error('img_status_'+r.statusCode)); return; }
            r.on('data', d=> buf.push(d));
            r.on('end', resolve);
          });
          reqImg.on('error', reject);
          reqImg.setTimeout(8000, () => { try { reqImg.destroy(); } catch {}; reject(new Error('img_timeout')); });
        });
        const imgBuffer = Buffer.concat(buf);
        if (imgBuffer.length < 6_000_000) { // 6MB guard
          const b64 = imgBuffer.toString('base64');
            // naive mime guess
          const mime = /^\x89PNG/.test(imgBuffer.slice(0,8).toString('latin1')) ? 'image/png' : 'image/jpeg';
          imageUrl = `data:${mime};base64,${b64}`;
        }
      } catch (e) {
        // ignore inline failures, keep original URL
      }
    }
    if (imageUrl !== model.imageUrl) model.imageUrl = imageUrl;
    const json = JSON.stringify({ model, code: data.code, id: data.id });
    const html = `<!DOCTYPE html><html lang="de"><head><meta charset='utf-8'/><title>Preview ${data.code}</title>
<style>
html,body {margin:0;padding:0;background:#fff;font:12px system-ui,sans-serif;color:#222;}
#preview-root {position:relative;margin:0 auto;padding:0;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #222 inset;background:#111;width:${model.stage.width}px;height:${model.stage.height}px;}
#preview-root img {max-width:100%;max-height:100%;object-fit:contain;image-rendering:auto;}
#meta {text-align:center;margin:8px 0 0;font-size:11px;color:#555;}
</style>
</head><body>
<div id="preview-root" data-preview>${model.imageUrl ? `<img src='${model.imageUrl}' alt='preview'/>` : '<span style=\"color:#eee;font-size:22px;\">Kein Bild</span>'}</div>
<div id="meta">Code: ${data.code} | ID: ${data.id} | Ratio: ${model.aspect.toFixed(3)}</div>
<script>window.__PREVIEW_DATA__=${json};window.__PREVIEW_READY=true;</script>
</body></html>`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    return res.send(html);
  } catch (e) {
    return res.status(500).send('Fehler');
  }
});
// Create a new configuration
app.post('/config', parseJsonBody, (req, res) => {
  try {
    const body = req.body || {};
    const rec = cfg.create(body);
    res.json({ configId: rec.id, code: rec.code, detailUrl: detailUrlFor(rec.id, req), pdfUrl: pdfUrlFor(rec.id, req) });
  } catch (e) {
    res.status(500).json({ error: 'create_failed' });
  }
});

// Lookup config by short code
app.get('/config/by-code/:code', (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    if (!code) return res.status(400).json({ error: 'missing_code' });
    const id = cfg.idFromCode(code);
    if (!id) return res.status(404).json({ error: 'not_found' });
    const rec = cfg.readConfig(id);
    res.json({ configId: rec.id, code: rec.code, detailUrl: detailUrlFor(rec.id, req), pdfUrl: pdfUrlFor(rec.id, req) });
  } catch (e) {
    res.status(404).json({ error: 'not_found' });
  }
});
// Public detail (basic JSON for now; UI can be added later)
app.get('/config/:id', (req, res) => {
  try {
    const id = String(req.params.id || '');
    const as = String(req.query.as || '').toLowerCase();
    // Optional token check (if present)
    const t = req.query.t;
    if (t) {
      const v = cfg.verifyToken(String(t));
      if (!v.ok || v.id !== id) return res.status(403).send('Link abgelaufen oder ungültig');
    }
    const data = cfg.readConfig(id);
    if (as === 'json') {
  return res.json({ config: data, pdfUrl: pdfUrlFor(id, req) });
    }
  const title = `Konfiguration ${cfg.shortCodeFrom(id)}`;
    const priceLine = (data.price && data.price.total != null) ? `CHF ${Number(data.price.total).toFixed(2)}` : 'n/a';
    const wall = data.wall || {};
    const print = data.print || {};
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
      <style>
        body{font-family: system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; padding:24px; line-height:1.4; color:#222}
        h1{font-size:20px;margin:0 0 12px}
        table{border-collapse:collapse}
        td{padding:6px 10px;border-bottom:1px solid #eee}
        .muted{color:#666}
        .cta{display:inline-block;margin-top:14px;padding:10px 14px;border:1px solid #e6e6e6;background:#F4F2EC;color:#222;text-decoration:none}
      </style></head><body>
      <h1>${title}</h1>
      <div class="muted">Erstellt am ${new Date(data.createdAt || Date.now()).toLocaleString('de-CH')}</div>
      <table style="margin-top:16px">
        <tr><td><b>Wandmass</b></td><td>${Number(wall.widthCm||0)} × ${Number(wall.heightCm||0)} cm</td></tr>
        <tr><td><b>Druckmass</b></td><td>${Number(print.widthCm||0)} × ${Number(print.heightCm||0)} cm</td></tr>
        <tr><td><b>Fläche</b></td><td>${Number(data.areaM2||0).toFixed(3)} m²</td></tr>
        <tr><td><b>Preis</b></td><td>${priceLine}</td></tr>
      </table>
      <div style="margin-top:12px">
  <a class="cta" href="${pdfUrlFor(id, req)}">PDF herunterladen</a>
      </div>
      </body></html>`;
    res.setHeader('Cache-Control','private, max-age=60');
    res.type('html').send(html);
  } catch (e) {
    res.status(404).type('text/plain').send('Nicht gefunden');
  }
});

// PDF stub: returns a minimal placeholder PDF for now
app.get('/config/:id/pdf', async (req, res) => {
  // Helper to fetch remote image as Buffer (supports http/https)
  function fetchBuffer(url, { timeoutMs = 8000 } = {}) {
    return new Promise((resolve, reject) => {
      try {
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, (resp) => {
          if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
            // simple redirect follow (1 hop)
            return fetchBuffer(resp.headers.location, { timeoutMs }).then(resolve, reject);
          }
          if (resp.statusCode !== 200) {
            return reject(new Error(`http_status_${resp.statusCode}`));
          }
          const chunks = [];
          resp.on('data', (c) => chunks.push(c));
          resp.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => { try { req.destroy(new Error('timeout')); } catch {} });
      } catch (e) { reject(e); }
    });
  }

  try {
    const id = String(req.params.id || '');
    // Optional token check
    const t = req.query.t;
    if (t) {
      const v = cfg.verifyToken(String(t));
      if (!v.ok || v.id !== id) return res.status(403).type('text/plain').send('Link abgelaufen oder ungültig');
    }
    const data = cfg.readConfig(id);
    const code = cfg.shortCodeFrom(id);
    // Fallback if PDFKit not available: return minimal PDF like before
    if (!PDFDocument) {
  const detail = detailUrlFor(id, req);
      const instruction = `Diese Konfiguration kann jederzeit mit dem Code ${code} wieder aufgerufen werden. Öffnen Sie den Konfigurator im Shop und geben Sie den Code im Feld "Code einfügen" ein.`;
      const content = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<<>> >>endobj\n4 0 obj<</Length 240>>stream\nBT /F1 18 Tf 72 780 Td (Konfiguration ${code}) Tj T* 0 -24 Td (${instruction}) Tj T* 0 -24 Td (Detail: ${detail}) Tj ET\nendstream endobj\nxref\n0 5\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \n0000000116 00000 n \n0000000260 00000 n \ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n370\n%%EOF`;
      const asAttachment = String(req.query.download || '0') === '1';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${asAttachment ? 'attachment' : 'inline'}; filename="${code}.pdf"`);
      return res.send(Buffer.from(content, 'utf8'));
    }

    // Setup PDF: A4 landscape
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    const asAttachment = String(req.query.download || '0') === '1';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${asAttachment ? 'attachment' : 'inline'}; filename="${code}.pdf"`);
    doc.pipe(res);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = doc.page.margins.left; // uniform

  // Title, centered product title (does not affect flow), logo, then code directly under title
  const titleText = 'Gut zum Druck';
  const titleFontSize = 20;
  doc.fontSize(titleFontSize).fillColor('#000').text(titleText, { align: 'left' });
  const titleTopY = doc.y - doc.currentLineHeight();
  const afterTitleY = doc.y; // store original flow position
  let productTitle = null;
  try {
    const ctx = data.context || {};
    productTitle = ctx.productTitle || ctx.product || ctx.name || null;
  } catch(_) {}
  if (!productTitle) {
    try {
      const imgUrl0 = (data.image && data.image.url) ? String(data.image.url) : '';
      if (imgUrl0) {
        const fname = imgUrl0.split(/[?#]/)[0].split('/').pop();
        if (fname) productTitle = fname;
      }
    } catch(_) {}
  }
  if (!productTitle) productTitle = 'Ohne Titel';
  // Center product title across usable width (between margins)
  doc.fontSize(14).fillColor('#222').text(productTitle, margin, titleTopY, { width: pageWidth - margin * 2, align: 'center' });
  // Restore y so code remains directly under main title line
  doc.y = afterTitleY;
  const logoH = 70;
  const logoX = pageWidth - 36 - 100;
  const logoY = Math.max(margin - 4, titleTopY - 20);
  // Logo
  try {
    const logoPath = 'C:/Users/Public/shopify-wallpaper-designer/Wirz_mit_Claim_Pixel_RGB.jpg';
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, logoX, logoY, { height: logoH });
    }
  } catch(_) {}
  // Code line
  const green = '#138136';
  doc.moveDown(0.2);
  doc.fontSize(12).fillColor(green).text(`Code: ${code}`);
  const afterCodeY = doc.y;
  doc.y = afterCodeY + 4;

    // NEW IMAGE BLOCK per spec: block at (40,120) max 800x500, frame centered, image cover fit, labels outside
    const wall = data.wall || {};
    const print = data.print || {};
    const baseUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const imageUrlRaw = (data.image && data.image.url) ? String(data.image.url) : '';
    let resolvedImageUrl = null;
    if (imageUrlRaw) {
      if (/^https?:\/\//i.test(imageUrlRaw)) resolvedImageUrl = imageUrlRaw; else if (imageUrlRaw.startsWith('/')) resolvedImageUrl = `${baseUrl}${imageUrlRaw}`; else resolvedImageUrl = `${baseUrl}/${imageUrlRaw}`;
    }
    const image = resolvedImageUrl ? { url: resolvedImageUrl } : null;
    const transform = data.transform || {};
  // Adjusted block size per new request: 750 x 500 pt and moved 100pt higher (Y 120 -> 20)
  const blockX = 40, blockY = 20, blockMaxW = 750, blockMaxH = 500;
  const wallWcm = Number(wall.widthCm || print.widthCm || 0) || 0;
  const wallHcm = Number(wall.heightCm || print.heightCm || 0) || 0;
  const printWcm = Number(print.widthCm || wall.widthCm || 0) || 0;
  const printHcm = Number(print.heightCm || wall.heightCm || 0) || 0;
    const wallWptRaw = wallWcm * PT_PER_CM;
    const wallHptRaw = wallHcm * PT_PER_CM;
    let frameScale = 1;
    if (wallWptRaw > 0 && wallHptRaw > 0) frameScale = Math.min(blockMaxW / wallWptRaw, blockMaxH / wallHptRaw);
    const frameW = wallWptRaw > 0 ? Math.max(20, Math.round(wallWptRaw * frameScale)) : blockMaxW;
    const frameH = wallHptRaw > 0 ? Math.max(20, Math.round(wallHptRaw * frameScale)) : blockMaxH;
    const frameX = blockX + Math.round((blockMaxW - frameW) / 2);
    const frameY = blockY + Math.round((blockMaxH - frameH) / 2);
    // Draw image (cover)
    let drewImage = false;
    if (image && image.url) {
      try {
        const imgBuf = await fetchBuffer(image.url);
        const meta = await sharp(imgBuf).metadata();
        const iw = Math.max(1, meta.width || 1);
        const ih = Math.max(1, meta.height || 1);
        const zoom = Number(transform.zoom || 1) || 1;
        const flipH = !!transform.flipH;
        const flipV = !!transform.flipV;
        const cover = Math.max(frameW / iw, frameH / ih) * zoom;
        const drawW = iw * cover;
        const drawH = ih * cover;
        const imgX = frameX + (frameW - drawW) / 2;
        const imgY = frameY + (frameH - drawH) / 2;
        // draw
        doc.save();
        doc.rect(frameX, frameY, frameW, frameH).clip();
        if (flipH || flipV) {
          doc.save();
          doc.translate(imgX + (flipH ? drawW : 0), imgY + (flipV ? drawH : 0)).scale(flipH ? -1 : 1, flipV ? -1 : 1);
          doc.image(imgBuf, 0, 0, { width: drawW, height: drawH });
          doc.restore();
        } else {
          doc.image(imgBuf, imgX, imgY, { width: drawW, height: drawH });
        }
        doc.restore();
        drewImage = true;
      } catch(_) {}
    }
  // Outer frame (wall size) now red for visibility
  doc.lineWidth(1).strokeColor('#c00').rect(frameX, frameY, frameW, frameH).stroke();
    // Inner print frame (if print dimensions differ and are >0). Use same scale (frameScale) derived from wall.
    if (printWcm > 0 && printHcm > 0 && (printWcm !== wallWcm || printHcm !== wallHcm) && wallWptRaw > 0 && wallHptRaw > 0) {
      const printWptRaw = printWcm * PT_PER_CM;
      const printHptRaw = printHcm * PT_PER_CM;
      const printFrameW = Math.max(4, Math.round(printWptRaw * frameScale));
      const printFrameH = Math.max(4, Math.round(printHptRaw * frameScale));
      const printFrameX = frameX + (frameW - printFrameW) / 2;
      const printFrameY = frameY + (frameH - printFrameH) / 2;
      doc.save();
      doc.lineWidth(0.5).dash(4, { space: 3 }).strokeColor('#555').rect(printFrameX, printFrameY, printFrameW, printFrameH).stroke();
      doc.restore();
    }

  // Labels layout:
  // Above block: Wandmass Breite (closest) then darüber Druckmass Breite; both single line
    doc.fontSize(10);
    const lineHLabel = doc.currentLineHeight();
    if (wallWcm > 0) {
      const wandTxt = `Wandmass Breite: ${wallWcm} cm`;
      const tw = doc.widthOfString(wandTxt) + 10;
      const tx = frameX + (frameW - tw) / 2;
      const ty = frameY - 2 - lineHLabel; // 2pt gap
      doc.save();
      doc.rect(tx, ty - 2, tw, lineHLabel + 4).fill('#FFFFFF');
      doc.fillColor('#000').text(wandTxt, tx + 5, ty, { width: tw - 10, align: 'center' });
      doc.restore();
      if (printWcm > 0) {
        const druckTxt = `Druckmass Breite: ${printWcm} cm`;
        const tw2 = doc.widthOfString(druckTxt) + 10;
        const tx2 = frameX + (frameW - tw2) / 2;
        const ty2 = ty - 2 - lineHLabel; // another 2pt gap above previous line
        doc.save();
        doc.rect(tx2, ty2 - 2, tw2, lineHLabel + 4).fill('#FFFFFF');
        doc.fillColor('#000').text(druckTxt, tx2 + 5, ty2, { width: tw2 - 10, align: 'center' });
        doc.restore();
      }
    }
    // Left vertical: both heights (first Druckmass Höhe near frame, then Wandmass Höhe further left). Remove previous incorrect layout.
    const drawVerticalHeightLabel = (label, order) => {
      if (!label) return;
      doc.save();
      doc.fontSize(10).fillColor('#000');
      const tw = doc.widthOfString(label) + 8;
      const th = doc.currentLineHeight();
      const gapFromFrame = 2 + order * (th + 10); // stack further to the left per order
      // Translate to left center outside with rotation -90
      doc.translate(frameX - gapFromFrame - th - 4, frameY + frameH / 2).rotate(-90);
      const bgW = th + 4; // thickness after rotation
      const bgH = tw + 4; // length after rotation
      const rx = -bgW / 2;
      const ry = -bgH / 2;
      doc.rect(rx, ry, bgW, bgH).fill('#FFFFFF');
      doc.fillColor('#000').text(label, rx + 2, ry + 2, { width: bgW - 4, align: 'center' });
      doc.restore();
    };
    if (printHcm > 0) drawVerticalHeightLabel(`Druckmass Höhe: ${printHcm} cm`, 0);
    if (wallHcm > 0) drawVerticalHeightLabel(`Wandmass Höhe: ${wallHcm} cm`, 1);

  // Position tables as far down as possible (push near footer, leaving disclaimer space)
  const disclaimerText = 'Der Besteller ist für die Masse, das Layout und den Ausschnitt verantwortlich und bestätigt dies ausdrücklich durch das Einreichen dieses Gut zum Druck (Code im Warenkorb/Bestellbestätigung). Der Auftrag wird direkt an die Produktion übermittelt und kann nicht mehr geändert werden.';
  doc.fontSize(10);
  const disclaimerHeight = doc.heightOfString(disclaimerText, { width: pageWidth - margin * 2 });
  const lineH = 18; // used in table drawing
  const leftRowsCount = 3; // updated counts (Masse merged)
  const rightRowsCount = 3;
  const tableTitleH = 18; // one line each table title
  const estLeftTableH = tableTitleH + leftRowsCount * lineH + 6;
  const estRightTableH = tableTitleH + rightRowsCount * lineH + 6;
  const tablesH = Math.max(estLeftTableH, estRightTableH);
  const gapAboveDisclaimer = 18;
  const belowY = pageHeight - margin - disclaimerHeight - gapAboveDisclaimer - tablesH;
  doc.y = belowY;

    // Two-column info blocks: measurements (left) and price (right)
  // Table drawing helper (kept)
  const colGap = 32;
  const desiredColW = 170;
  const colW = desiredColW;
    function drawTable(x, y, title, rows) {
      const lineH = 18;
      const startY = y;
      doc.fontSize(12).fillColor('#000').text(title, x, y);
      y += lineH;
      doc.fontSize(10).fillColor('#333');
      for (const [label, value] of rows) {
        doc.text(label, x, y, { width: colW * 0.5 });
        doc.text(String(value ?? ''), x + colW * 0.5 + 8, y, { width: colW * 0.5 - 8, align: 'right' });
        y += lineH;
        doc.moveTo(x, y - 4).lineTo(x + colW, y - 4).strokeColor('#eee').lineWidth(1).stroke();
      }
      return { x, y, height: y - startY };
    }

    const widthCm = Math.round(Number(wall.widthCm) || 0);
    const heightCm = Math.round(Number(wall.heightCm) || 0);
    const printW = Math.round(Number(print.widthCm) || widthCm);
    const printH = Math.round(Number(print.heightCm) || heightCm);
    const areaM2 = Number(data.areaM2 || ((printW / 100) * (printH / 100))).toFixed(3);

    const pricePerM2 = (data.price && data.price.perM2 != null) ? Number(data.price.perM2) : null;
    const totalPrice = (data.price && data.price.total != null)
      ? Number(data.price.total)
      : (pricePerM2 != null ? Number((pricePerM2 * Number(areaM2)).toFixed(2)) : null);

    const zoomFactor = Number(transform.zoom || 1) || 1;
    const leftRows = [
      ['Wandmass (B x H)', `${widthCm} x ${heightCm} cm`],
      ['Druckmass (B x H)', `${printW} x ${printH} cm`],
      ['Zoom', `${zoomFactor.toFixed(2)}x`],
    ];
    const rightRows = [
      ['Total Fläche', `${areaM2} m²`],
      ['Preis pro m²', pricePerM2 != null ? `CHF ${Number(pricePerM2).toFixed(2)}` : '–'],
      ['Gesamtpreis', totalPrice != null ? `CHF ${Number(totalPrice).toFixed(2)}` : '–'],
    ];
    // Three-column centering: Masse | Preisrechner | Instruction text
    const instrDesiredW = 260;
    const thirdGap = colGap; // use same gap
    let instrColW = instrDesiredW;
    let groupWidth = colW + colGap + colW + thirdGap + instrColW;
    if (groupWidth > pageWidth - margin * 2) {
      instrColW = Math.max(140, (pageWidth - margin * 2) - (colW + colGap + colW + thirdGap));
      groupWidth = colW + colGap + colW + thirdGap + instrColW;
    }
    const groupStartX = Math.round((pageWidth - groupWidth) / 2);
    const col1X = groupStartX;
    const col2X = col1X + colW + colGap;
    const instrX = col2X + colW + thirdGap;
    // Draw tables now at computed positions
    const leftTbl = drawTable(col1X, belowY, 'Masse', leftRows);
    const rightTbl = drawTable(col2X, belowY, 'Preisrechner', rightRows);
    // Instruction text aligned with first data row (Total Fläche)
    const totalFlaecheRowY = belowY + 18; // one line below title (lineH=18)
    const instrText = `Diese Konfiguration kann jederzeit mit dem Code ${code} wieder aufgerufen werden.`;
    doc.fontSize(10).fillColor(green).text(instrText, instrX, totalFlaecheRowY, { width: instrColW, align: 'left' });

  // Footer disclaimer (red) at bottom
  const disclaimer = disclaimerText; // same text, already measured
  const footerY = pageHeight - margin - disclaimerHeight; // bottom aligned
  doc.fontSize(10).fillColor('#c00').text(disclaimer, margin, footerY, { width: pageWidth - margin * 2, align: 'left' });

    doc.end();
  } catch (e) {
    console.error('[pdf] failed:', e?.message || e);
    res.status(500).type('text/plain').send('PDF konnte nicht erstellt werden');
  }
});

// Screenshot-based PDF (variant 1) – captures the designer area via headless Chrome
app.get('/config/:id/pdf-shot', async (req, res) => {
  const debugMode = ['1','true','yes','on'].includes(String(req.query.debug||'').toLowerCase());
  const diagnostics = { ok: false, stage: 'start', events: [], code: null, viewerUrl: null, clip: null, error: null };
  function logEvent(evt) { diagnostics.events.push({ t: Date.now(), ...evt }); }
  try {
    if (!PDFDocument) {
      diagnostics.stage = 'init_fail';
      diagnostics.error = 'PDFKit missing';
      if (debugMode) return res.status(500).json(diagnostics);
      return res.status(500).type('text/plain').send('PDFKit fehlt');
    }
    const rawParam = String(req.params.id || '');
    let resolvedId = rawParam;
    let data, code;
    try {
      data = cfg.readConfig(resolvedId);
      code = cfg.shortCodeFrom(resolvedId);
    } catch (e) {
      // Maybe the user passed a short code instead of UUID
      const asId = cfg.idFromCode(rawParam);
      if (asId) {
        resolvedId = asId;
        try { data = cfg.readConfig(resolvedId); code = cfg.shortCodeFrom(resolvedId); } catch {}
      }
    }
    if (!data || !code) {
      diagnostics.error = 'config_not_found';
      diagnostics.input = rawParam;
      diagnostics.stage = 'config_not_found';
      if (debugMode) return res.status(404).json(diagnostics);
      return res.status(404).type('text/plain').send('Konfiguration nicht gefunden');
    }
    diagnostics.code = code;
    // Build frontend base – if a FRONTEND_URL is provided prefer that (different dev port scenario)
    const forcePreview = String(req.query.usePreview||'').toLowerCase() === '1';
    const frontendBase = (process.env.FRONTEND_URL && !forcePreview) ? process.env.FRONTEND_URL.replace(/\/$/,'') : null;
    let viewerUrl;
    if (frontendBase) {
      viewerUrl = `${frontendBase}/designer?code=${encodeURIComponent(code)}&embed=1`;
    } else {
      const baseLocal = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
      viewerUrl = `${baseLocal}/preview?code=${encodeURIComponent(code)}`;
    }
    diagnostics.viewerUrl = viewerUrl;
    logEvent({ stage: 'browser_start' });
    const browser = await getBrowser();
    const page = await browser.newPage();
    const wantProfile = String(req.query.profile || '').toLowerCase();
    // High-DPI JPEG profile: dpr=2, format=jpeg, quality=90
    if (wantProfile === 'hi' || wantProfile === 'high') {
      if (typeof req.query.dpr === 'undefined') req.query.dpr = '2';
      if (typeof req.query.format === 'undefined') req.query.format = 'jpeg';
      if (typeof req.query.quality === 'undefined') req.query.quality = '90';
    }
    const dpr = Math.min(4, Math.max(1, Number(req.query.dpr || req.query.dpi || 2)));
    await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: dpr });
    logEvent({ stage: 'goto', url: viewerUrl });
    let navResp;
    try {
      navResp = await page.goto(viewerUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      diagnostics.navStatus = navResp ? navResp.status() : null;
    } catch (navErr) {
      diagnostics.navError = navErr?.message || String(navErr);
      diagnostics.stage = 'nav_error';
      throw navErr;
    }
    // Optional cleanup of UI noise
    if (String(req.query.plain || '') === '1') {
      try { await page.evaluate(() => { const els = document.querySelectorAll('[data-hide-in-pdf]'); els.forEach(e=> e.remove()); }); logEvent({ stage: 'plain_cleanup' }); } catch (e) { logEvent({ stage: 'plain_cleanup_fail', error: e.message }); }
    }
    diagnostics.stage = 'selector_search';
    const overrideSel = String(req.query.sel || '').trim();
  const selectorCandidates = overrideSel ? [overrideSel] : ['#preview-root','#preview','#viewer','[data-preview]','canvas.preview','div.preview-wrapper'];
    diagnostics.selectors = selectorCandidates;
    let clip = null;
    // Wait for preview readiness flag if provided by /preview route
    try {
      await page.waitForFunction('window.__PREVIEW_READY === true', { timeout: 5000 });
      logEvent({ stage: 'preview_ready_flag' });
    } catch (e) {
      logEvent({ stage: 'preview_ready_timeout' });
    }
    for (const sel of selectorCandidates) {
      try {
        await page.waitForSelector(sel, { timeout: 5000 });
        const handle = await page.$(sel);
        if (handle) {
          const box = await handle.boundingBox();
          if (box && box.width > 50 && box.height > 50) { clip = box; logEvent({ stage: 'selector_ok', sel, box }); break; }
          else logEvent({ stage: 'selector_too_small', sel, box });
        } else {
          logEvent({ stage: 'selector_handle_missing', sel });
        }
      } catch(errSel) {
        logEvent({ stage: 'selector_fail', sel, error: errSel.message });
      }
    }
    // Ensure main image (if any) finished loading before capture
    try {
      const imgWaitMs = Math.min(20000, Math.max(500, Number(req.query.waitImg || 8000)));
      await page.waitForFunction((selList) => {
        const img = document.querySelector('#preview-root img, #preview img, [data-preview] img');
        if (!img) return 'none';
        if (img.complete && img.naturalWidth > 0) return 'ready';
        return false;
      }, { timeout: imgWaitMs });
      const state = await page.evaluate(() => {
        const img = document.querySelector('#preview-root img, #preview img, [data-preview] img');
        if (!img) return 'none';
        return (img.complete && img.naturalWidth>0) ? 'ready' : 'pending';
      });
      if (state === 'ready') logEvent({ stage: 'image_ready' }); else if (state === 'none') logEvent({ stage: 'image_none' }); else logEvent({ stage: 'image_pending_after_wait' });
    } catch (e) {
      logEvent({ stage: 'image_wait_timeout' });
    }
    if (!clip) { clip = { x: 0, y: 0, width: 1400, height: 900 }; logEvent({ stage: 'fallback_fullpage' }); }
    // Padding
    const pad = 4;
    clip = { x: Math.max(0, clip.x - pad), y: Math.max(0, clip.y - pad), width: Math.min(1400 - clip.x + pad, clip.width + pad*2), height: Math.min(900 - clip.y + pad, clip.height + pad*2) };
    diagnostics.clip = clip;
    const fmt = /jpe?g/i.test(String(req.query.format||'')) ? 'jpeg' : (/png/i.test(String(req.query.format||'')) ? 'png' : 'jpeg');
    const quality = fmt === 'jpeg' ? Math.min(100, Math.max(30, Number(req.query.quality || 90))) : undefined;
    diagnostics.format = fmt; diagnostics.quality = quality; diagnostics.dpr = dpr;
    logEvent({ stage: 'screenshot' });
    const shot = await page.screenshot({ type: fmt, clip, quality });
    await page.close();
    diagnostics.stage = 'shot_captured';
    // Get meta
    let meta = {}; try { meta = await sharp(shot).metadata(); } catch(e) { meta.error = e.message; }
    diagnostics.image = { bytes: shot.length, width: meta.width, height: meta.height, format: meta.format };
    if (debugMode) {
      diagnostics.ok = true;
      return res.status(200).json(diagnostics);
    }
    // Build PDF
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    const asAttachment = String(req.query.download || '0') === '1';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${asAttachment ? 'attachment' : 'inline'}; filename="${code}-shot.pdf"`);
    doc.pipe(res);
    doc.fontSize(20).fillColor('#000').text('Gut zum Druck', { align: 'left' });
    doc.fontSize(12).fillColor('#138136').text(`Code: ${code}`);
    doc.moveDown(0.5);
    const areaX = 40, areaY = 100; const maxW = 750, maxH = 500;
    const iw = meta.width || 1, ih = meta.height || 1;
    const scale = Math.min(maxW / iw, maxH / ih, 1);
    const drawW = Math.round(iw * scale); const drawH = Math.round(ih * scale);
    const dx = areaX + (maxW - drawW) / 2; const dy = areaY + (maxH - drawH) / 2;
    doc.image(shot, dx, dy, { width: drawW, height: drawH });
    doc.lineWidth(0.5).strokeColor('#000').rect(areaX, areaY, maxW, maxH).stroke();
    doc.end();
  } catch (e) {
    diagnostics.error = e?.message || String(e);
    console.error('[pdf-shot] failed:', diagnostics.error);
    if (debugMode) {
      diagnostics.stage = diagnostics.stage || 'error';
      return res.status(500).json(diagnostics);
    }
    return res.status(500).type('text/plain').send('Screenshot PDF Fehler');
  }
});

// Convenience endpoint: create a sample config quickly for testing screenshot PDF
app.get('/config-sample', (req, res) => {
  try {
    const w = Number(req.query.w || 320);
    const h = Number(req.query.h || 180);
    const img = String(req.query.img || 'https://via.placeholder.com/1200x800.png?text=Sample');
    const rec = cfg.create({
      wall: { widthCm: 250, heightCm: 200 },
      print: { widthCm: 240, heightCm: 190 },
      image: { url: img },
      transform: { zoom: 1 },
      areaM2: ((240/100)*(190/100)).toFixed(3)
    });
    return res.json({ id: rec.id, code: rec.code, pdfShot: `/config/${rec.id}/pdf-shot`, pdf: `/config/${rec.id}/pdf` });
  } catch (e) {
    return res.status(500).json({ error: 'sample_failed' });
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
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
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
  const isRasterOrSvg = ['image/jpeg', 'image/tiff', 'image/svg+xml'].includes(req.file.mimetype);
  const generationTimeoutMs = 60_000; // 60s

  // Try to generate preview for common image/vector types using sharp (raster) or ImageMagick for PDF/EPS
  if (isRasterOrSvg) {
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
  res.json({ message: 'Datei erfolgreich hochgeladen!', filename: req.file.filename, preview });
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

// Bind to loopback to ensure Nginx can proxy locally while not exposing externally
const bindHost = process.env.BIND_HOST || '127.0.0.1';
app.listen(port, bindHost, () => {
  console.log(`Backend läuft auf http://${bindHost === '0.0.0.0' ? 'localhost' : bindHost}:${port}`);
  console.log(`ImageMagick command: ${magickCmd}`);
  console.log(`Ghostscript command: ${process.platform === 'win32' ? 'gswin64c' : 'gs'}`);
});
