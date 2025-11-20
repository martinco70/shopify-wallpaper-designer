#!/usr/bin/env node
/*
  Generate a PDF from docs/TECHNICAL-DESIGN.md using PDFKit.
  Minimal formatting: title, sections, monospaced for code blocks, wrap text.
*/
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

function readMarkdown(file){
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
}

function drawHeader(doc, text){
  doc.fontSize(18).font('Helvetica-Bold').text(text, { align: 'left' });
  doc.moveDown(0.5);
}

function drawParagraph(doc, text){
  doc.fontSize(10).font('Helvetica').text(text, { align: 'left' });
}

function drawCode(doc, text){
  doc.moveDown(0.3);
  doc.font('Courier').fontSize(9);
  const lines = String(text).split('\n');
  lines.forEach(l => doc.text(l));
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10);
}

function renderMarkdown(doc, md){
  const lines = md.split(/\r?\n/);
  let inCode = false;
  let codeBuffer = [];
  for (let i=0;i<lines.length;i++){
    const line = lines[i];
    if (line.startsWith('```')){
      if (!inCode) { inCode = true; codeBuffer = []; }
      else { inCode = false; drawCode(doc, codeBuffer.join('\n')); codeBuffer = []; }
      continue;
    }
    if (inCode) { codeBuffer.push(line); continue; }

    const h1 = /^#\s+(.*)/.exec(line);
    const h2 = /^##\s+(.*)/.exec(line);
    const h3 = /^###\s+(.*)/.exec(line);
    if (h1) { drawHeader(doc, h1[1]); continue; }
    if (h2) { doc.moveDown(0.6); doc.fontSize(14).font('Helvetica-Bold').text(h2[1]); doc.moveDown(0.2); continue; }
    if (h3) { doc.moveDown(0.4); doc.fontSize(12).font('Helvetica-Bold').text(h3[1]); doc.moveDown(0.1); continue; }

    // bullet lists
    const bullet = /^-\s+(.*)/.exec(line);
    if (bullet) { doc.font('Helvetica').fontSize(10).text('• ' + bullet[1]); continue; }

    if (line.trim() === '') { doc.moveDown(0.3); continue; }
    drawParagraph(doc, line);
  }
}

(function main(){
  const projectRoot = path.resolve(__dirname, '..', '..');
  const mdPath = path.join(projectRoot, 'docs', 'TECHNICAL-DESIGN.md');
  const outPath = path.join(projectRoot, 'docs', 'Projekt-Dokumentation.pdf');
  const md = readMarkdown(mdPath);
  if (!md) {
    console.error('Markdown nicht gefunden:', mdPath);
    process.exit(1);
  }

  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  drawHeader(doc, 'Projekt-Dokumentation – Shopify Wallpaper Designer');
  doc.fontSize(9).text('Stand: ' + new Date().toISOString());
  doc.moveDown(0.8);

  renderMarkdown(doc, md);

  doc.end();
  stream.on('finish', () => {
    console.log('PDF erstellt:', outPath);
  });
})();
