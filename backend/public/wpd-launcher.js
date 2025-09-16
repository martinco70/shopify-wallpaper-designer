(function(){
  // Version marker for cache/debug
  try { window.__WPD_LAUNCHER_VERSION__ = '20250902-12'; } catch(_) {}
  if (window.__WPD_LAUNCHER__ && !window.__WPD_LAUNCHER_FORCE__) return; // load once unless forced
  // If FORCE flag present, allow this script to take over and then clear the flag
  if (window.__WPD_LAUNCHER_FORCE__) { try { delete window.__WPD_LAUNCHER_FORCE__; } catch(_) {} }
  window.__WPD_LAUNCHER__ = true;
  // Reentrancy guards
  window.__WPD_OPEN_LOCK__ = window.__WPD_OPEN_LOCK__ || false;
  window.__WPD_LAST_OPEN_TS__ = window.__WPD_LAST_OPEN_TS__ || 0;
  // Public API for inline handlers
  try {
    window.WPD = window.WPD || {};
    window.WPD.open = function(el){
      try { if (el && el.closest) { openFor(el.closest('[data-wpd]') || el); } else { openFor(document.querySelector('[data-wpd] [data-wpd-open]') || document.body); } } catch(_) {}
    };
    window.WPD.version = window.__WPD_LAUNCHER_VERSION__;
  } catch(_) {}

  // ===== WPD DEBUG TRACE (Removable) BEGIN =====
  // Purpose: trace synthetic clicks/handlers causing double-open. Disabled by default.
  // Activate in console: WPD.debug.enable() or set localStorage.wpd_debug_trace = '1'
  // Deactivate: WPD.debug.disable() or delete localStorage.wpd_debug_trace
  try {
    var __WPD_DBG = window.__WPD_DBG = window.__WPD_DBG || { installed:false, orig:{} };
    function isTrigger(el){ try { return !!(el && el.closest && (el.matches('[data-wpd-open]') || el.closest('[data-wpd] [data-wpd-open]'))); } catch(_) { return false; } }
    function installDebug(){
      if (__WPD_DBG.installed) return; __WPD_DBG.installed = true;
      // Save originals
      __WPD_DBG.orig.click = HTMLElement.prototype.click;
      __WPD_DBG.orig.dispatchEvent = EventTarget.prototype.dispatchEvent;
      __WPD_DBG.orig.addEventListener = EventTarget.prototype.addEventListener;
      // Wraps
      try {
        HTMLElement.prototype.click = function(){
          if (isTrigger(this)) { try { console.debug('[WPD-TRACE] HTMLElement.click()', this); console.trace && console.trace(); } catch(_) {} }
          return __WPD_DBG.orig.click.apply(this, arguments);
        };
      } catch(_) {}
      try {
        EventTarget.prototype.dispatchEvent = function(evt){
          if (evt && evt.type==='click' && isTrigger(this)) { try { console.debug('[WPD-TRACE] dispatchEvent(click)', this); console.trace && console.trace(); } catch(_) {} }
          return __WPD_DBG.orig.dispatchEvent.call(this, evt);
        };
      } catch(_) {}
      try {
        EventTarget.prototype.addEventListener = function(type, listener, opts){
          if (type==='click' && isTrigger(this)) { try { console.debug('[WPD-TRACE] addEventListener(click)', this, listener && (listener.name || 'anon')); } catch(_) {} }
          return __WPD_DBG.orig.addEventListener.call(this, type, listener, opts);
        };
      } catch(_) {}
      // Variant change log
      try {
        var idInput = document.querySelector('form[action*="/cart/add"] input[name="id"]');
        if (idInput && !idInput.__wpdDbgBound) { idInput.addEventListener('change', function(){ try { console.debug('[WPD-TRACE] variant change', idInput.value); } catch(_) {} }, true); idInput.__wpdDbgBound = true; }
      } catch(_) {}
      try { console.info('%cWPD debug trace enabled','color:#8C6A00'); } catch(_) {}
    }
    function uninstallDebug(){
      if (!__WPD_DBG.installed) return; __WPD_DBG.installed = false;
      try { if (__WPD_DBG.orig.click) HTMLElement.prototype.click = __WPD_DBG.orig.click; } catch(_) {}
      try { if (__WPD_DBG.orig.dispatchEvent) EventTarget.prototype.dispatchEvent = __WPD_DBG.orig.dispatchEvent; } catch(_) {}
      try { if (__WPD_DBG.orig.addEventListener) EventTarget.prototype.addEventListener = __WPD_DBG.orig.addEventListener; } catch(_) {}
      try { console.info('%cWPD debug trace disabled','color:#8C6A00'); } catch(_) {}
    }
    window.WPD = window.WPD || {};
    window.WPD.debug = window.WPD.debug || { enable:function(){ try { localStorage.setItem('wpd_debug_trace','1'); } catch(_) {} installDebug(); }, disable:function(){ try { localStorage.removeItem('wpd_debug_trace'); } catch(_) {} uninstallDebug(); } };
    // Auto-enable if flagged globally or persisted
    try { if (window.__WPD_DEBUG_TRACE__ || (localStorage.getItem('wpd_debug_trace') === '1')) installDebug(); } catch(_) {}
  } catch(_) {}
  // ===== WPD DEBUG TRACE (Removable) END =====

  var STYLE_ID = 'wpd-launcher-styles';

  function injectStylesOnce(){
    if (document.getElementById(STYLE_ID)) return;
    // Inject Proza Libre font like the app uses
    try {
      if (!document.querySelector('link[data-wpd-font]')) {
        var l1 = document.createElement('link'); l1.rel = 'preconnect'; l1.href = 'https://fonts.googleapis.com'; l1.setAttribute('data-wpd-font','1'); document.head.appendChild(l1);
        var l2 = document.createElement('link'); l2.rel = 'preconnect'; l2.href = 'https://fonts.gstatic.com'; l2.crossOrigin = 'anonymous'; l2.setAttribute('data-wpd-font','1'); document.head.appendChild(l2);
        var l3 = document.createElement('link'); l3.rel = 'stylesheet'; l3.href = 'https://fonts.googleapis.com/css2?family=Proza+Libre:wght@400;600;700&display=swap'; l3.setAttribute('data-wpd-font','1'); document.head.appendChild(l3);
      }
    } catch(_) {}
    var css = ''
      + '.wpd-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.6)}'
      + '.wpd-overlay[hidden]{display:none!important}'
      + '.wpd-modal{position:absolute;inset:5vh 5vw;background:#fff;border-radius:8px;'
      + ' box-shadow:0 10px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;overflow:hidden;min-height:300px}'
      + '.wpd-header{display:flex;align-items:center;justify-content:space-between;padding:.75rem 1rem;border-bottom:1px solid #eee}'
      + '.wpd-title{margin:0;font-size:1rem;font-weight:600}'
  + '.wpd-close{font-family:"Proza Libre",system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;font-weight:600;font-size:.95rem;line-height:1.1;padding:10px 14px;border:1px solid var(--border, #e6e6e6)!important;border-radius:0;background:var(--ui-bg, #F4F2EC)!important;color:#222!important;cursor:pointer;transition:background 120ms ease, box-shadow 120ms ease, border-color 120ms ease}'
  + '.wpd-close:hover{background:#E9E5D7}'
  + '.wpd-close:active{background:#E1DCCB}'
  + '.wpd-close:focus{outline:none;box-shadow:0 0 0 3px rgba(var(--zoom-accent-rgb,140,106,0),.25);border-color:var(--zoom-accent,#8C6A00)}'
      + '.wpd-body{position:relative;flex:1;min-height:200px}'
      + '.wpd-frame{position:absolute;inset:0;width:100%;height:100%;border:0}'
      + 'body.wpd-no-scroll{overflow:hidden!important}'
      + 'button.wpd-launcher-btn, .wpd-launcher-btn{display:inline-block;font-family:"Proza Libre",system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;font-weight:600;font-size:.95rem;line-height:1.1;padding:10px 14px;border:1px solid var(--border, #e6e6e6)!important;border-radius:0;background:var(--ui-bg, #F4F2EC)!important;color:#222!important;cursor:pointer;transition:background 120ms ease, box-shadow 120ms ease, border-color 120ms ease}'
      + 'button.wpd-launcher-btn:hover, .wpd-launcher-btn:hover{background:#E9E5D7!important}'
      + 'button.wpd-launcher-btn:active, .wpd-launcher-btn:active{background:#E1DCCB!important}'
      + 'button.wpd-launcher-btn:focus, .wpd-launcher-btn:focus{outline:none;box-shadow:0 0 0 3px rgba(var(--zoom-accent-rgb,140,106,0),.25);border-color:var(--zoom-accent,#8C6A00)!important}';
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.appendChild(document.createTextNode(css));
    document.head.appendChild(st);
  }

  function buildOverlay(opts){
    // opts: { id, title, backend, shop, productId, sku, image, price }
    var id = opts.id;
    var overlayId = 'wpd-overlay-' + id;
    var existing = document.getElementById(overlayId);
    if (existing) {
      // Update title and iframe URL when re-opening to reflect current selection
      var titleEl = existing.querySelector('.wpd-title');
      if (titleEl) titleEl.textContent = (opts.title || 'Konfigurator');
      var frameEl = existing.querySelector('iframe.wpd-frame');
      if (frameEl) {
        var qUpd = new URLSearchParams({ backend: opts.backend, shop: opts.shop || '', productId: String(opts.productId || ''), sku: opts.sku || '' });
        if (opts.image != null && String(opts.image).trim() !== '') qUpd.set('image', opts.image);
        if (opts.price != null && String(opts.price).trim() !== '') qUpd.set('price', String(opts.price));
        var originUpd = (opts.backend || '').replace(/\/$/, '');
        var newUrl = originUpd + '/designer/index.html?' + qUpd.toString();
        // Compare ignoring cache-buster to avoid duplicate reloads
        try {
          var curr = new URL(frameEl.src, window.location.href);
          curr.searchParams.delete('_ts');
          var currNoTs = curr.origin + curr.pathname + (curr.search ? ('?' + curr.searchParams.toString()) : '');
          if (currNoTs !== newUrl) {
            frameEl.src = newUrl + '&_ts=' + Date.now();
          }
        } catch(_) {
          // Fallback: always set if parsing fails
          frameEl.src = newUrl + '&_ts=' + Date.now();
        }
      }
      return existing;
    }

    var overlay = document.createElement('div');
    overlay.className = 'wpd-overlay';
    overlay.id = overlayId;
    overlay.setAttribute('hidden','');

    overlay.innerHTML = ''
      + '<div class="wpd-modal" role="dialog" aria-modal="true" aria-labelledby="'+overlayId+'-title">'
      + '  <div class="wpd-header">'
  + '    <h3 class="wpd-title" id="'+overlayId+'-title">' + (opts.title || 'Konfigurator') + '</h3>'
  + '    <button type="button" class="wpd-close" aria-label="Schließen" title="Zurück">Zurück</button>'
      + '  </div>'
      + '  <div class="wpd-body"></div>'
      + '</div>';

    document.body.appendChild(overlay);

  var body = overlay.querySelector('.wpd-body');
  var frame = document.createElement('iframe');
  frame.className = 'wpd-frame';
  frame.setAttribute('referrerpolicy', 'no-referrer');
  // Build URL to designer app with query params
  var q = new URLSearchParams({ backend: opts.backend, shop: opts.shop || '', productId: String(opts.productId || ''), sku: opts.sku || '' });
  if (opts.image != null && String(opts.image).trim() !== '') q.set('image', opts.image);
  if (opts.price != null && String(opts.price).trim() !== '') q.set('price', String(opts.price));
  var origin = (opts.backend || '').replace(/\/$/, '');
  frame.src = origin + '/designer/index.html?' + q.toString() + '&_ts=' + Date.now();
  body.appendChild(frame);

  var closeBtn = overlay.querySelector('.wpd-close');
  function close(){ overlay.setAttribute('hidden',''); document.body.classList.remove('wpd-no-scroll'); }
  closeBtn.addEventListener('click', function(){
    close();
    // Optional reload: opt-in via global flag
    try { if (window.__WPD_RELOAD_ON_CLOSE__) window.location.reload(); } catch(_) {}
  });
    overlay.addEventListener('click', function(e){
      if (e.target === overlay) {
        close();
        try { if (window.__WPD_RELOAD_ON_CLOSE__) window.location.reload(); } catch(_) {}
      }
    });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !overlay.hasAttribute('hidden')) { close(); try { if (window.__WPD_RELOAD_ON_CLOSE__) window.location.reload(); } catch(_) {} } });

    return overlay;
  }

  function readVariantImageFromDOM(container){
    try {
      // Prefer a hidden per-variant map rendered by Liquid (variant metafield only)
      var input = document.querySelector('form[action*="/cart/add"] input[name="id"]');
      var currentId = input && input.value ? String(input.value) : '';
      if (currentId) {
        var mapEl = document.querySelector('#wpd-variant-metafields [data-variant-id="' + currentId + '"]');
        if (mapEl) {
          var u0 = mapEl.getAttribute('data-wd-picture');
          if (u0) return u0;
        }
      }
      // Common pattern: selected variant button/link carries data-variant-id and optionally wd-picture url
      var sel = document.querySelector('[data-variant-id].is-selected, [data-variant-id].active');
      if (sel) {
        var val = sel.getAttribute('data-wd-picture')
               || sel.getAttribute('data-wd_picture')
               || sel.getAttribute('data-image-variant');
        if (val) return val;
      }
      // Alternative: theme updates a single current-image holder
      var holder = document.querySelector('[data-wpd-current-image]');
      if (holder) {
        var u = holder.getAttribute('data-wpd-current-image') || holder.textContent || holder.innerText;
        if (u && /https?:\/\//i.test(u)) return u.trim();
      }
    } catch(_) {}
    return '';
  }

  function resolveImage(container){
    // Read fresh on every click from DOM, then fallback to container dataset
    var ds = (container && container.dataset) ? container.dataset : {};
    var fromDom = readVariantImageFromDOM(container);
    if (fromDom) return fromDom;
    return ds.imageVariant || '';
  }

  function readVariantPriceFromDOM(){
    try {
      var input = document.querySelector('form[action*="/cart/add"] input[name="id"]');
      var currentId = input && input.value ? String(input.value) : '';
      if (currentId) {
        var mapEl = document.querySelector('#wpd-variant-metafields [data-variant-id="' + currentId + '"]');
        if (mapEl) {
          var p = mapEl.getAttribute('data-wd-price');
          if (p) return p;
        }
      }
    } catch(_) {}
    return '';
  }

  function resolvePrice(){
    var p = readVariantPriceFromDOM();
    return p || '';
  }

  function openFor(container){
    // Debounce rapid re-opens
    var now = Date.now();
    if (window.__WPD_OPEN_LOCK__ || (now - window.__WPD_LAST_OPEN_TS__ < 600)) {
      return; // ignore rapid duplicate triggers
    }
    window.__WPD_OPEN_LOCK__ = true;
    window.__WPD_LAST_OPEN_TS__ = now;
    var ds = container.dataset || {};
    var id = ds.wpdId || (ds.productId ? ('' + ds.productId) : 'default');
    var backend = ds.backend || (window.WALLPAPER_BACKEND || 'https://app.wirzapp.ch');
    var shop = ds.shop || '';
    var productId = ds.productId || '';
    var sku = ds.sku || '';
    var image = resolveImage(container);
  var price = resolvePrice();
    var title = ds.title || document.title;

    injectStylesOnce();
  var ov = buildOverlay({ id: id, title: title, backend: backend, shop: shop, productId: productId, sku: sku, image: image, price: price });
    ov.removeAttribute('hidden');
    document.body.classList.add('wpd-no-scroll');
    try { ov.querySelector('.wpd-close').focus(); } catch(e) {}
    // Release lock shortly after showing
    setTimeout(function(){ window.__WPD_OPEN_LOCK__ = false; }, 400);
  }

  function handleTriggerClick(e){
    try {
    // De-dupe within the same event dispatch
    if (e && e.__wpdHandled) return;
      if (!e) return;
    e.__wpdHandled = true;
  var trigger = e.target && e.target.closest && e.target.closest('[data-wpd-open]');
      if (!trigger) return;
      var container = trigger.closest('[data-wpd]') || trigger;
      // Strongly suppress other handlers (old popup scripts)
      if (e.preventDefault) e.preventDefault();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (e.stopPropagation) e.stopPropagation();
      openFor(container);
      return false;
    } catch(_) {}
  }

  // Global delegated click handler (capture) to preempt theme handlers
  document.addEventListener('click', handleTriggerClick, true);

  // Listen to messages from the embedded designer to add items to cart or close overlay
  function currentVariantId(){
    try {
      var input = document.querySelector('form[action*="/cart/add"] input[name="id"]');
      if (input && input.value) return String(input.value);
    } catch(_) {}
    return '';
  }
  async function addToCartFromMessage(msg){
    try {
      var props = msg && msg.properties || {};
      var qty = Number(msg && msg.quantity) || 1;
      var id = currentVariantId();
      if (!id) return;
      var payload = { items: [{ id: id, quantity: qty, properties: props }] };
      var res = await fetch('/cart/add.js', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(payload), credentials: 'same-origin' });
      if (!res.ok) {
        try { console.warn('[WPD] cart add failed', res.status); } catch(_) {}
      } else {
        // Optionally open cart drawer if theme exposes it
        try { document.dispatchEvent(new CustomEvent('wpd:cart:added', { detail: payload })); } catch(_) {}
      }
    } catch(_) {}
  }
  window.addEventListener('message', function(e){
    try {
      var data = e && e.data;
      if (!data || data.source !== 'wpd') return;
      if (data.type === 'wpd.cart.add') {
        addToCartFromMessage(data);
      } else if (data.type === 'wpd.overlay.close') {
        try {
          var ov = document.querySelector('.wpd-overlay');
          if (ov) ov.setAttribute('hidden','');
          document.body.classList.remove('wpd-no-scroll');
        } catch(_) {}
      }
    } catch(_) {}
  }, false);

  // Auto-upgrade any plain buttons to launcher style
  function upgradeButtons(){
    // Strip legacy handlers and style triggers; click handling stays delegated globally
    var btns = document.querySelectorAll('[data-wpd] [data-wpd-open]');
    for (var i=0; i<btns.length; i++) {
      var b = btns[i];
      if (!b) continue;
      try { b.removeAttribute('onclick'); } catch(_) {}
      if (!b.__wpdStripped) {
        var clone = b.cloneNode(true);
        if (b.parentNode) { b.parentNode.replaceChild(clone, b); }
        b = clone;
        b.__wpdStripped = true;
      }
      if (!b.classList.contains('wpd-launcher-btn')) b.classList.add('wpd-launcher-btn');
    }
    // Ensure only one overlay instance exists
    try {
      var overlays = document.querySelectorAll('.wpd-overlay');
      for (var j=1; j<overlays.length; j++) {
        if (overlays[j] && overlays[j].parentNode) overlays[j].parentNode.removeChild(overlays[j]);
      }
    } catch(_) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', upgradeButtons);
  } else { upgradeButtons(); }

  // Observe DOM for dynamically added triggers and re-run upgrade
  try {
    var mo = new MutationObserver(function(){ upgradeButtons(); });
    mo.observe(document.documentElement || document.body, {childList:true, subtree:true});
  } catch(_) {}

})();
