(function(){
  try{ console.log('[wpd-swatches] v=2025-10-23-08 (restored with debug)'); }catch(_){ }
  if (window.__wpdSwatchesInit) return; window.__wpdSwatchesInit = true;
  var pageCache = { groups: {}, waiting: {}, handles: {} };
  var sched = { queue: [], running: 0, max: 2, minDelay: 300, last: 0 };
  function schedule(fn){
    return new Promise(function(resolve){
      sched.queue.push({ fn: fn, resolve: resolve });
      tick();
    });
  }
  function tick(){
    if(sched.running >= sched.max) return;
    var item = sched.queue.shift(); if(!item) return;
    var now = Date.now(); var wait = Math.max(0, sched.minDelay - (now - sched.last));
    sched.running++;
    setTimeout(function(){
      Promise.resolve().then(item.fn).then(function(res){ item.resolve(res); }).catch(function(err){ item.resolve(Promise.reject(err)); }).finally(function(){ sched.running--; sched.last = Date.now(); tick(); });
    }, wait);
  }
  function norm(s){
    try{
      return String(s||'')
        .toLowerCase()
        .replace(/\s+/g,'')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g,'');
    }catch(_){ return String(s||'').toLowerCase().replace(/\s+/g,''); }
  }
  function ready(fn){ if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', fn); } else { fn(); } }
  function pick(list, n){ var out=[]; for(var i=0;i<list.length && out.length<n;i++){ out.push(list[i]); } return out; }
  function uniqItems(list){ var out=[]; var seenH=new Set(); for(var i=0;i<list.length;i++){ var it=list[i]; if(!it||!it.handle) continue; var hk=String(it.handle); if(seenH.has(hk)) continue; seenH.add(hk); out.push(it);} return out; }
  function uniqByTitle(list){ var out=[]; var seenT=new Set(); for(var i=0;i<list.length;i++){ var it=list[i]; if(!it||!it.title) continue; var tk=norm(it.title); if(seenT.has(tk)) continue; seenT.add(tk); out.push(it);} return out; }
  function eq(a,b){ return norm(a) === norm(b); }
  function render(container, items){
    if(!container) return; container.innerHTML='';
    var wrap=document.createElement('div'); wrap.className='wpd-swatches-wrap';
    if(!document.getElementById('wpd-swatches-style')){
      var style=document.createElement('style'); style.id='wpd-swatches-style';
      style.textContent=[
        '.wpd-swatches-wrap{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:6px}',
        '.wpd-swatches-item{position:relative;display:block;width:100%;aspect-ratio:1/1;border:1px solid #eee;border-radius:4px;overflow:hidden;background:#fafafa}',
        '.wpd-swatches-img{position:absolute;inset:0;width:100%;height:100%;background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important}',
        '.wpd-swatches-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;background:rgba(0,0,0,0.35);pointer-events:none;user-select:none}'
      ].join('');
      document.head.appendChild(style);
    }
    try{ var card=findCard(container); var cardImg=card?card.querySelector('img'):null; if(cardImg&&cardImg.clientWidth){ wrap.style.maxWidth=cardImg.clientWidth+'px'; wrap.style.margin='6px auto 0'; } }catch(_){ }
    var items2=uniqByTitle(uniqItems(items)); var max=4; var show=pick(items2,max); var extra=items2.length-max;
    for(var i=0;i<show.length;i++){
      var a=document.createElement('a'); a.className='wpd-swatches-item'; a.href='/products/'+show[i].handle;
      var div=document.createElement('div'); div.className='wpd-swatches-img'; a.appendChild(div);
      (function(item,divEl){
        try{ var imgFromItem=null; if(item&&item.images&&Array.isArray(item.images)){ imgFromItem=item.images.length>1?(item.images[1].url||item.images[1]):(item.images[0]&&(item.images[0].url||item.images[0]))||null; } else if(item&&item.images&&item.images.nodes&&Array.isArray(item.images.nodes)){ var nodes=item.images.nodes; imgFromItem=nodes.length>1?(nodes[1].url||null):(nodes[0]&&(nodes[0].url||null)); } else if(item&&item.image2&&(item.image2.url||typeof item.image2==='string')){ imgFromItem=item.image2.url||item.image2; } if(imgFromItem){ var u2w0=imgFromItem+(String(imgFromItem).includes('?')?'&':'?')+'width=240'; divEl.style.backgroundImage='url("'+String(u2w0).replace(/"/g,'\\"')+'")'; } }catch(_){ }
        try{ if(!divEl.style.backgroundImage){ var u=(item.featuredImage&&item.featuredImage.url)?item.featuredImage.url:null; if(u){ var u0=u+(String(u).includes('?')?'&':'?')+'width=240'; divEl.style.backgroundImage='url("'+String(u0).replace(/"/g,'\\"')+'")'; } } }catch(_){ }
      })(show[i],div);
      if(i===max-1 && extra>0){ var overlay=document.createElement('span'); overlay.className='wpd-swatches-overlay'; overlay.textContent='+'+extra; a.appendChild(overlay); }
      wrap.appendChild(a);
    }
    container.appendChild(wrap); ensureSquares(wrap);
  }
  function getSecondImage(handle){
    try{ var key=String(handle||''); if(!key) return Promise.resolve(null); if(window.__wpdDisableProdJs){ return Promise.resolve(null); }
      if(pageCache.handles[key]&&pageCache.handles[key].status==='done') return Promise.resolve(pageCache.handles[key].url||null);
      if(pageCache.handles[key]&&pageCache.handles[key].status==='loading') return pageCache.handles[key].promise;
      var rec={ status:'loading', url:null, promise:null }; pageCache.handles[key]=rec;
      rec.promise=schedule(function(){ return fetch('/products/'+encodeURIComponent(key)+'.js',{credentials:'omit'}).then(function(r){ if(!r.ok){ if(r.status===401){ window.__wpdDisableProdJs=true; } throw r; } return r.json(); }) }).then(function(p){
        try{ var imgs=Array.isArray(p.images)?p.images:[]; var u2=imgs.length>1?imgs[1]:(imgs[0]||null); rec.status='done'; rec.url=u2||null; return rec.url; }catch(_){ rec.status='done'; rec.url=null; return null; }
      }).catch(function(){ rec.status='done'; rec.url=null; return null; }); return rec.promise;
    }catch(_){ return Promise.resolve(null); }
  }
  function ensureSquares(root){ try{ if(window.CSS&&CSS.supports&&CSS.supports('aspect-ratio','1/1')) return; var tiles=root.querySelectorAll('.wpd-swatches-item'); var setHeights=function(){ tiles.forEach?tiles.forEach(function(t){ t.style.height=t.clientWidth+'px'; }):Array.prototype.forEach.call(tiles,function(t){ t.style.height=t.clientWidth+'px'; }); }; setHeights(); window.addEventListener('resize', debounce(setHeights,100)); }catch(_){ } }
  function debounce(fn,wait){ var to=null; return function(){ clearTimeout(to); to=setTimeout(fn,wait); }; }
  function findCard(n){ if(!n) return null; var el=n; for(var i=0;i<8&&el;i++){ if(el.matches && (el.matches('[data-product-id]')||el.matches('[data-product-card]')||el.matches('.product-item')||el.matches('.grid__item')||el.matches('article')||el.matches('li'))){ return el; } el=el.parentElement; } return n.parentElement||null; }
  function loadGroupOnce(groupRaw,shop,proxyBase){ var key=norm(groupRaw||''); if(!key) return Promise.resolve({ ok:false, items:[] }); var entry=pageCache.groups[key]; if(entry&&entry.status==='done') return Promise.resolve(entry.itemsPayload); if(entry&&entry.status==='loading') return entry.promise; entry={ status:'loading', itemsPayload:null, promise:null }; pageCache.groups[key]=entry; try{ var ssKey='wpdGroup:'+key; var cached=sessionStorage.getItem(ssKey); if(cached){ var payload=JSON.parse(cached); entry.status='done'; entry.itemsPayload=payload; return Promise.resolve(payload); } }catch(_){ }
    var base=(proxyBase||'/api/siblings'); var targetMin=25; var outItems=[]; var cursor=null; var hasNext=true; var safety=0;
    function buildUrl(limit){ var u=base+'?group='+encodeURIComponent(groupRaw)+'&limit='+encodeURIComponent(limit||16); if(shop) u+='&shop='+encodeURIComponent(shop); if(cursor) u+='&cursor='+encodeURIComponent(cursor); return u; }
    function pump(){ if(!hasNext||outItems.length>=targetMin||safety>=6) return Promise.resolve(); safety++; var url=buildUrl(16); return schedule(function(){ return fetch(url,{credentials:'omit'}).then(function(r){ return r.json(); }) }).then(function(data){ try{ var items=Array.isArray(data&&data.items)?data.items:[]; try{ items=items.filter(function(it){ return !(it && it.title && String(it.title).toLowerCase().indexOf('muster')!==-1); }); }catch(_){ } var seen=new Set(outItems.map(function(i){ return i&&i.handle; })); for(var i=0;i<items.length;i++){ var it=items[i]; if(!it||!it.handle) continue; if(seen.has(it.handle)) continue; seen.add(it.handle); outItems.push(it);} hasNext=!!(data&&data.pageInfo&&data.pageInfo.hasNextPage); cursor=data&&data.pageInfo&&data.pageInfo.endCursor||null; }catch(_){ hasNext=false; } }).then(pump); }
    entry.promise=pump().then(function(){ entry.status='done'; entry.itemsPayload={ ok:true, items: outItems, pageInfo:{ hasNextPage: hasNext, endCursor: cursor } }; try{ sessionStorage.setItem('wpdGroup:'+key, JSON.stringify(entry.itemsPayload)); }catch(_){ } return entry.itemsPayload; }).catch(function(){ entry.status='done'; entry.itemsPayload={ ok:false, items:[] }; return entry.itemsPayload; }); return entry.promise; }
  function processNode(n){ if(!n||n.__wpdDone) return; var raw=n.getAttribute('data-group')||''; if(!raw){ n.__wpdDone=true; return; } var key=norm(raw); var shop=n.getAttribute('data-shop'); var proxy=n.getAttribute('data-proxy-url'); var vendor=n.getAttribute('data-vendor')||''; if(!pageCache.waiting[key]) pageCache.waiting[key]=[]; pageCache.waiting[key].push(n); loadGroupOnce(raw,shop,proxy).then(function(payload){ var items=(payload&&payload.items)?payload.items:[]; var originalCount=items.length; try{ items=items.filter(function(it){ return !(it && it.title && String(it.title).toLowerCase().indexOf('muster')!==-1); }); }catch(_){ } var afterMuster=items.length; try{ if(vendor){ items=items.filter(function(it){ return it && (it.vendor ? eq(it.vendor, vendor) : true); }); } }catch(_){ } var afterVendor=items.length; items=uniqByTitle(uniqItems(items)); var afterDedupe=items.length; try{ console.log('[wpd-swatches][debug] group='+raw+' key='+key+' total='+originalCount+' afterMuster='+afterMuster+' afterVendor='+afterVendor+' afterDedupe='+afterDedupe); }catch(_){ }
      var nodes=pageCache.waiting[key]||[]; pageCache.waiting[key]=[]; nodes.forEach(function(node){ if(!node||node.__wpdDone) return; var self=node.getAttribute('data-handle'); var filtered=items.filter(function(it){ return it && it.handle && it.handle !== self; }); filtered=uniqByTitle(uniqItems(filtered)); try{ console.log('[wpd-swatches][debug] render node handle='+self+' filtered='+filtered.length); }catch(_){ } render(node, filtered); node.__wpdDone=true; });
    }); }
  function init(){ try{ console.log('[wpd-swatches][debug] init start'); }catch(_){ } var nodes=Array.prototype.slice.call(document.querySelectorAll('.wpd-mini-swatches')); if(!nodes.length) return; try{ var groups={}; nodes.forEach(function(n){ var raw=n.getAttribute('data-group')||''; if(!raw) return; var key=norm(raw); (groups[key]||(groups[key]=[])).push(n); }); Object.keys(groups).forEach(function(k){ var arr=groups[k]; if(!arr||arr.length<=1) return; for(var i=1;i<arr.length;i++){ var card=findCard(arr[i]); if(card){ card.classList.add('wpd-dup-hidden'); card.setAttribute('aria-hidden','true'); card.style.display='none'; } } }); if(!document.getElementById('wpd-dup-style')){ var s=document.createElement('style'); s.id='wpd-dup-style'; s.textContent='.wpd-dup-hidden{display:none!important}'; document.head.appendChild(s); } }catch(_){ }
    var observer=null; if('IntersectionObserver' in window){ observer=new IntersectionObserver(function(entries){ entries.forEach(function(entry){ if(entry.isIntersecting){ processNode(entry.target); observer.unobserve(entry.target); } }); }, { root:null, rootMargin:'0px 0px 200px 0px', threshold:0.01 }); }
    nodes.forEach(function(n){ if(observer){ observer.observe(n); } else { processNode(n); } }); if('MutationObserver' in window){ var mo=new MutationObserver(function(muts){ muts.forEach(function(m){ if(m.type==='childList' && m.addedNodes && m.addedNodes.length){ for(var i=0;i<m.addedNodes.length;i++){ var node=m.addedNodes[i]; if(!(node instanceof Element)) continue; if(node.classList && node.classList.contains('wpd-mini-swatches')){ try{ var g=node.getAttribute('data-group')||''; if(g){ var key=norm(g); var first=document.querySelector('.wpd-mini-swatches[data-group="'+g.replace(/"/g,'\\"')+'"]'); if(first && first!==node){ var card=findCard(node); if(card){ card.classList.add('wpd-dup-hidden'); card.setAttribute('aria-hidden','true'); card.style.display='none'; } } } }catch(_){ } if(observer){ observer.observe(node); } else { processNode(node); } } else { var list=node.querySelectorAll?node.querySelectorAll('.wpd-mini-swatches'):[]; if(list && list.length){ list.forEach?list.forEach(function(x){ try{ var g=x.getAttribute('data-group')||''; if(g){ var key=norm(g); var first=document.querySelector('.wpd-mini-swatches[data-group="'+g.replace(/"/g,'\\"')+'"]'); if(first && first!==x){ var card=findCard(x); if(card){ card.classList.add('wpd-dup-hidden'); card.setAttribute('aria-hidden','true'); card.style.display='none'; } } } }catch(_){ } if(observer){ observer.observe(x); } else { processNode(x); } }):Array.prototype.forEach.call(list,function(x){ try{ var g=x.getAttribute('data-group')||''; if(g){ var key=norm(g); var first=document.querySelector('.wpd-mini-swatches[data-group="'+g.replace(/"/g,'\\"')+'"]'); if(first && first!==x){ var card=findCard(x); if(card){ card.classList.add('wpd-dup-hidden'); card.setAttribute('aria-hidden','true'); card.style.display='none'; } } } }catch(_){ } if(observer){ observer.observe(x); } else { processNode(x); } }); } } } } }); mo.observe(document.body,{ childList:true, subtree:true }); }
  }
  ready(function(){ if('requestIdleCallback' in window){ requestIdleCallback(init,{ timeout:1200 }); } else { setTimeout(init,200); } });
})();
