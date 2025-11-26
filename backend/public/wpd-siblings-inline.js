(function(){
  'use strict';
  try{ console.log('[siblings-inline asset] loaded'); }catch(_){ }

  // Normalisierung erweitert: entfernt alle Whitespaces + Diakritika
  function norm(s){
    try{
      return String(s||'')
        .toLowerCase()
        .replace(/\s+/g,'')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g,'');
    }catch(_){ return String(s||'').toLowerCase().replace(/\s+/g,''); }
  }

  function initOne(root){
    if(!root || root.__siblingsInlineInited) return;
    root.__siblingsInlineInited = true;
    try{ console.log('[siblings-inline asset] init', { id: root.id, build: root.getAttribute('data-build') }); }catch(_){ }

    var grid = root.querySelector('.product-siblings__grid');
    var btn = root.querySelector('.product-siblings__load');
    var statusEl = root.querySelector('.product-siblings__status');

    var codeRaw = root.getAttribute('data-group-code') || '';
    var code = codeRaw ? codeRaw.toLowerCase().replace(/_/g,'-') : '';
    var groupRaw = root.getAttribute('data-group-raw') || '';
    var groupNorm = norm(groupRaw);
    // Debug A: Hex-Dump
    try {
      var hexDump = Array.prototype.map.call(groupRaw, function(ch){
        var cp = ch.codePointAt(0).toString(16).toUpperCase();
        while(cp.length < 4) cp='0'+cp;
        return 'U+'+cp;
      }).join(' ');
      console.log('[siblings-inline debug][A] groupRaw hexDump', { groupRaw, hexDump });
    } catch(_){ }
    var token = root.getAttribute('data-sf-token') || '';
    var shop = root.getAttribute('data-shop-domain') || '';
    var initial = parseInt(root.getAttribute('data-initial-count')||'12',10);
    var batch = parseInt(root.getAttribute('data-batch-size')||'12',10);
    var colsD = parseInt(root.getAttribute('data-columns-desktop')||'4',10);
    var colsT = parseInt(root.getAttribute('data-columns-tablet')||'3',10);
    var colsM = parseInt(root.getAttribute('data-columns-mobile')||'2',10);

    // Style per-instance
    try {
      var style = document.createElement('style');
      var sel = '#' + CSS.escape(root.id);
      style.textContent = sel + '[data-empty="true"]{display:none!important}' +
        sel + ' .product-siblings__grid{display:grid;gap:16px;grid-template-columns:repeat(' + colsD + ',minmax(0,1fr))}' +
        '@media(max-width:1024px){' + sel + ' .product-siblings__grid{grid-template-columns:repeat(' + colsT + ',minmax(0,1fr))}}' +
        '@media(max-width:640px){' + sel + ' .product-siblings__grid{grid-template-columns:repeat(' + colsM + ',minmax(0,1fr))}}' +
        sel + ' .product-siblings__card{display:block;text-decoration:none;color:inherit;position:relative}' +
        sel + ' .product-siblings__img{width:100%;aspect-ratio:1/1;border:1px solid #eee;border-radius:4px;background:#fafafa;background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important}' +
        sel + ' .product-siblings__title{margin-top:8px;font-size:14px;line-height:1.35}' +
        sel + ' .product-siblings__status{display:none!important}';
      document.head.appendChild(style);
    } catch(_){ }

    function setStatus(msg){ if(!statusEl) return; if(msg){ statusEl.textContent = msg; statusEl.hidden = false; } else { statusEl.hidden = true; } }

    // Early context
    try{ var _tail = token ? String(token).slice(-6) : 'none'; console.log('[siblings-inline asset] init-early', { groupCode: code, groupRaw: groupRaw, groupNorm: groupNorm, endpoint: '/api/2024-07/graphql.json', tokenTail: _tail }); }catch(_){ }

    if(!code && !(groupRaw && groupRaw.trim())){ setStatus('Kein Metafeld custom.designname am Produkt – keine Gruppenbildung möglich.'); return; }
    // Debug D: handleize Abweichung
    try {
      var handleizedRaw = groupRaw.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
      if(codeRaw && handleizedRaw && codeRaw !== handleizedRaw){ console.warn('[siblings-inline debug][D] handleize mismatch', { codeRaw, handleizedRaw, groupRaw }); }
    } catch(_){ }

    var endpoint = '/api/2024-07/graphql.json';
    var page = 1; var mode = 'proxy';
    var hasNext = true; var endCursor = null; var loaded = 0; var primed = false;
    var seenHandles = new Set();
    var seenTitles = new Set();

    function gq(query, variables){
      return fetch(endpoint, { method: 'POST', headers: { 'Content-Type':'application/json', 'X-Shopify-Storefront-Access-Token': token }, body: JSON.stringify({ query: query, variables: variables||{} }) }).then(function(r){
        if(!r.ok){ return r.text().then(function(t){ throw { status:r.status, body:t }; }); }
        return r.json();
      });
    }

    function renderCard(p){
      if(!p || !p.handle) return false;
      var handleKey = String(p.handle);
      var titleVal = p.title || '';
      var titleKey = (titleVal).trim().toLowerCase();
      if(String(titleVal).toLowerCase().indexOf('muster') !== -1){ console.log('[siblings-inline debug][C] skip muster', { handle:p.handle, title:p.title }); return false; }
      if(titleKey && seenTitles.has(titleKey)){ console.log('[siblings-inline debug][C] skip title-duplicate', { handle:p.handle, title:p.title, titleKey }); return false; }
      if(seenHandles.has(handleKey)){ console.log('[siblings-inline debug][C] skip handle-duplicate', { handle:p.handle, title:p.title }); return false; }
      if(titleKey){ seenTitles.add(titleKey); }
      seenHandles.add(handleKey);
      var a=document.createElement('a'); a.href='/products/'+p.handle; a.className='product-siblings__card';
      var imgUrl = null;
      try{
        if(p.images && Array.isArray(p.images)){
          imgUrl = p.images.length>1 ? (p.images[1].url||p.images[1]) : (p.images[0] && (p.images[0].url||p.images[0])) || null;
        } else if(p.images && p.images.nodes && Array.isArray(p.images.nodes)){
          var nodes = p.images.nodes;
          imgUrl = nodes.length>1 ? (nodes[1].url||null) : (nodes[0] && (nodes[0].url||null));
        } else if(p.image2 && (p.image2.url || typeof p.image2 === 'string')){
          imgUrl = p.image2.url || p.image2;
        }
      }catch(_){ imgUrl = null; }
      if(!imgUrl){ imgUrl = (p.featuredImage && p.featuredImage.url) ? p.featuredImage.url : null; }
      var imgDiv=document.createElement('div'); imgDiv.className='product-siblings__img';
      var u0 = imgUrl ? (imgUrl + (String(imgUrl).includes('?')?'&':'?') + 'width=600') : null;
      if(u0){ imgDiv.style.backgroundImage = 'url("'+String(u0).replace(/"/g,'\\"')+'")'; }
      var t=document.createElement('div'); t.className='product-siblings__title'; t.textContent=p.title||'';
      a.appendChild(imgDiv); a.appendChild(t);
      grid.appendChild(a);
      return true;
    }

    function loadNextProxy(count){
      var val = (groupRaw && groupRaw.trim()) ? groupNorm : norm(code||'');
      if(!val){ hasNext=false; return Promise.resolve(); }
      var proxy = root.getAttribute('data-proxy-url') || '/api/siblings';
      var sep = proxy.indexOf('?')>=0 ? '&' : '?';
      var url = proxy + sep + 'group=' + encodeURIComponent(val) + '&limit=' + encodeURIComponent(count);
      if(shop){ url += '&shop=' + encodeURIComponent(shop); }
      if(endCursor) url += '&cursor=' + encodeURIComponent(endCursor);
      try{ console.log('[siblings-inline debug][B] fetch proxy', { raw:groupRaw, norm:groupNorm, chosen:val, encoded:encodeURIComponent(val), cursor:endCursor||null, url }); }catch(_){ }
      return fetch(url, { credentials:'omit' }).then(function(r){ if(!r.ok) throw new Error('proxy:'+r.status); return r.json(); }).then(function(res){
        var items = res && res.items || []; var matched=0; var fetched=items.length; var skipped=0;
        for(var i=0;i<items.length;i++){
          var n=items[i];
          if(!n||!n.handle){ skipped++; console.log('[siblings-inline debug][C] skip missing handle', n); continue;}
          if(n.title && String(n.title).toLowerCase().indexOf('muster')!==-1){ skipped++; console.log('[siblings-inline debug][C] skip muster (proxy loop)', { handle:n.handle, title:n.title }); continue; }
          var currentHandle = root.getAttribute('data-current-handle') || '';
          if(currentHandle && n.handle===currentHandle){ skipped++; console.log('[siblings-inline debug][C] skip self-handle', { handle:n.handle }); continue;}
          var added = renderCard(n);
          if(added){ loaded++; matched++; } else { skipped++; }
        }
        hasNext = !!(res && res.pageInfo && res.pageInfo.hasNextPage); endCursor = res && res.pageInfo && res.pageInfo.endCursor || null;
  try{ console.log('[siblings-inline asset] page', page, { mode:'proxy', fetched: fetched, matched: matched, skipped: skipped, loadedTotal: loaded, hasNext: hasNext }); }catch(_){ }
  // Progress/diagnostic line permanently disabled per UX request
  // setStatus('Seite ' + page + ' (Proxy): gefunden ' + fetched + ', passend ' + matched + ', verworfen ' + skipped + ' · insgesamt geladen: ' + loaded + (hasNext ? ' · weitere Seiten…' : ''));
        page++; if(btn) btn.hidden = !hasNext;
      }).catch(function(e){ console.warn('[siblings-inline asset] proxy failed', e); mode='sf'; hasNext=true; endCursor=null; return loadNextSF(count); });
    }

    var Q_COLL = '\nquery Coll($handle:String!, $first:Int!, $after:String){\n  collection(handle:$handle){\n    products(first:$first, after:$after){\n      edges{ node{ id handle title vendor availableForSale images(first:6){ nodes{ url width height altText } } featuredImage{ url width height altText } metafield(namespace:\\"custom\\", key:\\"designname\\"){ value } } }\n      pageInfo{ hasNextPage endCursor }\n    }\n  }\n}\n';
    function loadNextSF(count){
      var handle = (code && String(code).trim()) ? String(code).trim() : null;
      if(!handle){ hasNext=false; return Promise.resolve(); }
      return gq(Q_COLL, { handle: handle, first: count, after: endCursor }).then(function(res){
        var c = res && res.data && res.data.collection; var matched=0; var fetched=0; var skipped=0;
        if(!c || !c.products){ hasNext=false; return; }
        var edges = (c.products && c.products.edges) ? c.products.edges : []; fetched = edges.length;
        var want = (groupRaw && groupRaw.trim()) ? groupNorm : norm(code||'');
        for(var i=0;i<edges.length;i++){
          var n = edges[i] && edges[i].node; if(!n){ skipped++; console.log('[siblings-inline debug][C] skip missing node'); continue; }
          try{ var mfv = (n.metafield && n.metafield.value) ? String(n.metafield.value).toLowerCase().trim() : ''; if(want && mfv && mfv !== want){ skipped++; console.log('[siblings-inline debug][C] skip metafield mismatch', { handle:n.handle, mfv, want }); continue; } }catch(_){ }
          if(n.title && String(n.title).toLowerCase().indexOf('muster')!==-1){ skipped++; console.log('[siblings-inline debug][C] skip muster (sf loop)', { handle:n.handle, title:n.title }); continue; }
          var currentHandle = root.getAttribute('data-current-handle') || '';
          if(currentHandle && n.handle===currentHandle){ skipped++; console.log('[siblings-inline debug][C] skip self-handle (sf loop)', { handle:n.handle }); continue; }
          var added = renderCard(n);
          if(added){ loaded++; matched++; } else { skipped++; }
        }
        var pi = c.products.pageInfo || {}; hasNext = !!pi.hasNextPage; endCursor = pi.endCursor || null;
  try{ console.log('[siblings-inline asset] page', page, { mode:'sf', fetched: fetched, matched: matched, skipped: skipped, loadedTotal: loaded, hasNext: hasNext }); }catch(_){ }
  // Progress/diagnostic line permanently disabled per UX request
  // setStatus('Seite ' + page + ' (Storefront): gefunden ' + fetched + ', passend ' + matched + ', verworfen ' + skipped + ' · insgesamt geladen: ' + loaded + (hasNext ? ' · weitere Seiten…' : ''));
        page++; if(btn) btn.hidden = !hasNext;
      }).catch(function(e){ console.warn('[siblings-inline asset] storefront fallback failed', e); hasNext=false; });
    }

    var groupsAsset = root.getAttribute('data-groups-asset'); var handles=null; var index=0;
    function fetchProductJs(handle){ return fetch('/products/'+handle+'.js').then(function(r){ return r.json(); }).then(function(p){ return { handle:p.handle, title:p.title, availableForSale:p.available, featuredImage:(p.images&&p.images[0])?{url:p.images[0], altText:p.title}:null }; }); }
    function loadNextAsset(count){ if(!handles) return Promise.resolve(); var currentHandle=root.getAttribute('data-current-handle')||''; var tasks=[]; var added=0; while(index<handles.length && added<count){ var h=handles[index++]; if(currentHandle && h===currentHandle) continue; tasks.push(fetchProductJs(h).then(function(prod){ renderCard(prod); })); added++; } if(btn) btn.hidden = index>=handles.length; return Promise.all(tasks); }

    function loadUntil(target){
      if(!token){ return Promise.resolve(); }
      function pump(){ if(!hasNext || loaded >= target){ return Promise.resolve(); } var loader = (mode==='proxy') ? loadNextProxy : loadNextSF; return loader(batch).then(pump); }
      var first = Math.max(batch, target - loaded);
      var loader0 = (mode==='proxy') ? loadNextProxy : loadNextSF;
      return loader0(first).then(function(){ return pump(); });
    }

    function prime(){ if(primed) return; primed=true; if(token){ setStatus('Lade Alternativfarben …'); return loadUntil(initial).then(function(){ if(loaded>0){ setStatus(null); } else { setStatus('Keine passenden Produkte gefunden.'); } }).catch(function(){}); } else { return fetch(groupsAsset).then(function(r){ return r.json(); }).then(function(map){ var key=(code||'').toLowerCase().replace(/_/g,'-'); handles = map && map[key] ? map[key] : []; setStatus('Lade Alternativfarben …'); return loadNextAsset(initial).then(function(){ setStatus(null); }); }).catch(function(e){ console.warn('[siblings-inline asset] groups asset missing or invalid', e); }); } }

    if(btn){ btn.addEventListener('click', function(){ if(token){ loadUntil(loaded + batch); } else { loadNextAsset(batch); } }); }
    prime();

    document.addEventListener('shopify:section:load', function(){ try{ primed=false; hasNext=true; endCursor=null; loaded=0; index=0; grid.innerHTML=''; if(btn) btn.hidden=true; seenTitles=new Set(); seenHandles=new Set(); prime(); }catch(_){ } });
  }

  // v2 initializer (copied from wpd-siblings-v2.js, trimmed to avoid duplication)
  function initOneV2(root){
    if(!root || root.__siblingsV2Inited) return; root.__siblingsV2Inited = true;
    try{ console.log('[siblings-inline asset] init v2 host', { id: root.id }); }catch(_){ }
    var grid = root.querySelector('.product-siblings__grid');
    var btn = root.querySelector('.product-siblings__load');
    var statusEl = root.querySelector('.product-siblings__status');
    var code = root.getAttribute('data-group-code') || '';
    var codeRaw = root.getAttribute('data-group-raw') || '';
    var groupNorm = norm(codeRaw);
    var shop = root.getAttribute('data-shop-domain') || '';
    var initial = parseInt(root.getAttribute('data-initial-count')||'12',10);
    var batch = parseInt(root.getAttribute('data-batch-size')||'12',10);
    var colsD = parseInt(root.getAttribute('data-columns-desktop')||'4',10);
    var colsT = parseInt(root.getAttribute('data-columns-tablet')||'3',10);
    var colsM = parseInt(root.getAttribute('data-columns-mobile')||'2',10);
    try {
      var style = document.createElement('style');
      var sel = '#' + CSS.escape(root.id);
      style.textContent = sel + ' .product-siblings__grid{display:grid;gap:16px;grid-template-columns:repeat(' + colsD + ',minmax(0,1fr))}' +
        '@media(max-width:1024px){' + sel + ' .product-siblings__grid{grid-template-columns:repeat(' + colsT + ',minmax(0,1fr))}}' +
        '@media(max-width:640px){' + sel + ' .product-siblings__grid{grid-template-columns:repeat(' + colsM + ',minmax(0,1fr))}}' +
        sel + ' .product-siblings__card{display:block;text-decoration:none;color:inherit;position:relative}' +
        sel + ' .product-siblings__img{width:100%;aspect-ratio:1/1;border:1px solid #eee;border-radius:4px;background:#fafafa;background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important}' +
        sel + ' .product-siblings__title{margin-top:8px;font-size:14px;line-height:1.35}' +
        sel + ' .product-siblings__status{display:none!important}';
      document.head.appendChild(style);
    } catch(_){ }
    function setStatus(msg){ if(!statusEl) return; if(msg){ statusEl.textContent = msg; statusEl.hidden = false; } else { statusEl.hidden = true; } }
    var seenHandles = new Set(); var seenTitles = new Set();
    function renderCard(p){
      if(!p || !p.handle) return false; var handleKey = String(p.handle);
      try{ var t0 = (p.title||''); if (String(t0).toLowerCase().indexOf('muster') !== -1) { return false; } }catch(_){ }
      try{ var titleKey = norm(p.title||''); if (titleKey && seenTitles.has(titleKey)) return false; }catch(_){ }
      if(seenHandles.has(handleKey)) return false; try{ var tk = norm(p.title||''); if(tk){ seenTitles.add(tk); } }catch(_){ }
      seenHandles.add(handleKey);
      var a=document.createElement('a'); a.href='/products/'+p.handle; a.className='product-siblings__card';
      var imgUrl=null; try{ if(p.images && p.images.nodes && Array.isArray(p.images.nodes)){ var nodes=p.images.nodes; imgUrl = nodes.length>1 ? (nodes[1].url||null) : (nodes[0] && (nodes[0].url||null)); } }catch(_){ imgUrl=null; }
      if(!imgUrl){ imgUrl = (p.featuredImage && p.featuredImage.url) ? p.featuredImage.url : null; }
      var imgDiv=document.createElement('div'); imgDiv.className='product-siblings__img'; var u0 = imgUrl ? (imgUrl + (String(imgUrl).includes('?')?'&':'?') + 'width=600') : null; if(u0){ imgDiv.style.backgroundImage='url("'+String(u0).replace(/"/g,'\\"')+'")'; }
      var t=document.createElement('div'); t.className='product-siblings__title'; t.textContent=p.title||''; a.appendChild(imgDiv); a.appendChild(t); grid.appendChild(a); return true;
    }
    var hasNext=true; var endCursor=null; var loaded=0; var page=1;
    function loadNextProxy(count){
      var val = (codeRaw && codeRaw.trim()) ? groupNorm : norm(code||''); if(!val){ hasNext=false; return Promise.resolve(); }
      var proxy = root.getAttribute('data-proxy-url') || '/api/siblings';
      var sep = proxy.indexOf('?')>=0 ? '&' : '?'; var url = proxy + sep + 'group=' + encodeURIComponent(val) + '&limit=' + encodeURIComponent(count); if(shop){ url += '&shop=' + encodeURIComponent(shop); }
      try{ console.log('[siblings-inline asset] v2 proxy url', proxy); }catch(_){}
      return fetch(url, { credentials:'omit' }).then(function(r){ if(!r.ok) throw new Error('proxy:'+r.status); return r.json(); }).then(function(res){
        var items = res && res.items || []; var matched=0; var fetched=items.length; var skipped=0;
        for(var i=0;i<items.length;i++){
          var n=items[i]; if(!n||!n.handle) { skipped++; continue; }
          try{ if(n.title && String(n.title).toLowerCase().indexOf('muster')!==-1){ skipped++; continue; } }catch(_){ }
          var currentHandle = root.getAttribute('data-current-handle') || '';
          if(currentHandle && n.handle===currentHandle){ skipped++; continue; }
          var added = renderCard(n); if(added){ loaded++; matched++; } else { skipped++; }
        }
        hasNext = !!(res && res.pageInfo && res.pageInfo.hasNextPage); endCursor = res && res.pageInfo && res.pageInfo.endCursor || null;
        try{ console.log('[siblings-inline asset] v2 page', page, { fetched: fetched, matched: matched, skipped: skipped, loadedTotal: loaded, hasNext: hasNext }); }catch(_){ }
        page++; if (btn) { btn.hidden = !hasNext; }
      }).catch(function(e){ console.warn('[siblings-inline asset] v2 proxy failed', e); hasNext=false; });
    }
    function loadUntil(target){ function pump(){ if(!hasNext || loaded >= target){ return Promise.resolve(); } return loadNextProxy(Math.min(target - loaded, batch)).then(pump); } var first = Math.max(batch, target - loaded); return loadNextProxy(first).then(function(){ return pump(); }); }
    if(btn){ btn.addEventListener('click', function(){ loadUntil(loaded + batch); }); }
    setStatus('Lade Alternativfarben …');
    loadUntil(Math.max(initial, 0)).then(function(){ if(loaded>0){ setStatus(null); } else { setStatus('Keine passenden Produkte gefunden.'); } });
  }

  function scan(){
    var nodesA = document.querySelectorAll('.product-siblings[data-build="siblings-inline-2025-10-23-01"]');
    for(var i=0;i<nodesA.length;i++) initOne(nodesA[i]);
    var nodesB = document.querySelectorAll('.product-siblings[data-build="siblings-2025-10-29-v2"]');
    for(var j=0;j<nodesB.length;j++) initOneV2(nodesB[j]);
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', scan);
  } else {
    scan();
  }
})();
