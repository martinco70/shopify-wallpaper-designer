const PDFDocument = (()=>{ try { return require('pdfkit'); } catch { return null; } })();
const path = require('path');
const fs = require('fs');
const sharp = (()=>{ try { return require('sharp'); } catch { return null; } })();
const https = require('https');
const http = require('http');
const { cfg } = require('./configStore');

// Konstante für Punkt-zu-Zentimeter (1in = 2.54cm, 72pt / in)
const PT_PER_CM = 72 / 2.54;

async function fetchBuffer(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    try {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, (resp) => {
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          return fetchBuffer(resp.headers.location, timeoutMs).then(resolve, reject);
        }
        if (resp.statusCode !== 200) return reject(new Error('http_'+resp.statusCode));
        const chunks = []; resp.on('data', c=>chunks.push(c)); resp.on('end', ()=>resolve(Buffer.concat(chunks)));
      });
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => { try { req.destroy(new Error('timeout')); } catch {}; reject(new Error('timeout')); });
    } catch(e){ reject(e); }
  });
}

async function buildProofPdf(data, { code, baseUrl }) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const margin = doc.page.margins.left;

  // Titel & Produktname zentriert + Logo rechts
  const titleText = 'Gut zum Druck';
  doc.fontSize(20).fillColor('#000').text(titleText, { align: 'left' });
  const titleTopY = doc.y - doc.currentLineHeight();
  const afterTitleY = doc.y;
  let productTitle = null;
  try {
    const ctx = data.context || {};
    productTitle = ctx.productTitle || ctx.product || ctx.name || null;
  } catch {}
  if (!productTitle) {
    const imgUrl0 = (data.image && data.image.url) ? String(data.image.url) : '';
    if (imgUrl0) {
      const fname = imgUrl0.split(/[?#]/)[0].split('/').pop();
      if (fname) productTitle = fname;
    }
  }
  if (!productTitle) productTitle = 'Ohne Titel';
  doc.fontSize(14).fillColor('#222').text(productTitle, margin, titleTopY, { width: pageWidth - margin*2, align: 'center' });
  doc.y = afterTitleY;
  // Logo (falls vorhanden, statischer Pfad oder env)
  try {
    const logoPath = process.env.PDF_LOGO_PATH || path.join(process.cwd(), 'Wirz_mit_Claim_Pixel_RGB.jpg');
    if (fs.existsSync(logoPath)) {
      const logoH = 70; const logoX = pageWidth - margin - 100; const logoY = Math.max(margin - 4, titleTopY - 20);
      doc.image(logoPath, logoX, logoY, { height: logoH });
    }
  } catch {}

  const green = '#138136';
  doc.moveDown(0.2);
  doc.fontSize(12).fillColor(green).text(`Code: ${code}`);
  doc.moveDown(0.3);

  // Bild-Block: 750x500 bei (40,20)
  const wall = data.wall || {}; const print = data.print || {}; const transform = data.transform || {}; const img = data.image || {};
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

  // Bild laden (cover) wenn möglich
  const imageUrlRaw = img.url ? String(img.url) : '';
  let resolvedImageUrl = null;
  if (imageUrlRaw) {
    if (/^https?:\/\//i.test(imageUrlRaw)) resolvedImageUrl = imageUrlRaw; else if (imageUrlRaw.startsWith('/')) resolvedImageUrl = `${baseUrl}${imageUrlRaw}`; else resolvedImageUrl = `${baseUrl}/${imageUrlRaw}`;
  }
  if (resolvedImageUrl && sharp) {
    try {
      const buf = await fetchBuffer(resolvedImageUrl);
      const meta = await sharp(buf).metadata();
      const iw = Math.max(1, meta.width || 1);
      const ih = Math.max(1, meta.height || 1);
      const zoom = Number(transform.zoom || 1) || 1;
      const flipH = !!transform.flipH; const flipV = !!transform.flipV;
      const cover = Math.max(frameW / iw, frameH / ih) * zoom;
      const drawW = iw * cover; const drawH = ih * cover;
      const imgX = frameX + (frameW - drawW) / 2; const imgY = frameY + (frameH - drawH) / 2;
      doc.save(); doc.rect(frameX, frameY, frameW, frameH).clip();
      if (flipH || flipV) {
        doc.save(); doc.translate(imgX + (flipH ? drawW : 0), imgY + (flipV ? drawH : 0)).scale(flipH ? -1 : 1, flipV ? -1 : 1); doc.image(buf, 0, 0, { width: drawW, height: drawH }); doc.restore();
      } else { doc.image(buf, imgX, imgY, { width: drawW, height: drawH }); }
      doc.restore();
    } catch {}
  }
  // Außenrahmen (Wand) rot
  doc.lineWidth(1).strokeColor('#c00').rect(frameX, frameY, frameW, frameH).stroke();
  // Innerer Druckrahmen gestrichelt grau falls unterschiedlich
  if (printWcm > 0 && printHcm > 0 && (printWcm !== wallWcm || printHcm !== wallHcm) && wallWptRaw > 0 && wallHptRaw > 0) {
    const printWptRaw = printWcm * PT_PER_CM; const printHptRaw = printHcm * PT_PER_CM;
    const pW = Math.max(4, Math.round(printWptRaw * frameScale)); const pH = Math.max(4, Math.round(printHptRaw * frameScale));
    const pX = frameX + (frameW - pW) / 2; const pY = frameY + (frameH - pH) / 2;
    doc.save(); doc.lineWidth(0.5).dash(4, { space: 3 }).strokeColor('#555').rect(pX, pY, pW, pH).stroke(); doc.restore();
  }
  // Breitenlabels übereinander (Wand näher am Rahmen)
  doc.fontSize(10);
  const lineHLabel = doc.currentLineHeight();
  if (wallWcm > 0) {
    const wandTxt = `Wandmass Breite: ${wallWcm} cm`;
    const tw = doc.widthOfString(wandTxt) + 10; const tx = frameX + (frameW - tw) / 2; const ty = frameY - 2 - lineHLabel;
    doc.save(); doc.rect(tx, ty - 2, tw, lineHLabel + 4).fill('#FFFFFF'); doc.fillColor('#000').text(wandTxt, tx + 5, ty, { width: tw - 10, align: 'center' }); doc.restore();
    if (printWcm > 0) {
      const druckTxt = `Druckmass Breite: ${printWcm} cm`;
      const tw2 = doc.widthOfString(druckTxt) + 10; const tx2 = frameX + (frameW - tw2) / 2; const ty2 = ty - 2 - lineHLabel;
      doc.save(); doc.rect(tx2, ty2 - 2, tw2, lineHLabel + 4).fill('#FFFFFF'); doc.fillColor('#000').text(druckTxt, tx2 + 5, ty2, { width: tw2 - 10, align: 'center' }); doc.restore();
    }
  }
  // Vertikale Höhenlabels links rotiert (-90°), Druck näher am Rahmen
  const drawVerticalHeightLabel = (label, order) => {
    if (!label) return;
    doc.save(); doc.fontSize(10).fillColor('#000');
    const tw = doc.widthOfString(label) + 8; const th = doc.currentLineHeight();
    const gapFromFrame = 2 + order * (th + 10);
    doc.translate(frameX - gapFromFrame - th - 4, frameY + frameH / 2).rotate(-90);
    const bgW = th + 4; const bgH = tw + 4; const rx = -bgW / 2; const ry = -bgH / 2;
    doc.rect(rx, ry, bgW, bgH).fill('#FFFFFF'); doc.fillColor('#000').text(label, rx + 2, ry + 2, { width: bgW - 4, align: 'center' }); doc.restore();
  };
  if (printHcm > 0) drawVerticalHeightLabel(`Druckmass Höhe: ${printHcm} cm`, 0);
  if (wallHcm > 0) drawVerticalHeightLabel(`Wandmass Höhe: ${wallHcm} cm`, 1);

  // Tabellen unterhalb (Masse / Preis) möglichst weit nach unten – Disclaimer berücksichtigen
  const disclaimerText = 'Der Besteller ist für die Masse, das Layout und den Ausschnitt verantwortlich und bestätigt dies ausdrücklich durch das Einreichen dieses Gut zum Druck (Code im Warenkorb/Bestellbestätigung). Der Auftrag wird direkt an die Produktion übermittelt und kann nicht mehr geändert werden.';
  doc.fontSize(10);
  const disclaimerHeight = doc.heightOfString(disclaimerText, { width: pageWidth - margin * 2 });
  const lineH = 18; const leftRowsCount = 3; const rightRowsCount = 3; const tableTitleH = 18;
  const estLeftTableH = tableTitleH + leftRowsCount * lineH + 6; const estRightTableH = tableTitleH + rightRowsCount * lineH + 6;
  const tablesH = Math.max(estLeftTableH, estRightTableH);
  const gapAboveDisclaimer = 18;
  const belowY = pageHeight - margin - disclaimerHeight - gapAboveDisclaimer - tablesH;
  doc.y = belowY;
  const colGap = 32; const desiredColW = 170; const colW = desiredColW;
  function drawTable(x, y, title, rows) {
    const lineH = 18; let y0 = y; doc.fontSize(12).fillColor('#000').text(title, x, y); y += lineH; doc.fontSize(10).fillColor('#333');
    for (const [label, value] of rows) { doc.text(label, x, y, { width: colW * 0.5 }); doc.text(String(value ?? ''), x + colW * 0.5 + 8, y, { width: colW * 0.5 - 8, align: 'right' }); y += lineH; doc.moveTo(x, y - 4).lineTo(x + colW, y - 4).strokeColor('#eee').lineWidth(1).stroke(); }
    return { height: y - y0 };
  }
  const widthCm = Math.round(Number(wall.widthCm) || 0);
  const heightCm = Math.round(Number(wall.heightCm) || 0);
  const printW = Math.round(Number(print.widthCm) || widthCm);
  const printH = Math.round(Number(print.heightCm) || heightCm);
  const areaM2 = Number(data.areaM2 || ((printW / 100) * (printH / 100))).toFixed(3);
  const pricePerM2 = (data.price && data.price.perM2 != null) ? Number(data.price.perM2) : null;
  const totalPrice = (data.price && data.price.total != null) ? Number(data.price.total) : (pricePerM2 != null ? Number((pricePerM2 * Number(areaM2)).toFixed(2)) : null);
  const zoomFactor = Number(transform.zoom || 1) || 1;
  const leftRows = [ ['Wandmass (B x H)', `${widthCm} x ${heightCm} cm`], ['Druckmass (B x H)', `${printW} x ${printH} cm`], ['Zoom', `${zoomFactor.toFixed(2)}x`] ];
  const rightRows = [ ['Total Fläche', `${areaM2} m²`], ['Preis pro m²', pricePerM2 != null ? `CHF ${Number(pricePerM2).toFixed(2)}` : '–'], ['Gesamtpreis', totalPrice != null ? `CHF ${Number(totalPrice).toFixed(2)}` : '–'] ];
  const instrDesiredW = 260; const thirdGap = colGap; let instrColW = instrDesiredW; let groupWidth = colW + colGap + colW + thirdGap + instrColW;
  if (groupWidth > pageWidth - margin * 2) { instrColW = Math.max(140, (pageWidth - margin * 2) - (colW + colGap + colW + thirdGap)); groupWidth = colW + colGap + colW + thirdGap + instrColW; }
  const groupStartX = Math.round((pageWidth - groupWidth) / 2);
  const col1X = groupStartX; const col2X = col1X + colW + colGap; const instrX = col2X + colW + thirdGap;
  drawTable(col1X, belowY, 'Masse', leftRows); drawTable(col2X, belowY, 'Preisrechner', rightRows);
  const totalFlaecheRowY = belowY + 18; const instrText = `Diese Konfiguration kann jederzeit mit dem Code ${code} wieder aufgerufen werden.`;
  doc.fontSize(10).fillColor(green).text(instrText, instrX, totalFlaecheRowY, { width: instrColW, align: 'left' });

  // Disclaimer (rot) ganz unten
  const footerY = pageHeight - margin - disclaimerHeight;
  doc.fontSize(10).fillColor('#c00').text(disclaimerText, margin, footerY, { width: pageWidth - margin * 2, align: 'left' });

  return doc;
}

function registerPdfRoute(app) {
  app.get('/config/:id/pdf', async (req, res) => {
    try {
      const rawId = String(req.params.id || '').trim();
      let id = rawId;
      if (!rawId.includes('-') && rawId.length <= 12) {
        const via = cfg.idFromCode(rawId); if (via) id = via;
      }
      const data = cfg.readConfig(id); const code = cfg.shortCodeFrom(id);
      if (!PDFDocument) {
        res.status(501).type('text/plain').send('PDFKit nicht installiert'); return;
      }
      const baseUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
      const doc = await buildProofPdf(data, { code, baseUrl });
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${code}.pdf"`);
      doc.pipe(res); doc.end();
    } catch (e) {
      console.error('[pdf] failed', e?.message || e); return res.status(404).type('text/plain').send('Konfiguration nicht gefunden');
    }
  });
}

module.exports = { registerPdfRoute, buildProofPdf };
