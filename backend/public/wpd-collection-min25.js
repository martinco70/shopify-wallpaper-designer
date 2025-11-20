(function(){
  // Global kill switch: if set, do nothing at all
  if (typeof window !== 'undefined' && window.__WPD_DISABLE_MIN25 === true) return;
  if (window.__wpdMin25Init) return; window.__wpdMin25Init = true;
  try{ console.log('[wpd-min25] init'); }catch(_){ }
  function ready(fn){ if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', fn); } else { fn(); } }
  function text(el){ return (el && (el.textContent||el.innerText||'')).trim(); }
  function findLoadMore(){
    // Heuristics: button or link containing "Mehr Produkte anzeigen"
    var btns = Array.prototype.slice.call(document.querySelectorAll('button, a'));
    for(var i=0;i<btns.length;i++){
      var t = text(btns[i]).toLowerCase();
      if (t.includes('mehr produkte anzeigen') || t.includes('load more') || t.includes('mehr anzeigen')) return btns[i];
    }
    // Fallback: data attribute some themes use
    var el = document.querySelector('[data-load-more], .collection__load-more, .js-load-more');
    return el || null;
  }
  function countCards(){
    // Try common selectors
    var sels = [
      '[data-product-card]',
      '.product-grid .grid__item',
      '.collection .grid__item',
      '.product-grid .product-item',
      '.grid--view-items .grid__item',
      'li.grid__item'
    ];
    for(var i=0;i<sels.length;i++){
      var n = document.querySelectorAll(sels[i]);
      if (n && n.length) return n.length;
    }
    return 0;
  }
  function ensureMin25(){
    var target = 25;
    var attempts = 0; var maxAttempts = 8; // safety
    function step(){
      var cnt = countCards();
      if (cnt >= target) { try{ console.log('[wpd-min25] count', cnt); }catch(_){ } return; }
      var load = findLoadMore();
      if (!load || attempts>=maxAttempts) { try{ console.log('[wpd-min25] stopped', { count: cnt, attempts: attempts }); }catch(_){ } return; }
      attempts++;
      try{ load.click(); }catch(_){ }
      setTimeout(step, 800);
    }
    step();
  }
  ready(function(){
    // Only on collection/listing pages (best-effort)
    var isCollection = document.body && (document.body.className||'').toLowerCase().includes('template-collection');
    var hasProductGrid = document.querySelector('#main-collection-product-grid, .product-grid, .collection');
    if (isCollection || hasProductGrid) ensureMin25();
  });
})();
