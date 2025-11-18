(function(){
  try{ if(window.__WPD_CARD_IMG_INIT) return; window.__WPD_CARD_IMG_INIT=true; console.log('[wpd-card-image] v=2025-11-18-01'); }catch(_){ }
  function ready(fn){ if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', fn); } else { fn(); } }
  function findCardRoot(n){
    var el=n; var tries=0;
    while(el && tries<8){
      if(el.matches && (el.matches('[data-product-card]') || el.matches('[data-product-id]') || el.matches('.card') || el.matches('.product-item') || el.matches('article') || el.matches('li'))){ return el; }
      el = el.parentElement; tries++;
    }
    return n && n.parentElement || null;
  }
  function pickImageEl(card){
    if(!card) return null;
    // Common themes (Dawn & forks)
    var sel = [
      'img[class*="product__media"], .card__inner img, .card__media img',
      '.product-item img',
      'img'
    ];
    for(var i=0;i<sel.length;i++){
      var img = card.querySelector(sel[i]);
      if(img) return img;
    }
    return null;
  }
  function setImage(imgEl, url){
    if(!imgEl || !url) return;
    try{
      var u = String(url);
      // Prefer width parameter if theme uses srcset; set both for safety
      var u600 = u + (u.indexOf('?')>=0 ? '&' : '?') + 'width=600';
      var u900 = u + (u.indexOf('?')>=0 ? '&' : '?') + 'width=900';
      imgEl.src = u600;
      if('srcset' in imgEl){ imgEl.setAttribute('srcset', u600 + ' 600w, ' + u900 + ' 900w'); }
      if('sizes' in imgEl && !imgEl.getAttribute('sizes')){ imgEl.setAttribute('sizes','(min-width: 990px) 25vw, 50vw'); }
      // Some themes lazy-load via data-src/data-srcset
      imgEl.setAttribute('data-src', u600);
      imgEl.setAttribute('data-srcset', u600 + ' 600w, ' + u900 + ' 900w');
      // If using background-image wrappers, try to update CSS var if present
      var wrap = imgEl.closest && imgEl.closest('.media') || imgEl.parentElement;
      if(wrap && wrap.style && wrap.style.getPropertyValue('--image-url')!==undefined){
        wrap.style.setProperty('--image-url', 'url("'+u600.replace(/"/g,'\\"')+'")');
      }
    }catch(_){ }
  }
  function process(n){
    if(!n || n.__wpdImgDone) return; n.__wpdImgDone=true;
    var url = n.getAttribute('data-wd-picture'); if(!url) return;
    var card = findCardRoot(n); if(!card) return;
    var img = pickImageEl(card); if(!img) return;
    setImage(img, url);
  }
  function init(){
    var nodes = document.querySelectorAll('.wpd-mini-swatches[data-wd-picture]');
    nodes.forEach ? nodes.forEach(process) : Array.prototype.forEach.call(nodes, process);

    if('MutationObserver' in window){
      var mo = new MutationObserver(function(muts){
        muts.forEach(function(m){ if(m.type==='childList' && m.addedNodes){ for(var i=0;i<m.addedNodes.length;i++){ var node=m.addedNodes[i]; if(!(node instanceof Element)) continue; var list=node.matches && node.matches('.wpd-mini-swatches[data-wd-picture]') ? [node] : (node.querySelectorAll ? node.querySelectorAll('.wpd-mini-swatches[data-wd-picture]') : []); if(list && list.length){ list.forEach ? list.forEach(process) : Array.prototype.forEach.call(list, process); } } } });
      });
      mo.observe(document.body, { childList:true, subtree:true });
    }
  }
  ready(function(){ if('requestIdleCallback' in window){ requestIdleCallback(init, { timeout: 1200 }); } else { setTimeout(init, 200); } });
})();