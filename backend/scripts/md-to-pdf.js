#!/usr/bin/env node
/*
  Generic Markdown → PDF generator using PDFKit.
  Usage:
    node backend/scripts/md-to-pdf.js --in docs/SHOPIFY-BILDIMPORT-ANLEITUNG.md --out docs/Shopify-Bildimport-Anleitung.pdf
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
  // parse args
  const args = process.argv.slice(2);
  const getArg = (name, def=null) => {
    const i = args.indexOf(name);
    if (i !== -1 && args[i+1]) return args[i+1];
    const pref = name.replace(/^--/, '');
    const alt = args.find(a => a.startsWith(pref+'='));
    if (alt) return alt.split('=')[1];
    return def;
  };
  let inPath = getArg('--in');
  let outPath = getArg('--out');
  if (!inPath) {
    console.error('Usage: node backend/scripts/md-to-pdf.js --in <markdownFile> --out <pdfFile>');
    process.exit(1);
  }
  if (!outPath) {
    const base = path.basename(inPath).replace(/\.md$/i, '') || 'Dokument';
    outPath = path.join('docs', base + '.pdf');
  }
  // resolve relative to project root
  const mdPath = path.isAbsolute(inPath) ? inPath : path.join(projectRoot, inPath);
  const pdfPath = path.isAbsolute(outPath) ? outPath : path.join(projectRoot, outPath);
  const md = readMarkdown(mdPath);
  if (!md) {
    console.error('Markdown nicht gefunden:', mdPath);
    process.exit(1);
  }

  // ensure out dir
  try { fs.mkdirSync(path.dirname(pdfPath), { recursive: true }); } catch {}

  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  // Title from first H1 or filename
  const h1Match = /^#\s+(.+)$/m.exec(md);
  const title = h1Match ? h1Match[1].trim() : path.basename(mdPath).replace(/\.md$/i, '');
  drawHeader(doc, title);
  doc.fontSize(9).text('Stand: ' + new Date().toLocaleString());
  doc.moveDown(0.8);

  renderMarkdown(doc, md);

  doc.end();
  stream.on('finish', () => {
    console.log('PDF erstellt:', pdfPath);
  });
})();
