// Script erzeugt eine kombinierte PDF-Dokumentation für den Tapetendesigner
// Verwendung: node backend/scripts/generate-designer-docs.js
// Ergebnis: backend/docs/TAPETENDESIGNER-DOKU.pdf

const fs = require('fs');
const path = require('path');
let PDFDocument;
try { PDFDocument = require('pdfkit'); } catch (e) {
  console.error('pdfkit nicht installiert. Bitte im backend Ordner: npm install');
  process.exit(1);
}

const OUT_PATH = path.join(__dirname, '..', 'docs', 'TAPETENDESIGNER-DOKU.pdf');

function sectionTitle(doc, text) {
  doc.moveDown(0.5);
  doc.fontSize(18).fillColor('#000').text(text, { underline: false });
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor('#222');
}
function bullet(doc, text) {
  doc.fontSize(11).fillColor('#222').text('\u2022 ' + text); }
function codeBlock(doc, lines) {
  doc.fontSize(9).fillColor('#111').text(lines.join('\n'), { width: doc.page.width - doc.page.margins.left * 2, underline: false });
  doc.moveDown(0.3);
}

const doc = new PDFDocument({ size: 'A4', margin: 48 });
const writeStream = fs.createWriteStream(OUT_PATH);
doc.pipe(writeStream);

// Meta Header
sectionTitle(doc, 'Tapetendesigner – Dokumentation');
doc.fontSize(12).fillColor('#555').text('Stand: ' + new Date().toLocaleDateString('de-CH') + '\nProjekt: Shopify Wallpaper Designer');
doc.moveDown(0.8);

// 1) Laien-Erklärung
sectionTitle(doc, 'Teil 1 – Einfache Erklärung (für Anwender)');
const layIntro = [
  'Der Tapetendesigner erlaubt dir, eine individuelle Fototapete anhand deiner Wandmasse zu gestalten.',
  'Du gibst zuerst die Wandbreite und Wandhöhe ein. Das System berechnet automatisch das Druckmass (ganze Bahnen) und zeigt dir die sichtbare Bildbreite (Wand + 10 cm Sichtreserve).',
  'Die schraffierte graue Fläche zeigt das Übermass: Dieser Bereich wird nicht bedruckt, weil wir nur ganze Bahnen verwenden.',
  'Du kannst das Bild hochladen (JPG, PNG, TIFF, PDF, SVG, EPS). Danach kannst du mit der Maus das Motiv verschieben und mit dem Zoomregler vergrößern/verkleinern.',
  'Die gelben gestrichelten Linien zeigen die Bahnen-Grenzen. So siehst du, wo später geschnitten/gesetzt wird.',
  'Mit dem Button "Übermass links/rechts" entscheidest du, auf welcher Seite das unbedruckte Übermass sein soll.',
  'Der rote Rahmen zeigt das Wandmass. Innerhalb dieses Rahmens muss dein Motiv Platz finden. Das Bild selbst wird nur im sichtbaren Bereich (Wand + 10 cm) dargestellt.',
  'Wenn alles passt, generierst du einen Code (Konfigurationscode). Mit diesem Code kannst du später im Shop oder bei Nachfragen genau dieselbe Konfiguration wieder laden.',
  'Der Button für den PDF-Proof erstellt ein "Gut zum Druck" Dokument: Das PDF zeigt Ausschnitt, Maße, Bahnenlinien und Übermass so wie im Designer. Dieses Dokument dient als finale Freigabe.',
  'Im PDF ist der schraffierte Bereich immer weiß hinterlegt und nicht bedruckt; so wird sichergestellt, dass kein Teil des Motivs dort versehentlich erscheint.'
];
layIntro.forEach(line => doc.fontSize(11).fillColor('#222').text(line));
doc.moveDown(0.6);

bullet(doc, 'Wandmass: Deine eigentliche Wandfläche.');
bullet(doc, 'Bildmass: Wandbreite + 10 cm Reserve – nur dieser Bereich zeigt das Motiv.');
bullet(doc, 'Druckmass: Ganze Bahnenbreite, kann breiter sein als das Bildmass.');
bullet(doc, 'Übermass: Differenz zwischen Druckmass und Bildmass, schraffiert und unbedruckt.');
bullet(doc, 'Zoom: Vergrößert das Motiv – achte auf ausreichende Bildqualität.');
bullet(doc, 'Offsets: Verschieben des Ausschnitts (durch Drag).');
bullet(doc, 'Konfigurationscode: Referenz zum Wiederladen und für die Produktion.');
doc.moveDown(0.8);

// 2) Entwickler-Dokumentation
sectionTitle(doc, 'Teil 2 – Technische Dokumentation (für Entwickler)');
doc.fontSize(11).fillColor('#222').text('Ziel: Verständnis der internen Datenflüsse, Berechnungen und Erweiterungsmöglichkeiten.');
doc.moveDown(0.6);

sectionTitle(doc, 'Architektur-Überblick');
const arch = [
  'Frontend (React, Datei: frontend/src/index.js) – enthält die Hauptkomponente FrameDesigner. Hier werden Dimensionen berechnet, Bild geladen, Zoom/Drag/Flip und sichtbare Bereiche gehandhabt.',
  'Backend (Express, pdfProof.js) – erzeugt den PDF-Proof, lädt Bilddaten, berechnet sichtbare Bereiche und zeichnet Clip + Weiß + Schraffur.',
  'Persistenz: Konfigurationen werden als Dateien gespeichert (configStore). Transform-Informationen (zoom, offsetXPct, offsetYPct, naturalWidth/Height) werden mit abgelegt.',
  'Keine serverseitigen Crops mehr: PDF spiegelt 1:1 die UI-Cover-Logik (scale + zoom + offsets + clip).',
];
arch.forEach(l => doc.text(l));
doc.moveDown(0.6);

sectionTitle(doc, 'Maß-Definitionen');
bullet(doc, 'wall.widthCm (Wandmass) & wall.heightCm');
bullet(doc, 'print.widthCm / print.heightCm (Druckmass = volle Bahnen)');
bullet(doc, 'Bildmass = wall.widthCm + 10 cm (sichtbarer Motivbereich)');
bullet(doc, 'extraWhiteWidthCm = print.widthCm − (wall.widthCm + 10)');
bullet(doc, 'overageSide: left | right – bestimmt Position des Übermaßbereichs');
doc.moveDown(0.6);

sectionTitle(doc, 'Transform-Daten');
const transform = [
  'zoom: Multiplikator auf die Cover-Skalierung (Basis: sichtbares Bildmass vs. Wandhöhe).',
  'offsetXPct / offsetYPct: Relative Mittelpunkt-Offsets (0..1) bezogen auf die gezoomte, gescalte Naturalgröße.',
  'flipH / flipV: Horizontale / vertikale Spiegelung – im PDF per sharp.flop()/flip().',
  'naturalWidth / naturalHeight: Originalbildgröße (Pixel), für Qualitäts- und Zoomberechnung wichtig.'
];
transform.forEach(l => doc.text(l));
doc.moveDown(0.6);

sectionTitle(doc, 'Positionsberechnung (UI & PDF)');
const pos = [
  '1. Berechne scale s = max(visibleWidthPx / naturalWidthPx, frameHeightPx / naturalHeightPx); deckel s auf 1.',
  '2. Effektive Zeichengröße: drawW = naturalWidthPx * s * zoom; drawH analog.',
  '3. Mittelpunkt im sichtbaren Bereich: centerX = offsetXPct * drawW; centerY analog.',
  '4. Linke obere Bild-Ecke: posX = clipLeft + clipWidth/2 − centerX; posY = frameTop + clipHeight/2 − centerY.',
  '5. Clip-Rechteck deckt Bildmass ab; außerhalb liegt Übermass (weiß + Schraffur).',
];
pos.forEach(l => doc.text(l));
doc.moveDown(0.6);

sectionTitle(doc, 'PDF-spezifische Schritte (pdfProof.js)');
const pdfSteps = [
  'Lädt Bildpuffer (preview oder originalUrl).',
  'Wendet Flip an (sharp.rotate/flop/flip).',
  'Berechnet extraWhiteCm Fallback: (printW - (wallW + 10)).',
  'Berechnet Clip-Koordinaten abhängig von overageSide.',
  'Weißes Rechteck als Unterlage im Clip, dann Bild mit drawW/drawH an posX/posY.',
  'Übermassbereich: doppelte Weißfüllung + diagonale Schraffur + dünne Edge-Linie.',
  'Bahnenlinien: gestrichelte vertikale Linien relativ zum sichtbaren Bereich (stripWidthCm * i).'
];
pdfSteps.forEach(l => doc.text(l));
doc.moveDown(0.6);

sectionTitle(doc, 'Erweiterungshinweise');
bullet(doc, 'Zusätzliche Effekte (z.B. Farbfilter) im Frontend über eine Canvas-Layer vor dem Upload anwenden.');
bullet(doc, 'Weitere Ausgabeformate: eigenen Endpoint erstellen, pdfProof-Logik wiederverwenden, ggf. Rasterisierung beibehalten.');
bullet(doc, 'Qualitätshinweis verfeinern: effW/effH vs. Mindest-Pixel pro cm dynamisch loggen.');
bullet(doc, 'Testing: Unit-Tests für Transform-Berechnung (Offsets bei Flip, Zoom-Grenzen).');
bullet(doc, 'Internationalisierung: Texte in separater JSON und per Key injizieren.');
doc.moveDown(0.6);

sectionTitle(doc, 'Fehlerquellen & Debugging');
bullet(doc, 'Versatz nach Reload: Prüfe Rehydration der Offsets (offsetXPct/offsetYPct) + zoom.');
bullet(doc, 'Bild erscheint im Übermass: Clip-Breite korrekt? extraWhiteCm korrekt (print - (wall + 10))?');
bullet(doc, 'Falsche Bahnenlinien: stripsCount oder bahnenbreiteCm fehlen / Rundung in px überprüfen.');
bullet(doc, 'Qualität zu gering: Ursprungsbild prüfen (naturalWidth/Height) und zoom > 1 kritisch hinterfragen.');

sectionTitle(doc, 'Dateien & Einstiegspunkte');
codeBlock(doc, [
  'frontend/src/index.js         -> FrameDesigner + UI-Logik',
  'backend/services/pdfProof.js  -> PDF-Erzeugung (Proof)',
  'backend/services/configStore.js -> Speichern/Laden von Konfigurationen',
  'backend/index.js              -> API-Routen (Konfig, PDF)',
  'scripts/backup.ps1 / restore.ps1 -> Snapshots',
]);

sectionTitle(doc, 'API Felder (vereinfachter Auszug)');
codeBlock(doc, [
  'POST /config {',
  '  wall: { widthCm, heightCm },',
  '  print: { widthCm, heightCm },',
  '  calc: { mode, bahnenbreiteCm, extraWhiteWidthCm, overageSide, strips },',
  '  transform: { zoom, offsetXPct, offsetYPct, flipH, flipV, naturalWidth, naturalHeight },',
  '  image: { url, preview, originalUrl, filename }',
  '}',
]);

sectionTitle(doc, 'Wichtige Konstanten');
codeBlock(doc, [
  'Bildmass = Wandbreite + 10 cm',
  'extraWhite = Druckbreite - Bildmass',
  'Offsets beziehen sich IMMER auf die gezoomte, gescalte Naturalgröße',
  'Zoom deckelbar (Frontend: 1..3)',
]);

sectionTitle(doc, 'Qualitätshinweis (Berechnung)');
codeBlock(doc, [
  'effektivePixelBreite = naturalWidth / zoom',
  'erforderlichMin = wandBreiteCm * 15 (z.B. Schwelle für Orange)',
  'Schwellen anpassbar in Disclaimer-Logik pdfProof.js',
]);

sectionTitle(doc, 'Restore dieses Standes');
codeBlock(doc, [
  'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restore.ps1 -ZipPath snapshots/20251112-...-pdf-visible-cover-20251112.zip'
]);

sectionTitle(doc, 'Lizenz / Rechte');
doc.fontSize(9).fillColor('#444').text('Alle Bildrechte müssen beim Besteller liegen. Der Code im PDF repräsentiert die Freigabe (Gut zum Druck).');

// Fertig
try { doc.end(); } catch (e) { console.error('Fehler beim PDF-Schließen:', e); }
writeStream.on('finish', () => {
  console.log('Dokument erzeugt:', OUT_PATH);
});
