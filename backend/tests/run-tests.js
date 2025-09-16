// Minimal Test Runner (ohne Jest) für schnelle Smoke-Tests
const request = require('supertest');
const app = require('../index');

(async () => {
  let failures = 0;
  function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); failures++; } else { console.log('PASS:', msg); } }

  try {
    // /healthz
    const h = await request(app).get('/healthz');
    assert(h.status === 200 && h.body && h.body.ok === true, '/healthz liefert ok:true');

    // /config-sample
    const sample = await request(app).get('/config-sample?w=120&h=80');
    assert(sample.status === 200 && sample.body && sample.body.id, '/config-sample liefert id');
    const cfgId = sample.body.id;

    // /config/:id/pdf
    const pdfRes = await request(app).get(`/config/${cfgId}/pdf`).buffer().parse((res, cb) => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    assert(pdfRes.status === 200, '/config/:id/pdf Status 200');
    const ct = pdfRes.headers['content-type'] || ''; assert(ct.includes('pdf'), 'content-type ist PDF');
    assert(pdfRes.body && pdfRes.body.length > 200, 'PDF hat >200 bytes');
  } catch (e) {
    console.error('UNCAUGHT TEST ERROR', e);
    failures++;
  }
  if (failures > 0) {
    console.error(`Tests: ${failures} Fehl(er)\n`); process.exit(1);
  } else {
    console.log('Alle Tests erfolgreich.');
  }
})();
