#!/usr/bin/env node
/**
 * Minimaler Smoke-Test gegen laufendes Backend (lokal oder remote via BASE_URL env).
 * Prüft: /healthz, /config-sample, PDF Download (Größe), optional ImageMagick Health.
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';

function request(path) {
  return new Promise((resolve, reject) => {
    const u = new URL(path.startsWith('http') ? path : BASE.replace(/\/$/, '') + path);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method: 'GET', timeout: 15000 }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

(async () => {
  const report = [];
  try {
    // 1) healthz
    const health = await request('/healthz');
    report.push(['healthz', health.status, health.body.toString().slice(0,80)]);
    if (health.status !== 200) throw new Error('/healthz != 200');

    // 2) config-sample
    const sample = await request('/config-sample');
    report.push(['config-sample', sample.status, sample.body.toString().slice(0,100)]);
    if (sample.status !== 200) throw new Error('/config-sample != 200');
    let id = null; try { id = JSON.parse(sample.body.toString()).id; } catch {}
    if (!id) throw new Error('no id in sample');

    // 3) pdf (mit optionaler Signatur-Unterstützung)
    let pdf = await request(`/config/${id}/pdf`);
    if (pdf.status === 403 && /Signatur erforderlich/i.test(pdf.body.toString())) {
      // Versuch signierten Link zu holen
      const signed = await request(`/config/${id}/signed-link`);
      report.push(['signed-link', signed.status, signed.body.toString().slice(0,120)]);
      if (signed.status !== 200) throw new Error('signed-link != 200');
      let pdfPath = null; try { pdfPath = JSON.parse(signed.body.toString()).pdf; } catch {}
      if (!pdfPath) throw new Error('no pdf path from signed-link');
      pdf = await request(pdfPath);
    }
    report.push(['pdf', pdf.status, `${pdf.body.length} bytes`]);
    if (pdf.status !== 200) throw new Error('pdf != 200');
    if (pdf.body.length < 1000) throw new Error('pdf too small');

    // 4) optional ImageMagick health
    try {
      const im = await request('/health/imagemagick');
      report.push(['health/imagemagick', im.status, im.body.toString().slice(0,80)]);
    } catch (e) {
      report.push(['health/imagemagick', 'ERR', e.message]);
    }

    console.log('SMOKE TEST PASS');
    for (const r of report) console.log(r[0].padEnd(24), r[1], r[2]);
    process.exit(0);
  } catch (e) {
    console.error('SMOKE TEST FAIL:', e.message);
    for (const r of report) console.log(r[0].padEnd(24), r[1], r[2]);
    process.exit(1);
  }
})();
