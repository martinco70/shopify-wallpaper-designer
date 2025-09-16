const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'configs');
function ensureDir(p) { try { fs.mkdirSync(p, { recursive: true }); } catch(_) {} }
ensureDir(DATA_DIR);

function genId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Fallback: time-based with random suffix
  return (
    Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
  ).toUpperCase();
}

function shortCodeFrom(id) {
  // Simple readable code: take alnum only, group, keep 4-6 chars random slice
  const base = String(id).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const slice = base.slice(-6);
  return `WPD-${slice}`;
}

function configPath(id) {
  return path.join(DATA_DIR, id, 'config.json');
}

function readConfig(id) {
  const p = configPath(id);
  const txt = fs.readFileSync(p, 'utf8');
  return JSON.parse(txt);
}

function writeConfig(id, obj) {
  const dir = path.dirname(configPath(id));
  ensureDir(dir);
  fs.writeFileSync(configPath(id), JSON.stringify(obj, null, 2), 'utf8');
}

function createConfig(payload) {
  const id = genId();
  const now = new Date().toISOString();
  const cfg = {
    configId: id,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ...payload,
  };
  writeConfig(id, cfg);
  return cfg;
}

function updateConfig(id, patch) {
  const cfg = readConfig(id);
  const next = { ...cfg, ...patch, updatedAt: new Date().toISOString() };
  writeConfig(id, next);
  return next;
}

function listConfigsByCustomer(customerId, { limit = 50, offset = 0 } = {}) {
  // Simple FS scan (not efficient for huge datasets). OK for MVP.
  const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
  const out = [];
  for (const e of entries) {
    try {
      const cfg = readConfig(e.name);
      if (String(cfg.customerId || '') === String(customerId)) out.push(cfg);
    } catch (_) {}
  }
  out.sort((a,b) => String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
  return out.slice(offset, offset + limit);
}

function findIdByShortCode(code) {
  const target = String(code || '').trim().toUpperCase();
  if (!target) return null;
  try {
    const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const e of entries) {
      const id = e.name;
      const sc = shortCodeFrom(id);
      if (sc === target) return id;
    }
  } catch (_) {}
  return null;
}

// Signed URL helpers (HMAC over id + exp)
const SIGN_SECRET = process.env.CONFIG_SIGN_SECRET || 'dev-secret-change-me';
function base64url(b) { return Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function signToken(id, expTsSec) {
  const data = `${id}.${expTsSec}`;
  const sig = crypto.createHmac('sha256', SIGN_SECRET).update(data).digest('base64');
  return `${base64url(data)}.${base64url(sig)}`;
}
function verifyToken(token) {
  try {
    const [b64data, b64sig] = String(token).split('.');
    const data = Buffer.from(b64data.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8');
    const [id, exp] = data.split('.');
    const sig = Buffer.from(b64sig.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8');
    const now = Math.floor(Date.now()/1000);
    const expected = crypto.createHmac('sha256', SIGN_SECRET).update(`${id}.${exp}`).digest('base64');
    if (sig !== expected) return { ok: false };
    if (Number(exp) && now > Number(exp)) return { ok: false };
    return { ok: true, id };
  } catch (_) { return { ok: false }; }
}

module.exports = {
  createConfig,
  readConfig,
  updateConfig,
  listConfigsByCustomer,
  shortCodeFrom,
  findIdByShortCode,
  signToken,
  verifyToken,
};
