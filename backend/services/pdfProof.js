// Ausgelagerte PDF-Erstellung (Proof) aus index.js
// Beibehaltung der bisherigen Logik: Preview-Priorisierung, Crop-/Zoom-Berechnung,
// Tabellen & Disclaimer (inkl. Qualitäts-Hinweis) – minimal angepasst für Modulgebrauch.

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const sharp = (() => { try { return require('sharp'); } catch { return null; } })();
let PDFDocument = null;
try { PDFDocument = require('pdfkit'); } catch { /* Fallback handled vom Aufrufer */ }

// Hilfsfunktion aus index.js (vereinfacht übernommen)
function isVectorOrPdfFile({ url, mimetype, detectedMime, filename }) {
  const ext = (url && url.match(/\.([a-z0-9]+)$/i) || [])[1]
    || (filename && filename.match(/\.([a-z0-9]+)$/i) || [])[1]
    || '';
  const mt = (mimetype || '').toLowerCase();
  const dmt = (detectedMime || '').toLowerCase();
  const extLower = (ext || '').toLowerCase();
  return [ 'pdf','svg','eps' ].includes(extLower)
    || mt === 'application/pdf'
    || mt === 'application/postscript'
    || mt === 'application/eps'
    || mt === 'application/x-eps'
    || mt === 'image/svg+xml'
    || dmt === 'application/pdf'
    || dmt === 'application/postscript'
    || dmt === 'application/eps'
    || dmt === 'application/x-eps'
    || dmt === 'image/svg+xml';
}

/**
 * Erzeugt den PDFKit-Dokument-Stream mit allen Layout-Elementen.
 * Rückgabe: { doc, fallbackUsed }
 */
async function buildProofPdf(data, { code }) {
  if (!PDFDocument) {
    return { doc: null, fallbackUsed: true };
  }
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });

  const wall = data.wall || {}; const print = data.print || {};
  const printW = Math.round(Number(print.widthCm) || Number(wall.widthCm) || 0);
  const printH = Math.round(Number(print.heightCm) || Number(wall.heightCm) || 0);
  const wallW = Math.round(Number(wall.widthCm) || printW);
  const wallH = Math.round(Number(wall.heightCm) || printH);
  const areaM2 = Number(data.areaM2 || ((printW/100) * (printH/100))).toFixed(3);
  const pricePerM2 = (data.price && data.price.perM2 != null) ? Number(data.price.perM2) : null;
  let totalPrice = null;
  if (Number(areaM2) >= 3) {
    totalPrice = (data.price && data.price.total != null)
      ? Number(data.price.total)
      : (pricePerM2 != null ? Number((pricePerM2 * Number(areaM2)).toFixed(2)) : null);
  }
  const zoomFactor = Number((data.transform && data.transform.zoom) || 1) || 1;

  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const margin = doc.page.margins.left;

  // Bild-/Produktinfos
  const imgUrlLower = String((data.image && (data.image.originalUrl || data.image.url)) || '').toLowerCase();
  const isShopImg = imgUrlLower.includes('/products/') || imgUrlLower.includes('/shopify/') || imgUrlLower.includes('cdn.shopify.com');

  let shopSku = null, shopTitle = null, uploadFilename = null;
  // Diese beiden werden erst NACH Meta-Ermittlung final gesetzt
  let uploadOrigW = null, uploadOrigH = null;
  if (data.product) {
    if (data.product.sku) shopSku = String(data.product.sku);
    if (data.product.title) shopTitle = String(data.product.title);
  }
  if (data.image) {
    if (data.image.filename) uploadFilename = String(data.image.filename); else if (data.image.originalUrl) {
      const parts = String(data.image.originalUrl).split('/'); uploadFilename = parts[parts.length - 1];
    } else if (data.image.url) {
      const parts = String(data.image.url).split('/'); uploadFilename = parts[parts.length - 1];
    }
  }
  // Originalgröße bevorzugt aus Metadaten des Originalbildes (wird später gesetzt)
  if (data.transform && data.transform.naturalWidth) uploadOrigW = Number(data.transform.naturalWidth);
  if (data.transform && data.transform.naturalHeight) uploadOrigH = Number(data.transform.naturalHeight);

  // Header wird NACH Metadaten-Auflösung geschrieben
  let headerRendered = false;
  let codeCropY; // wird gesetzt wenn Header gemalt wurde

  // Logo (Fallback falls kein Bild)
  try {
    const localLogos = ['public/logo.png', 'public/logo.jpg', 'public/logo.jpeg'].map(p => path.join(__dirname, '..', p));
    const siblingLogos = ['logo.png','logo.jpg','logo.jpeg'].map(n => path.join(__dirname, '..', 'public', n));
    const logoPaths = [...localLogos, ...siblingLogos];
    const found = logoPaths.find(p => fs.existsSync(p));
    const logoW = Math.round(120 * 0.7);
    const logoX = pageWidth - margin - logoW;
    const logoY = margin - 6;
    if (found) doc.image(found, logoX, Math.max(logoY, 16), { width: logoW });
    else {
      doc.save().fillColor('#000').fontSize(16).text('WIRZ', logoX + 8, Math.max(logoY, 16) + 8, { width: logoW - 16, align: 'right' }).restore();
    }
  } catch {}

  const imgArea = { x: margin, y: 110, w: pageWidth - margin * 2, h: 360 };
  let imgBuf = null; // Anzeige (Preview oder Original)
  let cropSourceBuf = null; // Quelle für Crop-Berechnung
  let origMeta = null; let resolvedPreview = null; let resolvedOriginal = null; let metaSource = 'none';
  try {
    const backendRoot = path.join(__dirname, '..');
    // Helper um aus URL relativen Pfad zu gewinnen
    function resolveUpload(rel) {
      if (!rel) return null;
      const m = rel.match(/(uploads\/[A-Za-z0-9_\-./]+\.(jpg|jpeg|png|tif|tiff))/i); // Metadaten nur für Raster nötig
      if (m) {
        const p1 = path.join(backendRoot, m[1]);
        if (fs.existsSync(p1)) return p1;
      }
      return null;
    }
    function resolveAny(rel) {
      if (!rel) return null;
      const m = rel.match(/(uploads\/[A-Za-z0-9_\-./]+\.(jpg|jpeg|png|tif|tiff|pdf|svg|eps))/i);
      if (m) {
        const p1 = path.join(backendRoot, m[1]);
        if (fs.existsSync(p1)) return p1;
      }
      return null;
    }
    // Remote Fetch (Option 1): holt HTTP(S)-Bilder als Buffer, mit Timeout und Limit
    function isHttpUrl(u) {
      return typeof u === 'string' && /^https?:\/\//i.test(u);
    }
    function fetchUrlBuffer(urlStr, { timeoutMs = 10000, maxBytes = 50 * 1024 * 1024 } = {}) {
      return new Promise((resolve, reject) => {
        try {
          if (!isHttpUrl(urlStr)) return reject(new Error('Not an http(s) URL'));
          const lib = urlStr.startsWith('https') ? https : http;
          const req = lib.get(urlStr, { headers: { 'User-Agent': 'WPD-PDF/1.0' } }, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              // Follow one redirect
              try { res.destroy(); } catch {}
              return fetchUrlBuffer(res.headers.location, { timeoutMs, maxBytes }).then(resolve, reject);
            }
            if (!res.statusCode || res.statusCode >= 400) {
              return reject(new Error('HTTP ' + res.statusCode));
            }
            const chunks = []; let total = 0;
            res.on('data', (d) => {
              total += d.length;
              if (total > maxBytes) {
                try { res.destroy(); } catch {}
                return reject(new Error('Image too large'));
              }
              chunks.push(d);
            });
            res.on('end', () => {
              try { resolve(Buffer.concat(chunks)); } catch (e) { reject(e); }
            });
          });
          req.setTimeout(timeoutMs, () => { try { req.destroy(new Error('Timeout')); } catch {} });
          req.on('error', reject);
        } catch (err) { reject(err); }
      });
    }
    // 1) preview (JPEG) für Anzeige
    if (data.image && typeof data.image.preview === 'string') {
      const p = resolveAny(data.image.preview); if (p) { try { imgBuf = fs.readFileSync(p); resolvedPreview = p; } catch {} }
      if (!imgBuf && isHttpUrl(data.image.preview)) {
        try { imgBuf = await fetchUrlBuffer(data.image.preview); resolvedPreview = data.image.preview; } catch {}
      }
    }
    // 2) Haupt-> Anzeige falls kein Preview
    if (!imgBuf && data.image && typeof data.image.url === 'string') {
      const p = resolveAny(data.image.url); if (p) { try { imgBuf = fs.readFileSync(p); } catch {} }
      if (!imgBuf && isHttpUrl(data.image.url)) {
        // Keine Vektoren/PDF vom Netz holen (nicht darstellbar via Sharp/JPEG)
        const skip = isVectorOrPdfFile({ url: data.image.url });
        if (!skip) { try { imgBuf = await fetchUrlBuffer(data.image.url); } catch {} }
      }
    }
    // 3) originalUrl als Anzeige falls weder preview noch url
    if (!imgBuf && data.image && typeof data.image.originalUrl === 'string') {
      const p = resolveAny(data.image.originalUrl); if (p) { try { imgBuf = fs.readFileSync(p); } catch {} }
      if (!imgBuf && isHttpUrl(data.image.originalUrl)) {
        const skip = isVectorOrPdfFile({ url: data.image.originalUrl });
        if (!skip) { try { imgBuf = await fetchUrlBuffer(data.image.originalUrl); } catch {} }
      }
    }
    // Original-Metadaten immer aus originalUrl bevorzugt
    let origPath = null;
    if (data.image && typeof data.image.originalUrl === 'string') {
      origPath = resolveUpload(data.image.originalUrl);
    }
    if (!origPath && data.image && typeof data.image.url === 'string') {
      origPath = resolveUpload(data.image.url);
    }
    if (origPath && sharp) {
      try {
        origMeta = await sharp(origPath).metadata();
        uploadOrigW = origMeta.width || uploadOrigW; uploadOrigH = origMeta.height || uploadOrigH;
        resolvedOriginal = origPath;
        try { cropSourceBuf = fs.readFileSync(origPath); } catch {}
        metaSource = 'original';
      } catch { origMeta = null; }
    } else if (sharp) {
      // Remote Original-Metadaten: hole bevorzugt originalUrl, sonst url
      const remoteOriginal = (data.image && typeof data.image.originalUrl === 'string' && isHttpUrl(data.image.originalUrl) && !isVectorOrPdfFile({ url: data.image.originalUrl }))
        ? data.image.originalUrl
        : (data.image && typeof data.image.url === 'string' && isHttpUrl(data.image.url) && !isVectorOrPdfFile({ url: data.image.url }))
          ? data.image.url
          : null;
      if (remoteOriginal) {
        try {
          const buf = await fetchUrlBuffer(remoteOriginal);
          const meta = await sharp(buf).metadata();
          if (meta && meta.width && meta.height) {
            origMeta = meta;
            uploadOrigW = uploadOrigW || meta.width;
            uploadOrigH = uploadOrigH || meta.height;
            cropSourceBuf = cropSourceBuf || buf;
            resolvedOriginal = remoteOriginal;
            metaSource = 'original-remote';
          }
        } catch {}
      }
    }
    // Falls wir nur Preview als imgBuf haben, aber Original existiert, nutze Original für Crop
    if (!cropSourceBuf && resolvedOriginal) {
      try { cropSourceBuf = fs.readFileSync(resolvedOriginal); } catch {}
    }
    if (!origMeta) {
      if (uploadOrigW && uploadOrigH) metaSource = metaSource === 'none' ? 'transform-fallback' : metaSource;
      else if (imgBuf && sharp) {
        // Versuch: Preview-Metadaten (als Fallback wenn kein originales Raster verfügbar war)
        try {
          const tmpMeta = await sharp(imgBuf).metadata();
          if (tmpMeta.width && tmpMeta.height) {
            uploadOrigW = uploadOrigW || tmpMeta.width;
            uploadOrigH = uploadOrigH || tmpMeta.height;
            metaSource = metaSource === 'none' ? 'preview' : metaSource;
          }
        } catch {}
      }
    }
    if (!cropSourceBuf && imgBuf) { cropSourceBuf = imgBuf; if (metaSource === 'none') metaSource = 'preview'; }
    console.log('[pdf][image]', { preview: resolvedPreview || null, original: resolvedOriginal || null, displayBytes: imgBuf ? imgBuf.length : 0, cropBytes: cropSourceBuf ? cropSourceBuf.length : 0, metaSource, meta: { w: uploadOrigW, h: uploadOrigH } });
  } catch {}

  // Jetzt Header zeichnen (nach Meta)
  let yCursor = 36;
  doc.fontSize(20).fillColor('#000').text('Gut zum Druck', { align: 'left' });
  // Version Marker zur Diagnose (hilft zu prüfen ob neue PDF-Version live ist)
  try {
    const verLine = `Version: 2025-11-13-1`; // bei Änderungen anpassen
    doc.fontSize(8).fillColor('#666').text(verLine, { align: 'right' });
  } catch {}
  // Neuer Titel: Produktname falls vorhanden, sonst Dateiname, Originalgröße nicht mehr anzeigen
  const displayTitle = shopTitle || uploadFilename || null;
  if (displayTitle) {
    doc.fontSize(13).fillColor('#333').text(displayTitle, margin, yCursor, { width: pageWidth - margin * 2, align: 'center' });
    yCursor += doc.currentLineHeight() + 2;
  }
  // Optional: Materialzeile unterhalb des Titels anzeigen
  try {
    let materialLabel = null;
    if (data && data.product) {
      const pm = data.product.material;
      if (pm && typeof pm === 'object' && pm.raw) materialLabel = String(pm.raw);
      else if (typeof pm === 'string' && pm.trim()) materialLabel = pm.trim();
    }
    if (materialLabel) {
      doc.fontSize(12).fillColor('#555').text(`Material: ${materialLabel}`, margin, yCursor, { width: pageWidth - margin * 2, align: 'center' });
      yCursor += doc.currentLineHeight() + 1;
    }
  } catch {}
  codeCropY = yCursor + 1;
  yCursor += 2 * doc.heightOfString('Xy', { width: pageWidth - margin * 2 }) + 5;
  if (isShopImg && (shopSku || shopTitle)) {
    let shopInfo = '';
    if (shopSku) shopInfo += `Artikelnummer: ${shopSku}`;
    if (shopTitle) shopInfo += (shopInfo ? '   ' : '') + shopTitle;
    doc.fontSize(13).fillColor('#333').text(shopInfo, { width: pageWidth - margin * 2, align: 'center' });
    yCursor += doc.currentLineHeight() + 2;
  }
  // headerRendered flag entfernt (nicht genutzt)

  // Anzeige-Basis weiterhin Druckmaß (voller Rahmen) – das sichtbare Bildmaß (W+10) wird später geclippt
  const printAspect = (printW > 0 && printH > 0) ? (printW / printH) : 1;
  let dispW = imgArea.w; let dispH = Math.round(dispW / Math.max(0.01, printAspect));
  if (dispH > imgArea.h) { dispH = imgArea.h; dispW = Math.round(dispH * printAspect); }
  const dispX = Math.round(imgArea.x + (imgArea.w - dispW) / 2);
  const dispY = Math.round(imgArea.y + (imgArea.h - dispH) / 2);
  const cmToPx = (printW > 0) ? (dispW / printW) : 0;
  const calc = data.calc || {};
  // Extra-Übermaß aus Config oder robust aus Wand/Druck berechnen
  let extraWhiteCm = Math.max(0, Number(calc.extraWhiteWidthCm) || 0);
  const wallOffsetCm = (calc.wallOffsetCm != null) ? Number(calc.wallOffsetCm) : null;
  const bahnWidthCm = Number(calc.bahnenbreiteCm) || null;
  const stripsCount = Number(calc.strips) || null;
  const overageSide = calc.overageSide === 'left' ? 'left' : 'right';
  // Fallback: Wenn extraWhiteCm nicht übermittelt wurde, aber Bahnen-Modus erkennbar ist, aus Maßen ableiten
  try {
    // Wenn nicht explizit übermittelt, leiten wir das Übermaß immer robust aus Wand- und Druckmaß ab
    if ((!Number.isFinite(extraWhiteCm)) || extraWhiteCm <= 0) {
      if (wallW && printW) {
        const imageWidth = wallW + 10; // sichtbares Bildmass (W+10)
        extraWhiteCm = Math.max(0, printW - imageWidth);
      } else {
        extraWhiteCm = Math.max(0, extraWhiteCm || 0);
      }
    }
  } catch {}

  let cropDataText = 'Crop data   left: –  top: –  width: –, height: –'; let cropW=0, cropH=0;
  // Flip Flags vorziehen, damit sie auch in Fallback-Zweig/außerhalb try sichtbar sind
  const flipH = !!(data.transform && data.transform.flipH);
  const flipV = !!(data.transform && data.transform.flipV);
  if (imgBuf) {
    try {
      // Ermittele Naturalgröße
      let iw = Math.max(1, uploadOrigW || 0), ih = Math.max(1, uploadOrigH || 0);
      if ((!iw || !ih) && sharp) {
        try { const meta = await sharp(imgBuf).metadata(); iw = meta.width || iw || 1; ih = meta.height || ih || 1; } catch {}
      }
      // Flip per sharp, aber KEIN Crop/Resize – wir positionieren/skalieren wie im Frontend über Clip & Offsets
      let processed = imgBuf;
      if (sharp) {
        try {
          let p = sharp(imgBuf).rotate();
          if (flipH) p = p.flop();
          if (flipV) p = p.flip();
          processed = await p.jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
        } catch {}
      }
      const ox = Number((data.transform && data.transform.offsetXPct) || 0.5);
      const oy = Number((data.transform && data.transform.offsetYPct) || 0.5);
      const zoom = Math.max(0.01, Number((data.transform && data.transform.zoom) || 1) || 1);
      // Sichtbare Breite in Punkten (Clipbreite)
      const extraWhitePx = Math.round(Math.max(0, extraWhiteCm) * cmToPx);
      const clipX = overageSide === 'left' ? (dispX + extraWhitePx) : dispX;
      const clipW = Math.max(0, dispW - extraWhitePx);
      const clipH = dispH;
      // COVER-Skalierung auf sichtbaren Bereich wie im Frontend (visibleWidthPx x frameHeightPx)
      let s = Math.max(clipW / iw, clipH / ih);
      if (s > 1) s = 1;
      const drawW = iw * s * zoom;
      const drawH = ih * s * zoom;
      const denomW = drawW; const denomH = drawH;
      // Mittelpunkt des sichtbaren Bereichs
      const centerX = ox * denomW;
      const centerY = oy * denomH;
      const posX = Math.round(clipX + (clipW / 2) - centerX);
      const posY = Math.round(dispY + (clipH / 2) - centerY);
      // Zeichnen: erst Clip + weiße Unterlage, dann Bild an posX/posY mit drawW/drawH
      doc.save();
      doc.rect(clipX, dispY, clipW, clipH).clip();
      doc.rect(clipX, dispY, clipW, clipH).fill('#FFFFFF');
      doc.image(processed, posX, posY, { width: drawW, height: drawH });
      doc.restore();
      cropDataText = `Cover like UI  draw: ${Math.round(drawW)}x${Math.round(drawH)}  pos: ${posX},${posY}  center%: ${ox.toFixed(3)},${oy.toFixed(3)}`;
    } catch (err) {
      console.error('[pdf] image placement failed:', err && err.message || err);
      doc.fontSize(18).fillColor('#666').text('Bildfehler', imgArea.x, imgArea.y + imgArea.h/2 - 12, { width: imgArea.w, align: 'center' });
    }
  } else {
    doc.fontSize(18).fillColor('#666').text('Kein Bild', imgArea.x, imgArea.y + imgArea.h/2 - 12, { width: imgArea.w, align: 'center' });
  }

  // Code / Crop-Zeile
  doc.fontSize(12).fillColor('#138136').text(`Code: ${code}`, margin, codeCropY, { align: 'left' });
  let afterCodeY = codeCropY + doc.currentLineHeight() + 0.5;
  doc.fontSize(10).fillColor('#333').text(cropDataText, margin, afterCodeY, { align: 'left' });

  // Rahmen (PRINT + WALL) – Wand-Offset relativ zum sichtbaren Druckbereich (abhängig von Übermass-Seite)
  doc.lineWidth(1).strokeColor('#444').rect(dispX, dispY, dispW, dispH).stroke();
  try {
    const ratioW = (printW > 0) ? (wallW / printW) : 1;
    const ratioH = (printH > 0) ? (wallH / printH) : 1;
    const innerW = Math.max(2, Math.round(dispW * ratioW));
    const innerH = Math.max(2, Math.round(dispH * ratioH));
    const extraWhitePx = Math.round(extraWhiteCm * cmToPx);
    const visibleStartX = overageSide === 'left' ? (dispX + extraWhitePx) : dispX;
    const innerX = (wallOffsetCm != null && cmToPx)
      ? Math.round(visibleStartX + wallOffsetCm * cmToPx)
      : Math.round(dispX + (dispW - innerW) / 2);
    const innerY = Math.round(dispY + (dispH - innerH) / 2);
    doc.lineWidth(2).strokeColor('#c00').rect(innerX, innerY, innerW, innerH).stroke();
  } catch {}

  // Weißes Übermaß (links oder rechts) mit Schraffur (falls vorhanden)
  try {
    if (extraWhiteCm > 0 && cmToPx) {
      const extraPx = Math.max(1, Math.round(extraWhiteCm * cmToPx));
      const x = overageSide === 'right' ? (dispX + dispW - extraPx) : dispX;
      const y = dispY; const w = extraPx; const h = dispH;
      // Weiß füllen + Schraffur (Re-Aktivierung)
      doc.save();
      doc.fillOpacity(1);
      doc.rect(x, y, w, h).fill('#FFFFFF');
      // zweite Weißfüllung als Sicherheit (einige Renderer zeichnen 1px Kanten)
      doc.rect(x, y, w, h).fill('#FFFFFF');
      doc.restore();
      // Schraffur: diagonale Linien
      doc.save();
      doc.rect(x, y, w, h).clip();
      doc.lineWidth(0.7).strokeColor('#d5d5d5'); doc.strokeOpacity(0.85);
      const step = 6;
      for (let i = -h; i < w; i += step) {
        doc.moveTo(x + i, y).lineTo(x + i + h, y + h).stroke();
      }
      doc.strokeOpacity(1);
      doc.restore();
      // Dünne Kante zur Abgrenzung
      const edgeX = overageSide === 'right' ? x : (x + w);
      doc.save().lineWidth(1).strokeColor('#ddd').moveTo(edgeX, y).lineTo(edgeX, y + h).stroke().restore();
    }
  } catch {}

  // Bahnen-Grenzlinien (gestrichelt), falls Bahnenbreite/Anzahl bekannt – relativ zum sichtbaren Bereich
  try {
    if (bahnWidthCm && stripsCount && stripsCount > 1 && cmToPx) {
      doc.save();
      doc.strokeColor('#c00000'); doc.strokeOpacity(0.7).lineWidth(0.8).dash(3, { space: 3 });
      const extraWhitePx = Math.round(extraWhiteCm * cmToPx);
      const visibleLeftX = overageSide === 'left' ? (dispX + extraWhitePx) : dispX;
      const visibleRightX = overageSide === 'right' ? (dispX + dispW - extraWhitePx) : (dispX + dispW);
      for (let i = 1; i < stripsCount; i++) {
        const x = (overageSide === 'left')
          ? Math.round(visibleRightX - i * bahnWidthCm * cmToPx)
          : Math.round(visibleLeftX + i * bahnWidthCm * cmToPx);
        doc.moveTo(x, dispY).lineTo(x, dispY + dispH).stroke();
      }
      doc.undash();
      doc.strokeOpacity(1);
      doc.restore();
    }
  } catch {}

  // Labels oben / links
  doc.fontSize(10).fillColor('#000').text(`Druckmass Breite: ${printW} cm`, dispX, dispY - 23, { width: dispW, align: 'center' });
  doc.fontSize(10).fillColor('#c00').text(`Wandbreite: ${wallW} cm`, dispX, dispY - 11, { width: dispW, align: 'center' });
  try {
    const gap = 18; doc.save(); doc.translate(dispX - gap, dispY + Math.round(dispH / 2)); doc.rotate(-90);
    const textWidth = dispH; const startX = -Math.round(textWidth / 2); const shiftX = 5; let yy = -10;
    doc.fontSize(10).fillColor('#000').text(`Druckmass Höhe: ${printH} cm`, startX + shiftX, yy - 10, { width: textWidth, align: 'center' });
    doc.fontSize(10).fillColor('#c00').text(`Wandhöhe: ${wallH} cm`, startX + shiftX, yy + 4, { width: textWidth, align: 'center' });
    doc.restore();
  } catch {}

  // Tabellen
  const leftRows = [ ['Wandmass (B x H)', `${wallW} x ${wallH} cm`], ['Druckmass (B x H)', `${printW} x ${printH} cm`] ];
  const midRows = [ ['Zoom', `${zoomFactor.toFixed(2)}x`], ['Total Fläche', `${areaM2} m²`] ];
  const rightRows = [ ['Preis pro m²', pricePerM2 != null ? `CHF ${Number(pricePerM2).toFixed(2)}` : '–'], ['Gesamtpreis', (Number(areaM2) < 3) ? 'Mindestgrösse 3m2' : (totalPrice != null ? `CHF ${Number(totalPrice).toFixed(2)}` : '–')] ];
  const lineH = 18; const colGap = 32; const colW = 170; const groupWidth = colW * 3 + colGap * 2; const groupStartX = Math.round((pageWidth - groupWidth) / 2);
  const colLeftX = groupStartX; const colMidX = colLeftX + colW + colGap; const colRightX = colMidX + colW + colGap; const tableY = imgArea.y + imgArea.h + 24;
  function drawRows(x, y, rows) { let yy = y; doc.fontSize(10); for (const [label, value] of rows) { doc.fillColor('#333').text(label, x, yy, { width: colW * 0.5 }); doc.fillColor('#333').text(String(value ?? ''), x + colW * 0.5 + 8, yy, { width: colW * 0.5 - 8, align: 'right' }); yy += lineH; doc.moveTo(x, yy - 4).lineTo(x + colW, yy - 4).strokeColor('#eee').lineWidth(1).stroke(); } }
  drawRows(colLeftX, tableY, leftRows); drawRows(colMidX, tableY, midRows); drawRows(colRightX, tableY, rightRows);

  // Disclaimer / Qualitäts-Hinweis
  let disclaimerSegments = [];
  if (!isShopImg) {
    let orangeNote = '';
    try {
      let origUrl = (data.image && data.image.originalUrl) || (data.image && data.image.url) || imgUrlLower;
      let origMime = (data.image && data.image.mimetype) || '';
      let origDetectedMime = (data.image && data.image.detectedMime) || '';
      let origFilename = (data.image && data.image.filename) || '';
      const isVec = isVectorOrPdfFile({ url: origUrl, mimetype: origMime, detectedMime: origDetectedMime, filename: origFilename });
      const natW = Number(data.transform && data.transform.naturalWidth) || 0;
      const natH = Number(data.transform && data.transform.naturalHeight) || 0;
      const zoomUsed = Math.max(0.01, Number(data.transform && data.transform.zoom) || 1);
      const effW = Math.floor(natW / zoomUsed); const effH = Math.floor(natH / zoomUsed);
      const wallWcm = Math.max(0, Number(data.wall && data.wall.widthCm) || 0);
      const wallHcm = Math.max(0, Number(data.wall && data.wall.heightCm) || 0);
      if (!isVec && effW && effH && wallWcm && wallHcm) {
        const isRed = (effW < wallWcm * 10) || (effH < wallHcm * 10);
        const isOrange = !isRed && ((effW < wallWcm * 15) || (effH < wallHcm * 15));
        if (isOrange) orangeNote = ' Die Qualität des eingereichten Bildes entspricht nicht den Vorgaben. Der Besteller nimmt zur Kenntnis, dass es zu Qualitätsverlust kommen kann.';
      }
    } catch {}
    const base = 'Der Besteller verfügt über alle erforderlichen Rechte am eingereichten Bild, ist für die Masse, das Layout und den Ausschnitt verantwortlich und bestätigt dies ausdrücklich durch das Einreichen dieses Gut zum Druck (Code im Warenkorb/Bestellbestätigung).';
    const tail = ' Der Auftrag wird direkt an die Produktion übermittelt und kann nicht mehr geändert werden.';
    disclaimerSegments = [ { text: base, color: '#c00' }, ...(orangeNote ? [{ text: orangeNote, color: '#e69100' }] : []), { text: tail, color: '#c00' } ];
  } else {
    const shopText = 'Der Besteller ist für die Masse, das Layout und den Ausschnitt verantwortlich und bestätigt dies ausdrücklich durch das Einreichen dieses Gut zum Druck (Code im Warenkorb/Bestellbestätigung). Der Auftrag wird direkt an die Produktion übermittelt und kann nicht mehr geändert werden.';
    disclaimerSegments = [{ text: shopText, color: '#c00' }];
  }

  doc.page.margins.bottom = 1;
  const created = data.createdAt ? new Date(data.createdAt) : new Date();
  const dateStr = created.toLocaleDateString('de-CH') + ' ' + created.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
  const marginRightCol = 120;
  const maxDisclaimerHeight = pageHeight - 1 - (codeCropY + 60);
  let disclaimerFontSize = 10;
  const cleanSegments = disclaimerSegments.map((seg, idx) => ({ ...seg, text: (idx === 1 || idx === 2) ? seg.text.replace(/^\s+/, '') : seg.text }));
  let segHeights = cleanSegments.map(seg => doc.fontSize(disclaimerFontSize).heightOfString(seg.text, { width: pageWidth - margin * 2 - marginRightCol, align: 'left' }));
  let totalHeight = segHeights.reduce((a,b)=>a+b,0);
  while (totalHeight > maxDisclaimerHeight && disclaimerFontSize > 6) {
    disclaimerFontSize -= 1;
    segHeights = cleanSegments.map(seg => doc.fontSize(disclaimerFontSize).heightOfString(seg.text, { width: pageWidth - margin * 2 - marginRightCol, align: 'left' }));
    totalHeight = segHeights.reduce((a,b)=>a+b,0);
  }
  const y = pageHeight - 11 - totalHeight; let yDraw = y;
  for (let i=0;i<cleanSegments.length;i++) {
    const seg = cleanSegments[i];
    const color = seg.text.includes('Qualität des eingereichten Bildes entspricht nicht den Vorgaben') ? '#e69100' : (seg.color || '#c00');
    doc.fontSize(disclaimerFontSize).fillColor(color).text(seg.text, margin, yDraw, { width: pageWidth - margin * 2 - marginRightCol, align: 'left' });
    yDraw += segHeights[i];
  }
  doc.fontSize(10).fillColor('#888').text(dateStr, pageWidth - margin - marginRightCol, y, { width: marginRightCol, align: 'right' });

  return { doc, fallbackUsed: false };
}

module.exports = { buildProofPdf };
