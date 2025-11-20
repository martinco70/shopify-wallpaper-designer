(function(){
  'use strict';
  var BUILD = 'materials-2025-11-01-01';
  try{ console.log('[materials asset] loaded', BUILD); }catch(_){ }

  function norm(s){ try{ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }catch(_){ return String(s||'').toLowerCase(); } }

  function ensureStyles(){
    var STYLE_ID = 'wpd-materials-style-2025-11-01-01';
    if(document.getElementById(STYLE_ID)) return;
    var s=document.createElement('style'); s.id=STYLE_ID; s.textContent=
      '.wpd-materials{margin:12px 0 16px; padding:0; background:transparent; font:inherit; color:inherit}'+
      '.wpd-materials[hidden]{display:none!important}'+
      '.wpd-materials .wpd-materials__title:not(.product-siblings__heading){margin:8px 0 8px 0;font-size:14px;line-height:1.35;font-weight:400}'+
      '.wpd-materials__list{display:flex;flex-wrap:wrap;gap:8px}'+
      '.wpd-materials__btn{display:inline-flex;align-items:center;justify-content:center;padding:.6rem 1rem;border:1px solid var(--color-border,#ddd);border-radius:0!important;background:transparent!important;color:inherit;cursor:pointer;font:inherit;font-size:18px;line-height:1.15;min-height:2.9rem;}'+
      '.wpd-materials__btn:hover{border-color:var(--color-border-strong,#aaa);background:rgba(0,0,0,.04)!important}'+
      '.wpd-materials__btn:focus{outline:2px solid var(--color-accent,#2e7dff);outline-offset:1px}'+
      '.wpd-materials__btn[aria-checked="true"]{background:rgba(0,0,0,.05)!important;color:var(--color-foreground,#111)!important;border-color:var(--color-foreground,#111)!important;border-width:2px}'+
      '.wpd-materials__btn[aria-checked="true"]::before{content:"\\2713";display:inline-block;margin-right:.5rem;font-weight:700}'+
      '.wpd-materials__btn[disabled]{opacity:.55;cursor:default}';
    document.head.appendChild(s);
  }

  function render(root, items){
    var list = root.querySelector('.wpd-materials__list');
    var current = root.getAttribute('data-current') || '';
    var pref = root.getAttribute('data-sort-pref') || '';
    var minItems = (function(){
      try{ var v = parseInt(root.getAttribute('data-min-items')||'1',10); return isFinite(v)&&v>0? v : 1; }catch(_){ return 1; }
    })();
    function rankLabel(txt){ var x=norm(txt); var prefList=pref.split(',').map(function(s){return norm(s).trim();}).filter(Boolean); var prefMap={}; for(var i=0;i<prefList.length;i++){ prefMap[prefList[i]] = i; } return Object.prototype.hasOwnProperty.call(prefMap,x) ? prefMap[x] : 100; }

    list.innerHTML = '';
    if(!items || items.length < minItems){ root.setAttribute('hidden',''); return; }
    root.removeAttribute('hidden');
    items.sort(function(a,b){ var ra=rankLabel(a.material), rb=rankLabel(b.material); if(ra!==rb) return ra-rb; return String(a.material).localeCompare(String(b.material),'de'); });
    items.forEach(function(it){
      var el=document.createElement('span');
      el.className='wpd-materials__btn';
      el.setAttribute('role','radio');
      el.setAttribute('tabindex','0');
      var isActive = norm(it.material) === norm(current);
      el.setAttribute('aria-checked', String(isActive));
      el.textContent = it.material;
      function go(){ if(isActive) return; window.location.href = '/products/' + it.handle; }
      el.addEventListener('click', go);
      el.addEventListener('keydown', function(e){ var k=e.key||e.code; if(k==='Enter'||k===' '||k==='Spacebar'){ e.preventDefault(); go(); }});
      list.appendChild(el);
    });
  }

  function initOne(root){
    if(!root || root.__wpdMaterialsInited) return; root.__wpdMaterialsInited = true;
    ensureStyles();
    var title = root.getAttribute('data-title') || '';
    var vendor = root.getAttribute('data-vendor') || '';
    var shop = root.getAttribute('data-shop') || '';
    var group = root.getAttribute('data-group') || '';
    var proxy = root.getAttribute('data-proxy-url') || '/api/materials';
  var base = group ? (proxy + '?group=' + encodeURIComponent(group) + (vendor?('&vendor='+encodeURIComponent(vendor)):'') + (shop?('&shop='+encodeURIComponent(shop)):'') + '&limit=8')
       : (proxy + '?title=' + encodeURIComponent(title) + '&vendor=' + encodeURIComponent(vendor) + (shop?('&shop='+encodeURIComponent(shop)):'') + '&limit=8');
  // Enable diagnostics and vendorless fallback by default to be robust across vendor spelling differences
  var url = base + '&allowVendorFallback=1&debug=1&includeDraft=1';
    try{ console.log('[materials asset] init', { url: url, group: group||null, vendor: vendor||null }); }catch(_){ }
    fetch(url, { credentials:'omit' })
      .then(function(r){ if(!r.ok) throw new Error('materials:'+r.status); return r.json(); })
      .then(function(res){ var items = (res && res.items) || []; render(root, items); })
      .catch(function(e){ try{ console.warn('[materials asset] fetch failed', e); }catch(_){ } });
  }

  function scan(){
    var nodes = document.querySelectorAll('.wpd-materials');
    for(var i=0;i<nodes.length;i++) initOne(nodes[i]);
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', scan);
  } else {
    scan();
  }

  document.addEventListener('shopify:section:load', function(){ try{ scan(); }catch(_){ } });
  document.addEventListener('shopify:block:select', function(){ try{ scan(); }catch(_){ } });
})();
