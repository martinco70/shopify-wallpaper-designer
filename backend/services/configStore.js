const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_DIR = path.join(__dirname, '..', 'configs');
try { if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true }); } catch (_ignore) {}

const codeIndex = new Map();

function randomId() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch(_ignore) {}
  const chars = 'abcdef0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}
function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}
function fileFor(id) { return path.join(CONFIG_DIR, `${id}.json`); }

function findConfigIdByCodeFromDisk(code) {
  try {
    const target = String(code || '').toUpperCase();
    const files = fs.readdirSync(CONFIG_DIR).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const p = path.join(CONFIG_DIR, f);
        const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (obj && obj.code && String(obj.code).toUpperCase() === target) {
          return obj.id || f.replace(/\.json$/,'');
        }
      } catch(_ignore) {}
    }
  } catch(_ignore) {}
  return null;
}

const cfg = {
  create(obj) {
    const id = randomId();
    const code = randomCode();
    const now = Date.now();
    const rec = { id, code, createdAt: now, ...(obj || {}) };
    try { fs.writeFileSync(fileFor(id), JSON.stringify(rec, null, 2)); } catch(_ignore) {}
    try { codeIndex.set(String(code).toUpperCase(), id); } catch(_ignore) {}
    return { id, code };
  },
  readConfig(id) {
    const p = fileFor(id);
    const raw = fs.readFileSync(p, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj.code) {
      obj.code = randomCode();
      try { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); } catch(_ignore) {}
    }
    try { codeIndex.set(String(obj.code).toUpperCase(), id); } catch(_ignore) {}
    return obj;
  },
  shortCodeFrom(id) {
    try {
      const obj = JSON.parse(fs.readFileSync(fileFor(id), 'utf8'));
      return obj.code || String(id).slice(0, 6).toUpperCase();
    } catch(_ignore) { return String(id).slice(0, 6).toUpperCase(); }
  },
  idFromCode(code) {
    if (!code) return null;
    const c = String(code).toUpperCase();
    if (codeIndex.has(c)) return codeIndex.get(c);
    const fromDisk = findConfigIdByCodeFromDisk(c);
    if (fromDisk) { codeIndex.set(c, fromDisk); return fromDisk; }
    return null;
  },
  verifyToken(t) {
    try {
      const s = String(t || '');
      if (/^[0-9a-fA-F-]{8,}$/.test(s)) return { ok: true, id: s };
      const via = cfg.idFromCode(s);
      if (via) return { ok: true, id: via };
      return { ok: false };
    } catch(_ignore) { return { ok: false }; }
  }
};

module.exports = { cfg };
