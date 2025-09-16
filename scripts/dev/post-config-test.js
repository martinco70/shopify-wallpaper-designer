(async () => {
  try {
    const target = process.argv[2] || 'http://127.0.0.1:3001';
    const payload = {
      version: 'test',
      createdAt: new Date().toISOString(),
      wall: { widthCm: 200, heightCm: 120 },
      print: { widthCm: 210, heightCm: 130 },
      areaM2: (2.1 * 1.3),
      calc: { mode: 'm2', bahnenbreiteCm: null, strips: null, addedExtraStrip: false },
      price: { perM2: 49.5, total: Number((49.5 * 2.73).toFixed(2)), currency: 'CHF' },
      image: { url: `${target}/uploads/sample.jpg` },
      transform: { zoom: 1, flipH: false, flipV: false },
      context: { backend: target }
    };
    const res = await fetch(`${target}/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const ct = String(res.headers.get('content-type') || '').toLowerCase();
    const data = ct.includes('application/json') ? await res.json() : { text: await res.text() };
    console.log('status:', res.status);
    console.log('body:', data);
    if (res.ok && data.configId) {
      const pdfRes = await fetch(`${target}/config/${encodeURIComponent(data.configId)}/pdf`, { method: 'GET' });
      console.log('pdf status:', pdfRes.status, pdfRes.headers.get('content-type'));
    }
  } catch (e) {
    console.error('error:', e.message);
    process.exit(1);
  }
})();
