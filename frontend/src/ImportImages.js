import React, { useMemo, useRef, useState } from 'react';

function getBackendUrl() {
  if (typeof window !== 'undefined') {
    const override = window.WALLPAPER_BACKEND || new URLSearchParams(window.location.search).get('backend');
    if (override) return String(override);
    // Prefer direct backend in dev to allow proper SSE streaming
    try {
      const u = new URL(window.location.href);
      const port = String(u.port || '');
      if (port === '8080' || port === '8081') return 'http://localhost:3001';
    } catch {}
    return window.location.origin;
  }
  return 'http://localhost:3001';
}

function toCsv(rows) {
  if (!rows || !rows.length) return '';
  const cols = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const head = cols.join(',');
  const body = rows.map(r => cols.map(k => esc(r[k])).join(',')).join('\n');
  return head + '\n' + body;
}

export default function ImportImages() {
  const BACKEND = useMemo(() => getBackendUrl(), []);
  const [file, setFile] = useState(null);
  const [prefer, setPrefer] = useState('jpeg');
  const [concurrency, setConcurrency] = useState(4);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState(null); // { total, ok, fail }
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [useLiveProgress, setUseLiveProgress] = useState(true);
  const [progress, setProgress] = useState({ total: 0, processed: 0, ok: 0, fail: 0 });
  const [info, setInfo] = useState('');
  const [exportUrl, setExportUrl] = useState('');
  const inputRef = useRef(null);
  const controllerRef = useRef(null);

  const onPick = () => inputRef.current && inputRef.current.click();

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSummary(null); setResults([]); setProgress({ total: 0, processed: 0, ok: 0, fail: 0 });
    if (!file) { setError('Bitte CSV oder XLSX wählen.'); return; }
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('prefer', prefer);
      fd.append('concurrency', String(concurrency));
  // shop wird nicht mehr benötigt
  if (useLiveProgress) fd.append('progress', 'sse');
      setBusy(true);
      if (useLiveProgress) {
        // Use SSE streaming
        const url = `${BACKEND}/import/images`;
        const controller = new AbortController();
        controllerRef.current = controller;
        const resp = await fetch(url, { method: 'POST', body: fd, signal: controller.signal, headers: { 'Accept': 'text/event-stream' } });
        const ctype = resp.headers.get('content-type') || '';
        if (!resp.ok) {
          // Try JSON, else text
          if (ctype.includes('application/json')) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
          } else {
            const txt = await resp.text().catch(() => '');
            throw new Error(txt || `HTTP ${resp.status}`);
          }
        }
        if (!ctype.includes('text/event-stream') || !resp.body) {
          // Server did not stream; fallback to JSON
          controller.abort();
          setInfo('Live-Status nicht verfügbar (kein Stream). Fallback auf Direkt-Import.');
          const fd2 = new FormData();
          fd2.append('file', file);
          fd2.append('prefer', prefer);
          fd2.append('concurrency', String(concurrency));
          // kein shop-Param mehr
          const controller2 = new AbortController();
          controllerRef.current = controller2;
          const r2 = await fetch(`${BACKEND}/import/images`, { method: 'POST', body: fd2, signal: controller2.signal });
          const d2 = await r2.json().catch(() => ({}));
          if (!r2.ok) throw new Error(d2?.message || d2?.error || `HTTP ${r2.status}`);
          setSummary({ total: d2.total, ok: d2.ok, fail: d2.fail });
          setResults(Array.isArray(d2.results) ? d2.results : []);
          return;
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buf = '';
        let started = false;
        let fallbackTimer = setTimeout(async () => {
          if (!started) {
            try { controller.abort(); } catch {}
            setInfo('Live-Status reagiert nicht. Fallback auf Direkt-Import.');
            const fd2 = new FormData();
            fd2.append('file', file);
            fd2.append('prefer', prefer);
            fd2.append('concurrency', String(concurrency));
            // kein shop-Param mehr
            const controller2 = new AbortController();
            controllerRef.current = controller2;
            const r2 = await fetch(`${BACKEND}/import/images`, { method: 'POST', body: fd2, signal: controller2.signal });
            const d2 = await r2.json().catch(() => ({}));
            if (!r2.ok) throw new Error(d2?.message || d2?.error || `HTTP ${r2.status}`);
            setSummary({ total: d2.total, ok: d2.ok, fail: d2.fail });
            setResults(Array.isArray(d2.results) ? d2.results : []);
          }
        }, 7000);
        const deliverEvent = (event, data) => {
          try {
            const obj = data ? JSON.parse(data) : {};
            if (event === 'start') {
              started = true; try { clearTimeout(fallbackTimer); } catch {}
              setProgress({ total: obj.total || 0, processed: 0, ok: 0, fail: 0 });
            } else if (event === 'progress') {
              started = true;
              setProgress(p => ({ total: obj.total ?? p.total, processed: obj.processed ?? p.processed, ok: obj.ok ?? p.ok, fail: obj.fail ?? p.fail }));
              if (obj.last) setResults(r => r.concat(obj.last));
            } else if (event === 'done') {
              started = true; try { clearTimeout(fallbackTimer); } catch {}
              if (Array.isArray(obj.results)) setResults(obj.results);
              setSummary({ total: obj.total, ok: obj.ok, fail: obj.fail });
              // Patch: set exportUrl from obj.exportUrl if available
              if (obj.exportUrl) {
                setExportUrl(obj.exportUrl);
              }
              // Optional: results URL (für späteren Button)
              if (obj.resultsUrl) {
                // noop for now, could store in state
              }
            } else if (event === 'error') {
              started = true; try { clearTimeout(fallbackTimer); } catch {}
              setError(obj?.error || 'Unbekannter Fehler');
            }
          } catch (_) {}
        };
        const commit = (chunk) => {
          buf += chunk;
          while (true) {
            // Support both \n\n and \r\n\r\n separators
            let idx = buf.indexOf('\n\n');
            let sepLen = 2;
            const idxCRLF = buf.indexOf('\r\n\r\n');
            if (idxCRLF !== -1 && (idx === -1 || idxCRLF < idx)) { idx = idxCRLF; sepLen = 4; }
            if (idx === -1) break;
            const evt = buf.slice(0, idx);
            buf = buf.slice(idx + sepLen);
            const lines = evt.split(/\r?\n/);
            let event = 'message', data = '';
            for (const line of lines) {
              if (line.startsWith('event: ')) event = line.slice(7).trim();
              if (line.startsWith('data: ')) data += line.slice(6);
            }
            deliverEvent(event, data);
          }
        };
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            commit(decoder.decode(value, { stream: true }));
          }
        } catch (readErr) {
          // Wenn abgebrochen, sauber beenden
          if (readErr?.name === 'AbortError' || readErr?.message?.includes('aborted')) {
            setInfo('Import abgebrochen.');
          } else {
            throw readErr;
          }
        }
        try { clearTimeout(fallbackTimer); } catch {}
        // Flush any trailing event without double newline (edge case)
        if (buf.trim()) {
          const lines = buf.split(/\r?\n/);
          let event = 'message', data = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (data) deliverEvent(event, data);
        }
      } else {
        // Fallback: plain JSON without live progress
        const controller = new AbortController();
        controllerRef.current = controller;
        const resp = await fetch(`${BACKEND}/import/images`, { method: 'POST', body: fd, signal: controller.signal });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
        setSummary({ total: data.total, ok: data.ok, fail: data.fail });
        setResults(Array.isArray(data.results) ? data.results : []);
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        setInfo('Import abgebrochen.');
      } else {
        setError(err?.message || String(err));
      }
    } finally {
      setBusy(false);
      // Controller freigeben
      try { controllerRef.current = null; } catch {}
    }
  };

  const onCancel = () => {
    try {
      const c = controllerRef.current;
      if (c) c.abort();
      setBusy(false);
      setInfo('Import abgebrochen.');
    } catch {}
  };

  const onDownloadCsv = () => {
    const csv = toCsv(results);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'import-results.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  async function fetchLastExportUrl(){
    try {
      const r = await fetch(`${BACKEND}/import/images/last-variant-export`);
      const j = await r.json().catch(() => ({}));
      if (r.ok && j && j.ok && j.available && j.url) {
        setExportUrl(String(j.url));
        return String(j.url);
      }
      setExportUrl('');
      return '';
    } catch { setExportUrl(''); return ''; }
  }

  async function onDownloadVariantExport(){
    const url = exportUrl || (await fetchLastExportUrl());
    if (!url) { alert('Kein Export verfügbar. Bitte zuerst einen Import mit wd-picture=ja durchführen.'); return; }
    try {
      const a = document.createElement('a');
      a.href = url.startsWith('http') ? url : `${BACKEND}${url}`;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { document.body.removeChild(a); } catch{} }, 1000);
    } catch {}
  }

  return (
    <div style={{ maxWidth: 960, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui, Segoe UI, Roboto, sans-serif' }}>
      <h1>Bild-Import (CSV/XLSX → Shopify)</h1>
      <p>
        • Unterstützte Bezeichner (Priorität): <strong>product_id</strong> &gt; <strong>variant_sku/sku</strong> &gt; <strong>handle</strong><br/>
        • Bild-URL Spalten: <strong>image_url</strong> oder <strong>url</strong> (eine davon ist erforderlich)<br/>
        • Optional: <strong>position</strong> (wenn &gt; 0, wird gesetzt; sonst wird ans Ende angehängt)<br/>
        • Ausgabeformat JPEG/PNG wird serverseitig konvertiert
      </p>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12, alignItems: 'center' }}>
        <div>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <button type="button" onClick={onPick}>Datei wählen</button>
          <span style={{ marginLeft: 10 }}>{file ? file.name : 'Keine Datei ausgewählt'}</span>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {/* shop-Eingabe entfernt */}
          <label>
            Ausgabeformat:&nbsp;
            <select value={prefer} onChange={(e) => setPrefer(e.target.value)}>
              <option value="jpeg">JPEG</option>
              <option value="png">PNG</option>
            </select>
          </label>
          <label>
            Parallelität:&nbsp;
            <select value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))}>
              {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label>
            Live-Status:&nbsp;
            <input type="checkbox" checked={useLiveProgress} onChange={(e) => setUseLiveProgress(e.target.checked)} />
          </label>
          <button type="submit" disabled={busy || !file}>{busy ? 'Läuft…' : 'Import starten'}</button>
          <button type="button" onClick={onCancel} disabled={!busy} style={{ color: '#b00' }}>Import abbrechen</button>
        </div>
      </form>
      {info && (
        <div style={{ marginTop: 8, color: '#555', fontSize: 13 }}>{info}</div>
      )}
      {(progress.total > 0) && (
        <div style={{ marginTop: 12 }}>
          <div style={{ height: 10, background: '#eee', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, (progress.processed / progress.total) * 100 || 0)}%`, transition: 'width .2s', height: '100%', background: '#3b82f6' }} />
          </div>
          <div style={{ marginTop: 6, color: '#444', fontSize: 13 }}>
            {progress.processed}/{progress.total} verarbeitet
            {' '}— {Math.floor(((progress.processed / (progress.total || 1)) * 100))}%
            {' '}· OK: {progress.ok} · Fehler: {progress.fail}
          </div>
        </div>
      )}
      {error && <div style={{ marginTop: 12, color: '#c00' }}>Fehler: {error}</div>}
      {summary && (
        <div style={{ marginTop: 16, padding: 12, background: '#f6f6f6', border: '1px solid #e0e0e0' }}>
          <strong>Ergebnis:</strong> {summary.ok} erfolgreich, {summary.fail} Fehler, gesamt {summary.total}
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={onDownloadCsv}>Ergebnis als CSV herunterladen</button>
            <button type="button" onClick={onDownloadVariantExport}>Export: wd-picture (Produkt-Metafeld, Bild-ID)</button>
          </div>
        </div>
      )}
      {!!results.length && (
        <div style={{ marginTop: 16, overflow: 'auto', maxHeight: 520, border: '1px solid #eee' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                {['product_id','sku','handle','url','position','wd_picture','wd_picture_set','wd_picture_error','ok','error','resolved_via','image_id','src'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid #ddd', position:'sticky', top:0, background:'#fff' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} style={{ background: r.ok ? '#fafef8' : '#fff6f6' }}>
                  <td style={{ padding: '6px 6px', borderBottom: '1px solid #eee' }}>{r.product_id ?? ''}</td>
                  <td style={{ padding: '6px 6px', borderBottom: '1px solid #eee' }}>{r.sku ?? ''}</td>
                  <td style={{ padding: '6px 6px', borderBottom: '1px solid #eee' }}>{r.handle}</td>
                  <td style={{ padding: '6px 6px', borderBottom: '1px solid #eee', maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.url}>{r.url}</td>
                  <td style={{ padding: '6px 6px', borderBottom: '1px solid #eee' }}>{r.position ?? ''}</td>
                  <td style={{ padding: '6px 6px', borderBottom: '1px solid #eee' }}>{String(r.wd_picture ?? '')}</td>
                  <td style={{ padding: '6px 6px', borderBottom: '1px solid #eee' }}>{r.wd_picture_set ? 'true' : ''}</td>
                  <td style={{ padding: '6px 6px', borderBottom: '1px solid #eee', color: '#b00' }}>{r.wd_picture_error ?? ''}</td>
                  <td style={{ padding: '6px 6px', borderBottom: '1px solid #eee' }}>{String(Boolean(r.ok))}</td>
                  <td style={{ padding: '6px 6px', borderBottom: '1px solid #eee', color: '#b00' }}>{r.error ?? ''}</td>
                  <td style={{ padding: '6px 6px', borderBottom: '1px solid #eee' }}>{r.resolved_via ?? ''}</td>
                  <td style={{ padding: '6px 6px', borderBottom: '1px solid ' + (r.ok ? '#eee' : 'transparent') }}>{r.image_id ?? ''}</td>
                  <td style={{ padding: '6px 6px', borderBottom: '1px solid ' + (r.ok ? '#eee' : 'transparent'), maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.src}>{r.src ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
