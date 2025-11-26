#!/usr/bin/env node
/*
 * Diagnose siblings endpoint:
 * Compares raw group vs normalized group queries and prints counts, keyUsed, encountered values.
 * Usage:
 *   node backend/scripts/diagnose-siblings.js "Stripe 20" [--host https://app.wirzapp.ch] [--limit 50]
 * Add --scan to force scan=1.
 */
const https = require('https');

function normalizeFull(s){
  try{
    return String(s||'')
      .toLowerCase()
      .replace(/\s+/g,'')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'');
  }catch(_){ return String(s||'').toLowerCase().replace(/\s+/g,''); }
}

function fetchJson(url){
  return new Promise((resolve,reject)=>{
    https.get(url, res => {
      let data='';
      res.on('data', d => data+=d);
      res.on('end', ()=>{
        try{ resolve(JSON.parse(data)); }catch(e){ reject(new Error('Invalid JSON '+e.message)); }
      });
    }).on('error', reject);
  });
}

async function run(){
  const args = process.argv.slice(2);
  if(!args.length){ console.error('Group value required. Example: node diagnose-siblings.js "Stripe 20"'); process.exit(1); }
  const groupRaw = args[0];
  let host = 'https://app.wirzapp.ch';
  let limit = 50; let scan = false;
  for(let i=1;i<args.length;i++){
    if(args[i]==='--host' && args[i+1]){ host = args[++i].replace(/\/$/,''); }
    else if(args[i]==='--limit' && args[i+1]){ limit = parseInt(args[++i],10)||limit; }
    else if(args[i]==='--scan'){ scan = true; }
  }
  const norm = normalizeFull(groupRaw);
  const q = (val) => host + '/api/siblings?group=' + encodeURIComponent(val) + '&limit=' + encodeURIComponent(limit) + '&debug=1' + (scan ? '&scan=1':'');
  console.log('[diagnose] raw=', groupRaw, 'normalized=', norm, 'host=', host);

  let rawResp, normResp;
  try{ rawResp = await fetchJson(q(groupRaw)); }catch(e){ console.error('Raw request failed:', e.message); }
  try{ normResp = await fetchJson(q(norm)); }catch(e){ console.error('Normalized request failed:', e.message); }

  function summarize(label, resp){
    if(!resp){ return { label, error:'no-response' }; }
    return {
      label,
      ok: resp.ok,
      count: Array.isArray(resp.items)?resp.items.length:0,
      keyUsed: resp.diagnostics && resp.diagnostics.keyUsed || null,
      encountered: resp.diagnostics && Array.isArray(resp.diagnostics.encountered)?resp.diagnostics.encountered.length:0
    };
  }
  const sumRaw = summarize('raw', rawResp);
  const sumNorm = summarize('normalized', normResp);
  console.table([sumRaw, sumNorm]);

  // Show encountered sample differences
  function listDiff(){
    if(!rawResp || !normResp || !rawResp.diagnostics || !normResp.diagnostics) return;
    const encRaw = rawResp.diagnostics.encountered || [];
    const encNorm = normResp.diagnostics.encountered || [];
    const mapRaw = new Map(encRaw.map(e => [e.lower, e]));
    const mapNorm = new Map(encNorm.map(e => [e.lower, e]));
    const allLower = new Set([...mapRaw.keys(), ...mapNorm.keys()]);
    const rows = [];
    for(const lower of allLower){
      rows.push({ lower, inRaw: mapRaw.has(lower), inNorm: mapNorm.has(lower) });
    }
    console.log('[diagnose] encountered diff (lower normalization):');
    console.table(rows.slice(0,40));
  }
  listDiff();

  // If counts identical and keyUsed designname, suggest next step
  if(sumRaw.count === sumNorm.count){
    console.log('[diagnose] Counts identical. Next step: verify product Metafield actual stored value mismatches (maybe leading/trailing whitespace already absent). Consider inspecting a problematic product via Storefront API.');
  } else {
    console.log('[diagnose] Counts differ. Normalization changed result set.');
  }
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
