(function(){
  'use strict';
  try{ console.log('[siblings v2 asset] loaded'); }catch(_){ }

  function norm(s){ try{ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }catch(_){ return String(s||'').toLowerCase(); } }

  function initOne(root){
    if(!root || root.__siblingsV2Inited) return;
    root.__siblingsV2Inited = true;
    try{ console.log('[siblings v2 asset] init', { id: root.id, build: root.getAttribute('data-build') }); }catch(_){ }

    var grid = root.querySelector('.product-siblings__grid');
    var btn = root.querySelector('.product-siblings__load');
  var statusEl = root.querySelector('.product-siblings__status');
  var headingEl = root.querySelector('.product-siblings__title');

    var code = root.getAttribute('data-group-code') || '';
    var codeRaw = root.getAttribute('data-group-raw') || '';
    var token = root.getAttribute('data-sf-token') || '';
    var shop = root.getAttribute('data-shop-domain') || '';
    var vendor = root.getAttribute('data-product-vendor') || '';
    var initial = parseInt(root.getAttribute('data-initial-count')||'12',10);
    var batch = parseInt(root.getAttribute('data-batch-size')||'12',10);
    var colsD = parseInt(root.getAttribute('data-columns-desktop')||'4',10);
    var colsT = parseInt(root.getAttribute('data-columns-tablet')||'3',10);
    var colsM = parseInt(root.getAttribute('data-columns-mobile')||'2',10);

    // Apply CSS per-instance
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

    var seenHandles = new Set();
    var seenTitles = new Set();

    function renderCard(p){
      if(!p || !p.handle) return false;
      var handleKey = String(p.handle);
      try{ var t0 = (p.title||''); if (String(t0).toLowerCase().indexOf('muster') !== -1) { return false; } }catch(_){ }
      try{ var titleKey = norm(p.title||''); if (titleKey && seenTitles.has(titleKey)) return false; }catch(_){ }
      if(seenHandles.has(handleKey)) return false;
      try{ var tk = norm(p.title||''); if(tk){ seenTitles.add(tk); } }catch(_){ }
      seenHandles.add(handleKey);
      var a=document.createElement('a'); a.href='/products/'+p.handle; a.className='product-siblings__card';
      var imgUrl=null; try{
        if(p.images && p.images.nodes && Array.isArray(p.images.nodes)){
          var nodes=p.images.nodes; imgUrl = nodes.length>1 ? (nodes[1].url||null) : (nodes[0] && (nodes[0].url||null));
        }
      }catch(_){ imgUrl=null; }
      if(!imgUrl){ imgUrl = (p.featuredImage && p.featuredImage.url) ? p.featuredImage.url : null; }
      var imgDiv=document.createElement('div'); imgDiv.className='product-siblings__img';
      var u0 = imgUrl ? (imgUrl + (String(imgUrl).includes('?')?'&':'?') + 'width=600') : null;
      if(u0){ imgDiv.style.backgroundImage='url("'+String(u0).replace(/"/g,'\\"')+'")'; }
      var t=document.createElement('div'); t.className='product-siblings__title'; t.textContent=p.title||'';
      a.appendChild(imgDiv); a.appendChild(t); grid.appendChild(a);
      return true;
    }

    var hasNext=true; var endCursor=null; var loaded=0; var page=1;
    function loadNextProxy(count){
      var val = (codeRaw && codeRaw.trim()) ? codeRaw.trim() : (code || '').trim();
      if(!val){ hasNext=false; return Promise.resolve(); }
      var proxy = root.getAttribute('data-proxy-url') || '/api/siblings';
      var sep = proxy.indexOf('?')>=0 ? '&' : '?';
      var url = proxy + sep + 'group=' + encodeURIComponent(val) + '&limit=' + encodeURIComponent(count);
      if(shop){ url += '&shop=' + encodeURIComponent(shop); }
      try{ console.log('[siblings v2 asset] proxy url', proxy); }catch(_){}
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
        try{ console.log('[siblings v2 asset] page', page, { fetched: fetched, matched: matched, skipped: skipped, loadedTotal: loaded, hasNext: hasNext }); }catch(_){ }
        page++;
        if (btn) { if (hasNext) { btn.hidden = false; } else { btn.hidden = true; } }
      }).catch(function(e){ console.warn('[siblings v2 asset] proxy failed', e); hasNext=false; });
    }

    function loadUntil(target){
      function pump(){ if(!hasNext || loaded >= target){ return Promise.resolve(); } return loadNextProxy(Math.min(target - loaded, batch)).then(pump); }
      var first = Math.max(batch, target - loaded);
      return loadNextProxy(first).then(function(){ return pump(); });
    }

    if(btn){ btn.addEventListener('click', function(){ loadUntil(loaded + batch); }); }
    setStatus('Lade Alternativfarben …');
    if(headingEl){ headingEl.hidden = false; }
    loadUntil(Math.max(initial, 0)).then(function(){
      if(loaded>0){
        setStatus(null);
        if(headingEl){ headingEl.hidden = false; }
      } else {
        setStatus('Keine passenden Produkte gefunden.');
        if(headingEl){ headingEl.hidden = true; }
      }
    });
  }

  function scan(){
    var nodes = document.querySelectorAll('.product-siblings[data-build="siblings-2025-10-29-v2"]');
    for(var i=0;i<nodes.length;i++) initOne(nodes[i]);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', scan);
  } else {
    scan();
  }

  document.addEventListener('shopify:section:load', function(e){
    try{ scan(); }catch(_){ }
  });
})();
