(function(){
  function tail(s){ return s ? String(s).slice(-6) : 'none'; }
  function onReady(fn){ if(document.readyState === 'loading'){ document.addEventListener('DOMContentLoaded', fn); } else { fn(); } }
  onReady(function(){
    try{
      var nodes = document.querySelectorAll('.product-siblings[id^="product-siblings-"]');
      if(!nodes || !nodes.length){ console.log('[siblings-probe] no section nodes found'); return; }
      console.log('[siblings-probe] found sections:', nodes.length);
      nodes.forEach(function(root){
        try{
          var grid = root.querySelector('.product-siblings__grid');
          var statusEl = root.querySelector('.product-siblings__status');
          var token = root.getAttribute('data-sf-token');
          var vendor = root.getAttribute('data-product-vendor');
          var code = root.getAttribute('data-group-code');
          var codeRaw = root.getAttribute('data-group-raw');
          console.log('[siblings-probe] ctx', { id: root.id, vendor: vendor, code: code, codeRaw: codeRaw, tokenTail: tail(token) });
          if(statusEl){ statusEl.textContent = 'Debug: Section erkannt (Probe)'; statusEl.hidden = false; }
          // mark initialized
          root.setAttribute('data-probe','1');
        }catch(e){ console.warn('[siblings-probe] error for node', e); }
      });
    }catch(e){ console.warn('[siblings-probe] failed', e); }
  });
})();
