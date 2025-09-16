// Einfaches Backup-Script: kopiert zentrale Dateien in backups/ mit Zeitstempel
const fs = require('fs');
const path = require('path');
const srcDir = __dirname + '/../';
const outRoot = path.join(srcDir, 'backups');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(outRoot, ts);

function ensure(p){ if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); }
ensure(outDir);

const filesToCopy = [ 'index.js', 'package.json' ];
// leichte Erweiterung: configs JSON Liste (nur Metadaten, keine großen Bilder)
const configsDir = path.join(srcDir, 'configs');
let configFiles = [];
try { configFiles = fs.readdirSync(configsDir).filter(f=>f.endsWith('.json')).slice(0,200); } catch {}

for (const f of filesToCopy) {
  try { fs.copyFileSync(path.join(srcDir,f), path.join(outDir,f)); } catch(e){ console.warn('skip', f, e.message); }
}
for (const cf of configFiles) {
  try { ensure(path.join(outDir,'configs')); fs.copyFileSync(path.join(configsDir, cf), path.join(outDir,'configs', cf)); } catch(e){ console.warn('skip config', cf, e.message); }
}
console.log('Backup erstellt in', outDir);
