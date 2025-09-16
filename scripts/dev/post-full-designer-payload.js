#!/usr/bin/env node
// Sends a representative full designer payload to /config and prints result.
const https = require('https');
const http = require('http');
const url = process.env.TEST_BASE_URL || 'http://localhost:3001';

const payload = {
  wall: { widthCm: 350, heightCm: 265 },
  print: { widthCm: 360, heightCm: 275 },
  areaM2: (360/100)*(275/100),
  calc: { mode: 'm2' },
  price: { base: 0, total: 0 },
  image: { url: '/uploads/example-demo.jpg', originalName: 'example-demo.jpg' },
  transform: { zoom: 1, flipH: false, flipV: false },
  meta: { appVersion: 'test-script', note: 'full designer payload test' }
};

function doPost() {
  return new Promise((resolve, reject) => {
    const u = new URL('/config', url);
    const mod = u.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload);
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data='';
      res.on('data', c=>data+=c);
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  try {
    const r = await doPost();
    console.log('POST /config status', r.status);
    console.log('Body:', r.body);
  } catch (e) {
    console.error('Error', e);
    process.exit(1);
  }
})();
