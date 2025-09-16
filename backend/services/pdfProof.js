// Ausgelagerte PDF-Erstellung (Proof) aus index.js
// Beibehaltung der bisherigen Logik: Preview-Priorisierung, Crop-/Zoom-Berechnung,
// Tabellen & Disclaimer (inkl. Qualitäts-Hinweis) – minimal angepasst für Modulgebrauch.

const fs = require('fs');
const path = require('path');
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
    // 1) preview (JPEG) für Anzeige
    if (data.image && typeof data.image.preview === 'string') {
      const p = resolveAny(data.image.preview); if (p) { try { imgBuf = fs.readFileSync(p); resolvedPreview = p; } catch {} }
    }
    // 2) Haupt-> Anzeige falls kein Preview
    if (!imgBuf && data.image && typeof data.image.url === 'string') {
      const p = resolveAny(data.image.url); if (p) { try { imgBuf = fs.readFileSync(p); } catch {} }
    }
    // 3) originalUrl als Anzeige falls weder preview noch url
    if (!imgBuf && data.image && typeof data.image.originalUrl === 'string') {
      const p = resolveAny(data.image.originalUrl); if (p) { try { imgBuf = fs.readFileSync(p); } catch {} }
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
  if (!isShopImg && uploadFilename) {
    doc.fontSize(13).fillColor('#333').text(uploadFilename, margin, yCursor, { width: pageWidth - margin * 2, align: 'center' });
    yCursor += doc.currentLineHeight() + 2;
    if (uploadOrigW && uploadOrigH) {
      doc.fontSize(9).fillColor('#888').text(`Originalbildgröße (${metaSource}): ${uploadOrigW} x ${uploadOrigH} px`, margin, yCursor, { width: pageWidth - margin * 2, align: 'center' });
      yCursor += doc.currentLineHeight() + 2;
    }
  }
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

  const printAspect = (printW > 0 && printH > 0) ? (printW / printH) : 1;
  let dispW = imgArea.w; let dispH = Math.round(dispW / Math.max(0.01, printAspect));
  if (dispH > imgArea.h) { dispH = imgArea.h; dispW = Math.round(dispH * printAspect); }
  const dispX = Math.round(imgArea.x + (imgArea.w - dispW) / 2);
  const dispY = Math.round(imgArea.y + (imgArea.h - dispH) / 2);

  let cropDataText = 'Crop data   left: –  top: –  width: –, height: –'; let cropW=0, cropH=0;
  // Flip Flags vorziehen, damit sie auch in Fallback-Zweig/außerhalb try sichtbar sind
  const flipH = !!(data.transform && data.transform.flipH);
  const flipV = !!(data.transform && data.transform.flipV);
  if (imgBuf && sharp) { // cropSourceBuf wird ggf. auf imgBuf gesetzt
    try {
      let iw = 1, ih = 1;
  if (origMeta && origMeta.width && origMeta.height) { iw = Math.max(1, origMeta.width); ih = Math.max(1, origMeta.height); }
  let centerXPct = Number((data.transform && data.transform.offsetXPct) || 0.5);
  let centerYPct = Number((data.transform && data.transform.offsetYPct) || 0.5);
  // Wichtig: Wir wenden jetzt den Flip physisch per sharp.flop()/flip() an.
  // Daher KEINE zusätzliche Inversion der Center-Koordinaten mehr – sonst verschiebt sich der gewünschte Ausschnitt.
      const zoom = Math.max(0.01, Number((data.transform && data.transform.zoom) || 1) || 1);
      const aspect = Math.max(0.01, printAspect);
      const coverScaleCmPerPx = Math.max((printW > 0 ? (printW / iw) : Infinity),(printH > 0 ? (printH / ih) : Infinity));
  cropW = Math.max(1, Math.floor((printW / coverScaleCmPerPx) / zoom));
  cropH = Math.max(1, Math.floor((printH / coverScaleCmPerPx) / zoom));
      const targetH = Math.round(cropW / aspect);
      if (targetH <= ih) cropH = Math.max(1, targetH); else cropW = Math.max(1, Math.round(cropH * aspect));
      cropW = Math.min(cropW, iw); cropH = Math.min(cropH, ih);
      const cx = Math.min(iw - 1, Math.max(0, Math.round(iw * centerXPct)));
      const cy = Math.min(ih - 1, Math.max(0, Math.round(ih * centerYPct)));
      let left = Math.round(cx - cropW / 2); let top = Math.round(cy - cropH / 2);
      if (left < 0) left = 0; if (top < 0) top = 0; if (left + cropW > iw) left = iw - cropW; if (top + cropH > ih) top = ih - cropH;
      cropDataText = `Crop data   left: ${left}  top: ${top}  width: ${cropW}, height: ${cropH}`;
      // KORREKTE REIHENFOLGE: rotate -> extract (auf Original-Koordinaten) -> flips (Spiegelung des Ausschnitts) -> resize -> encode
      let pipe = sharp(cropSourceBuf || imgBuf).rotate().extract({ left, top, width: cropW, height: cropH });
      if (flipH) pipe = pipe.flop();
      if (flipV) pipe = pipe.flip();
      pipe = pipe.resize({ width: Math.max(2, Math.round(dispW)), height: Math.max(2, Math.round(dispH)), fit: 'fill' })
        .sharpen()
        .jpeg({ quality: 92, chromaSubsampling: '4:4:4' });
      const processed = await pipe.toBuffer();
      doc.image(processed, dispX, dispY, { width: dispW, height: dispH });
    } catch (err) {
      console.error('[pdf] image processing failed (module path):', err && err.message || err);
      try {
        let fb = sharp(cropSourceBuf || imgBuf).rotate().extract({ left:0, top:0, width: Math.min(cropW||1000, (origMeta?.width)||1000), height: Math.min(cropH||1000, (origMeta?.height)||1000) });
        if (flipH) fb = fb.flop();
        if (flipV) fb = fb.flip();
        const fallback = await fb.resize({ width: Math.max(2, Math.round(dispW)), height: Math.max(2, Math.round(dispH)), fit: 'cover', position: 'centre' })
          .sharpen()
          .jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
        doc.image(fallback, dispX, dispY, { width: dispW, height: dispH });
      } catch (err2) {
        console.error('[pdf] fallback failed:', err2 && err2.message || err2);
        doc.fontSize(18).fillColor('#666').text('Bildfehler', imgArea.x, imgArea.y + imgArea.h/2 - 12, { width: imgArea.w, align: 'center' });
      }
    }
  } else {
    doc.fontSize(18).fillColor('#666').text('Kein Bild', imgArea.x, imgArea.y + imgArea.h/2 - 12, { width: imgArea.w, align: 'center' });
  }

  // Code / Crop-Zeile
  doc.fontSize(12).fillColor('#138136').text(`Code: ${code}`, margin, codeCropY, { align: 'left' });
  let afterCodeY = codeCropY + doc.currentLineHeight() + 0.5;
  doc.fontSize(10).fillColor('#333').text(cropDataText, margin, afterCodeY, { align: 'left' });

  // Rahmen (PRINT + WALL)
  doc.lineWidth(1).strokeColor('#444').rect(dispX, dispY, dispW, dispH).stroke();
  try {
    const ratioW = (printW > 0) ? (wallW / printW) : 1;
    const ratioH = (printH > 0) ? (wallH / printH) : 1;
    const innerW = Math.max(2, Math.round(dispW * ratioW));
    const innerH = Math.max(2, Math.round(dispH * ratioH));
    const innerX = Math.round(dispX + (dispW - innerW) / 2);
    const innerY = Math.round(dispY + (dispH - innerH) / 2);
    doc.lineWidth(2).strokeColor('#c00').rect(innerX, innerY, innerW, innerH).stroke();
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
