#!/usr/bin/env node
/**
 * Generate variant metafield export (XLSX + CSV) from an existing results-*.json
 * Usage:
 *   node scripts/generate-export-from-results.js --input exports/results-*.json
 *   # or without --input, the script will pick the newest results-*.json in backend/exports
 */
const fs = require('fs');
const path = require('path');

// XLSX is optional; if missing, we will only write CSV
let XLSX = null; try { XLSX = require('xlsx'); } catch (_) {}

function parseArgs(argv){
  const out = {}; let key = null;
  for (const a of argv.slice(2)){
    if (a.startsWith('--')) { key = a.replace(/^--/, ''); out[key] = true; continue; }
    if (key) { out[key] = a; key = null; } else { (out._ || (out._=[])).push(a); }
  }
  return out;
}

function newestResultsJson(exportsDir){
  const files = fs.readdirSync(exportsDir).filter(f => /^results-\d+\.json$/i.test(f));
  if (!files.length) return null;
  files.sort((a,b)=>{ const na=Number(a.match(/(\d+)/)[1]); const nb=Number(b.match(/(\d+)/)[1]); return nb-na; });
  return path.join(exportsDir, files[0]);
}

function toCsv(rows){
  const headers = ['handle','variant metafield:custom.wd-picture','variant sku','variant command','ok'];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
  };
  const out = [headers.join(',')];
  for (const r of rows){ out.push(headers.map(h => esc(r[h])).join(',')); }
  return out.join('\r\n');
}

function buildRowsFromResults(data){
  const results = Array.isArray(data?.results) ? data.results : [];
  // Prefer only entries which explicitly requested wd_picture or already set it; otherwise fallback to all ok entries
  let cand = results.filter(r => r && r.ok && r.src && (r.wd_picture === true || r.wd_picture_set === true));
  if (!cand.length) cand = results.filter(r => r && r.ok && r.src);
  const rows = [];
  const seen = new Set();
  for (const r of cand){
    const handle = String(r.handle || '').trim();
    const sku = r.sku == null ? '' : String(r.sku).trim();
    const url = String(r.src || '').trim();
    if (!handle || !url) continue;
    const key = (sku ? `${handle}::${sku}` : `${handle}`);
    if (seen.has(key)) continue; // dedupe by handle+sku (or handle alone if sku empty)
    seen.add(key);
    rows.push({
      'handle': handle,
      'variant metafield:custom.wd-picture': url,
      'variant sku': sku,
      'variant command': 'MERGE',
      'ok': Boolean(r.ok)
    });
  }
  return rows;
}

async function main(){
  const args = parseArgs(process.argv);
  const root = path.join(__dirname, '..');
  const exportsDir = path.join(root, 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }
  let inputPath = args.input ? String(args.input) : null;
  if (inputPath && !path.isAbsolute(inputPath)) inputPath = path.join(root, inputPath);
  if (!inputPath) inputPath = newestResultsJson(exportsDir);
  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error('Kein results-*.json gefunden. Bitte mit --input <Pfad> angeben.');
    process.exit(1);
  }
  const raw = fs.readFileSync(inputPath, 'utf8');
  let data; try { data = JSON.parse(raw); } catch (e) { console.error('JSON konnte nicht gelesen werden:', e.message); process.exit(1); }
  const gen = Number(data?.generatedAt) || Date.now();
  const suffix = String(gen);
  const rows = buildRowsFromResults(data);
  if (!rows.length){
    console.error('Keine geeigneten Zeilen gefunden (ok + src). Abbruch.');
    process.exit(2);
  }
  // Write CSV
  const csvName = `wd-picture-variant-export-from-results-${suffix}.csv`;
  const csvPath = path.join(exportsDir, csvName);
  fs.writeFileSync(csvPath, toCsv(rows), 'utf8');
  let xlsxPath = null;
  if (XLSX){
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows, { header: ['handle','variant metafield:custom.wd-picture','variant sku','variant command','ok'] });
    XLSX.utils.book_append_sheet(wb, ws, 'wd-picture');
    const xlsxName = `wd-picture-variant-export-from-results-${suffix}.xlsx`;
    xlsxPath = path.join(exportsDir, xlsxName);
    XLSX.writeFile(wb, xlsxPath);
  }
  console.log(JSON.stringify({
    ok: true,
    input: path.relative(root, inputPath).replace(/\\/g,'/'),
    rows: rows.length,
    csv: `/exports/${path.basename(csvPath)}`,
    xlsx: xlsxPath ? `/exports/${path.basename(xlsxPath)}` : null
  }, null, 2));
}

main().catch(e => { console.error(e?.stack || e?.message || String(e)); process.exit(1); });
