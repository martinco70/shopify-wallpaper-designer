(function(){
  // Version marker for cache/debug
  try { window.__WPD_LAUNCHER_VERSION__ = '20251107-05'; } catch(_) {}
  if (window.__WPD_LAUNCHER__ && !window.__WPD_LAUNCHER_FORCE__) return; // load once unless forced
  // If FORCE flag present, allow this script to take over and then clear the flag
  if (window.__WPD_LAUNCHER_FORCE__) { try { delete window.__WPD_LAUNCHER_FORCE__; } catch(_) {} }
  window.__WPD_LAUNCHER__ = true;
  // Reentrancy guards
  window.__WPD_OPEN_LOCK__ = window.__WPD_OPEN_LOCK__ || false;
  window.__WPD_LAST_OPEN_TS__ = window.__WPD_LAST_OPEN_TS__ || 0;
  // Visible init log (info-level so it shows even when "Verbose" is off)
  try { console.info('[WPD] launcher loaded v=' + (window.__WPD_LAUNCHER_VERSION__ || '?')); } catch(_) {}
  // Last clicked trigger snapshot for style/state restoration
  window.__WPD_LAST_TRIGGER_SNAPSHOT__ = window.__WPD_LAST_TRIGGER_SNAPSHOT__ || null;
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

  // Split Styles: always load overlay layout, button styles only if opt-in.
  var OVERLAY_STYLE_ID = 'wpd-overlay-core-styles';
  var BUTTON_STYLE_ID = 'wpd-launcher-styles';

  // Centralized close: remove overlays, restore scroll and trigger styling
  function __wpd_closeAll(){
    try {
      var overlays = document.querySelectorAll('.wpd-overlay');
      for (var i=0; i<overlays.length; i++) {
        var ov = overlays[i];
        try { ov.parentNode && ov.parentNode.removeChild(ov); } catch(_) {}
      }
    } catch(_) {}
    try { document.body.classList.remove('wpd-no-scroll'); } catch(_) {}
    // Restore last trigger snapshot (if present)
    try {
      var snap = window.__WPD_LAST_TRIGGER_SNAPSHOT__;
      if (snap && snap.el && snap.el.isConnected) {
        // Restore class list and inline style as a best-effort reset
        if (typeof snap.className === 'string') snap.el.className = snap.className;
        if (typeof snap.styleText === 'string') snap.el.setAttribute('style', snap.styleText);
        // Restore selected attributes
        if (snap.attrs) {
          for (var k in snap.attrs) {
            if (!Object.prototype.hasOwnProperty.call(snap.attrs,k)) continue;
            var v = snap.attrs[k];
            if (v === null) { try { snap.el.removeAttribute(k); } catch(_) {} }
            else { try { snap.el.setAttribute(k, v); } catch(_) {} }
          }
        }
      }
    } catch(_) {}
    try { window.__WPD_LAST_TRIGGER_SNAPSHOT__ = null; } catch(_) {}
    try { console.info('[WPD] overlay closed'); } catch(_) {}
  }

  function injectOverlayStyles(){
    if (document.getElementById(OVERLAY_STYLE_ID)) return;
    try {
      if (!document.querySelector('link[data-wpd-font]')) {
        var l1 = document.createElement('link'); l1.rel='preconnect'; l1.href='https://fonts.googleapis.com'; l1.setAttribute('data-wpd-font','1'); document.head.appendChild(l1);
        var l2 = document.createElement('link'); l2.rel='preconnect'; l2.href='https://fonts.gstatic.com'; l2.crossOrigin='anonymous'; l2.setAttribute('data-wpd-font','1'); document.head.appendChild(l2);
        var l3 = document.createElement('link'); l3.rel='stylesheet'; l3.href='https://fonts.googleapis.com/css2?family=Proza+Libre:wght@400;600;700&display=swap'; l3.setAttribute('data-wpd-font','1'); document.head.appendChild(l3);
      }
    } catch(_){}
    var css = ''
      + '.wpd-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.6)}'
      + '.wpd-overlay[hidden]{display:none!important}'
      + '.wpd-modal{position:absolute;inset:5vh 5vw;background:#fff;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;overflow:hidden;min-height:300px}'
      + '.wpd-header{display:flex;align-items:center;justify-content:space-between;padding:.75rem 1rem;border-bottom:1px solid #eee}'
      + '.wpd-title{margin:0;font-size:1rem;font-weight:600}'
      + '.wpd-close{font-family:"Proza Libre",system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;font-weight:600;font-size:.95rem;line-height:1.1;padding:10px 14px;border:1px solid var(--border,#e6e6e6)!important;border-radius:0;background:var(--ui-bg,#F4F2EC)!important;color:#222!important;cursor:pointer;transition:background 120ms ease,box-shadow 120ms ease,border-color 120ms ease}'
      + '.wpd-close:hover{background:#E9E5D7}'
      + '.wpd-close:active{background:#E1DCCB}'
      + '.wpd-close:focus{outline:none;box-shadow:0 0 0 3px rgba(var(--zoom-accent-rgb,140,106,0),.25);border-color:var(--zoom-accent,#8C6A00)}'
      + '.wpd-body{position:relative;flex:1;min-height:200px}'
      + '.wpd-frame{position:absolute;inset:0;width:100%;height:100%;border:0}'
      + 'body.wpd-no-scroll{overflow:hidden!important}';
    var st=document.createElement('style'); st.id=OVERLAY_STYLE_ID; st.appendChild(document.createTextNode(css)); document.head.appendChild(st);
  }

  function injectButtonStyles(){
    if (document.getElementById(BUTTON_STYLE_ID)) return;
    var css = ''
      + 'button.wpd-launcher-btn, .wpd-launcher-btn{display:inline-block;font-family:"Proza Libre",system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;font-weight:600;font-size:.95rem;line-height:1.1;padding:10px 14px;border:1px solid var(--border,#e6e6e6)!important;border-radius:0;background:var(--ui-bg,#F4F2EC)!important;color:#222!important;cursor:pointer;transition:background 120ms ease,box-shadow 120ms ease,border-color 120ms ease}'
      + 'button.wpd-launcher-btn:hover, .wpd-launcher-btn:hover{background:#E9E5D7!important}'
      + 'button.wpd-launcher-btn:active, .wpd-launcher-btn:active{background:#E1DCCB!important}'
      + 'button.wpd-launcher-btn:focus, .wpd-launcher-btn:focus{outline:none;box-shadow:0 0 0 3px rgba(var(--zoom-accent-rgb,140,106,0),.25);border-color:var(--zoom-accent,#8C6A00)!important}';
    var st=document.createElement('style'); st.id=BUTTON_STYLE_ID; st.appendChild(document.createTextNode(css)); document.head.appendChild(st);
  }

  function buildOverlay(opts){
    // opts: { id, title, backend, shop, productId, sku, image, price, wdCalc, bahnenbreite }
    var id = opts.id;
    var overlayId = 'wpd-overlay-' + id;
    var existing = document.getElementById(overlayId);
    if (existing) {
      // Always recreate overlay to guarantee a fresh state on every open
      try { existing.parentNode && existing.parentNode.removeChild(existing); } catch(_) {}
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
  // Pass product title (for PDF/UI display) and optional material label to the designer
  try {
    if (opts.title) q.set('title', String(opts.title));
  } catch(_) {}
  try {
    var mat0 = (opts.material || '').trim();
    if (mat0) q.set('material', mat0);
  } catch(_) {}
  // Optional quantity mode so Shopify can compute price by quantity scaling (e.g., area x100)
  try {
    if (opts.qtyMode) q.set('qtyMode', String(opts.qtyMode));
  } catch(_) {}
  if (opts.image != null && String(opts.image).trim() !== '') q.set('image', opts.image);
  if (opts.price != null && String(opts.price).trim() !== '') q.set('price', String(opts.price));
  // Include calculation mode and strip width if provided
  var wdCalc0 = (opts.wdCalc || '').trim().toLowerCase();
  var bahnen0 = String(opts.bahnenbreite || '').trim();
  if (!wdCalc0 && bahnen0) { wdCalc0 = 'bahnen'; }
  if (wdCalc0) q.set('wd-calc', wdCalc0);
  if (bahnen0) q.set('bahnenbreite', bahnen0);
  try { console.info('[WPD] open', { wdCalc: wdCalc0 || '(none)', bahnenbreite: bahnen0 || '(none)' }); } catch(_) {}
  // Append a unique session token to enforce a fresh app state on every open (in addition to _ts)
  try {
    var sess = (Math.random().toString(36).slice(2)) + '-' + Date.now();
    q.set('session', sess);
  } catch(_) {}
  var origin = (opts.backend || '').replace(/\/$/, '');
  frame.src = origin + '/designer/index.html?' + q.toString() + '&_ts=' + Date.now();
  body.appendChild(frame);

  var closeBtn = overlay.querySelector('.wpd-close');
  function close(){ __wpd_closeAll(); }
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
    var raw = fromDom || ds.imageVariant || '';
    // Normalize protocol-relative URLs
    try {
      if (raw && raw.slice && raw.slice(0,2) === '//') raw = window.location.protocol + raw;
    } catch(_){}
    try { console.info('[WPD] image', raw || '(none)'); } catch(_) {}
    return raw;
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
    // Optional: read a material label
    // Priority: data attributes on container; fallback to meta tag or DOM holders if present
    var material = (ds.material || ds.wpdMaterial || '').trim();
    if (!material) {
      try {
        var metaMat = document.querySelector('meta[name="wpd:material"]');
        if (metaMat) { material = String(metaMat.getAttribute('content') || '').trim(); }
      } catch(_) {}
    }
    if (!material) {
      try {
        var holder = document.querySelector('[data-product-material]');
        if (holder) {
          material = String(holder.getAttribute('data-product-material') || holder.textContent || holder.innerText || '').trim();
        }
      } catch(_) {}
    }
    if (!material) {
      try {
        // Optional JSON provider: <script type="application/json" data-wpd-product> { metafields: { custom: { material: "..." } } }
        var productJson = document.querySelector('script[type="application/json"][data-wpd-product]');
        if (productJson && productJson.textContent) {
          var obj = JSON.parse(productJson.textContent);
          var m = obj && obj.metafields && obj.metafields.custom && (obj.metafields.custom.material || obj.metafields.custom.Material || '');
          if (m) material = String(m).trim();
        }
      } catch(_) {}
    }
      if (!material) {
        try {
          var wm = (window.__WPD_MATERIAL__ && (window.__WPD_MATERIAL__.material || window.__WPD_MATERIAL__.label)) || '';
          if (wm) material = String(wm).trim();
        } catch(_) {}
      }
    // Optional: quantity mode for pricing (e.g., 'area_x100' to send quantity = area[m²]*100)
  var qtyMode = (ds.wpdQtyMode || ds.qtyMode || '').trim();
  if (!qtyMode) { qtyMode = 'area_x100'; }
  var price = resolvePrice();
    // Optional calculation parameters from data attributes (+ robust fallbacks)
  var wdCalc = (ds.wdCalc || ds.wdcalc || '').trim();
    // Fallback: read from closest ancestor with data-wd-calc or any global [data-wd-calc]
    if (!wdCalc) {
      try {
        var n1 = container.closest && container.closest('[data-wd-calc]');
        if (!n1) n1 = document.querySelector('[data-wd-calc]');
        if (n1) wdCalc = String(n1.getAttribute('data-wd-calc') || '').trim();
      } catch(_){ }
    }

    var bahnenbreite = '';
    try {
      var rawB = ds.bahnenbreite || ds.bahnenbreiteCm || ds.bahnenbreiteInCm || '';
      if (!rawB) {
        var bNode = container.closest && container.closest('[data-bahnenbreite],[data-bahnenbreite-in-cm]');
        if (!bNode) bNode = document.querySelector('[data-bahnenbreite],[data-bahnenbreite-in-cm]');
        if (bNode) rawB = bNode.getAttribute('data-bahnenbreite') || bNode.getAttribute('data-bahnenbreite-in-cm') || '';
      }
      var nStr = String(rawB).trim();
      var numMatch = nStr.match(/([0-9]+(?:[\.,][0-9]+)?)/);
      if (numMatch) {
        var cleaned = numMatch[1].replace(',', '.');
        var num = parseFloat(cleaned);
        if (Number.isFinite(num) && num > 0) bahnenbreite = String(num);
      }
      try { console.debug('[WPD] bahnenbreite parse', { raw: rawB, parsed: bahnenbreite }); } catch(_) {}
    } catch(_){ }
  var title = ds.title || document.title;
  try { console.info('[WPD] resolved', { wdCalc: wdCalc || '(none)', bahnenbreite: bahnenbreite || '(none)' }); } catch(_) {}

    // Optional: purge local/session storage if requested to guarantee clean app state
    try {
      var wantsReset = (ds.wpdReset === '1' || container.hasAttribute('data-wpd-reset'));
      if (wantsReset) {
        try {
          for (var i1=0; i1<(localStorage.length||0); i1++){
            var k = localStorage.key(i1);
            if (k && /^wpd[-_]/i.test(k)) { try { localStorage.removeItem(k); } catch(_) {} }
          }
        } catch(_) {}
        try {
          for (var j1=0; j1<(sessionStorage.length||0); j1++){
            var k2 = sessionStorage.key(j1);
            if (k2 && /^wpd[-_]/i.test(k2)) { try { sessionStorage.removeItem(k2); } catch(_) {} }
          }
        } catch(_) {}
        try { console.info('[WPD] state reset requested via data-wpd-reset'); } catch(_) {}
      }
    } catch(_) {}

    // Ensure no stale overlays remain (e.g., message-based close only hidden earlier)
    __wpd_closeAll();

    // Only inject styles if explicitly requested via data-wpd-style on trigger/container
    try {
      var styleRequested = false;
      if (container) {
        if (container.hasAttribute('data-wpd-style') && container.getAttribute('data-wpd-style') === '1') styleRequested = true;
        var triggerEl = container.querySelector('[data-wpd-open]');
        if (!styleRequested && triggerEl && triggerEl.hasAttribute('data-wpd-style')) styleRequested = true;
      }
      // Also treat existing class wpd-launcher-btn as opt-in only if data-wpd-style present somewhere
      if (!styleRequested && container) {
        var btnTest = container.querySelector('[data-wpd-open]');
        if (btnTest && btnTest.classList.contains('wpd-launcher-btn') && (btnTest.hasAttribute('data-wpd-style') || container.getAttribute('data-wpd-style') === '1')) {
          styleRequested = true;
        }
      }
  // Button styles only on opt-in; overlay styles always loaded lazily in openFor.
  if (styleRequested) { injectButtonStyles(); }
    } catch(_) {}
  // Ensure overlay core styles always present.
  injectOverlayStyles();
  var ov = buildOverlay({ id: id, title: title, backend: backend, shop: shop, productId: productId, sku: sku, image: image, price: price, wdCalc: wdCalc, bahnenbreite: bahnenbreite, material: material, qtyMode: qtyMode });
    ov.removeAttribute('hidden');
    document.body.classList.add('wpd-no-scroll');
    try { ov.querySelector('.wpd-close').focus(); } catch(e) {}
    // Release lock shortly after showing
    setTimeout(function(){ window.__WPD_OPEN_LOCK__ = false; }, 400);
  }

  // Less intrusive click handler: only act on primary, unmodified clicks
  function handleTriggerClick(e){
    try {
      if (!e) return;
      // Ignore already handled/prevented events
      if (e.defaultPrevented) return;
      // Only react to primary button without modifier keys
      var isPrimary = (e.button === 0 || e.button == null);
      var hasMods = !!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
      if (!isPrimary || hasMods) return;

      // De-dupe within the same event dispatch
      if (e.__wpdHandled) return; e.__wpdHandled = true;

      // Find an explicit trigger only
      var trigger = e.target && e.target.closest && e.target.closest('[data-wpd-open]');
      if (!trigger) return;

      var container = trigger.closest('[data-wpd]') || trigger;

      // Snapshot trigger visual state for restoration on close
      try {
        var snapAttrs = ['disabled','aria-expanded','aria-pressed','data-state','data-loading'];
        var attrs = {};
        for (var ai=0; ai<snapAttrs.length; ai++){
          var an = snapAttrs[ai];
          attrs[an] = trigger.hasAttribute(an) ? trigger.getAttribute(an) : null;
        }
        window.__WPD_LAST_TRIGGER_SNAPSHOT__ = {
          el: trigger,
          className: trigger.className,
          styleText: trigger.getAttribute('style'),
          attrs: attrs
        };
      } catch(_) {}

      // Determine if we should prevent default navigation
      // New default: clicking an explicit [data-wpd-open] trigger PREVENTS navigation
      // to avoid wrapper anchors (e.g. collection cards) hijacking the click and sending
      // users to the wrong product page. Opt-out by setting data-wpd-prevent="0".
      var hasPreventAttr = trigger.hasAttribute && trigger.hasAttribute('data-wpd-prevent');
      var preventAttrVal = hasPreventAttr ? String(trigger.getAttribute('data-wpd-prevent')).trim() : '';
      var shouldPrevent = hasPreventAttr ? (preventAttrVal !== '0') : true;

  if (shouldPrevent && e.preventDefault) e.preventDefault();
      // Do NOT call stopImmediatePropagation to avoid breaking theme handlers.
      // Optionally stop propagation only if explicitly requested.
      if (trigger.getAttribute && trigger.getAttribute('data-wpd-stop') === '1') {
        if (e.stopPropagation) e.stopPropagation();
      }

      openFor(container);
      // Returning false is unnecessary; we rely on preventDefault when needed.
    } catch(_) {}
  }

  // Global delegated click handler (bubble). Less intrusive than capture.
  document.addEventListener('click', handleTriggerClick, false);

  // Listen to messages from the embedded designer to add items to cart or close overlay
  function currentVariantId(){
    try {
      var input = document.querySelector('form[action*="/cart/add"] input[name="id"]');
      if (input && input.value) return String(input.value);
      // Fallback: common select variant pattern
      var sel = document.querySelector('form[action*="/cart/add"] select[name="id"]');
      if (sel && sel.value) return String(sel.value);
      // Fallback: any element marking the selected variant
      var chosen = document.querySelector('[data-variant-id].is-selected, [data-variant-id].active');
      if (chosen && chosen.getAttribute) {
        var vid = chosen.getAttribute('data-variant-id');
        if (vid) return String(vid);
      }
    } catch(_) {}
    return '';
  }
  function absolutizeUrl(u){
    try {
      if (!u) return '';
      var s = String(u).trim();
      if (/^https?:\/\//i.test(s)) return s;
      // Accept protocol-relative
      if (/^\/\//.test(s)) return window.location.protocol + s;
      // Treat as site-relative
      if (s[0] === '/') return window.location.origin + s;
      // Otherwise assume already absolute-like path, resolve against origin
      return new URL(s, window.location.origin).toString();
    } catch(_) { return String(u || ''); }
  }
  function normalizeProperties(props){
    var out = {};
    try {
      if (!props || typeof props !== 'object') return out;
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props,k)) continue;
        var v = props[k];
        var t = Object.prototype.toString.call(v);
        var str;
        if (v == null) { str = ''; }
        else if (t === '[object String]') { str = String(v); }
        else if (t === '[object Number]' || t === '[object Boolean]') { str = String(v); }
        else { try { str = JSON.stringify(v); } catch(_) { str = String(v); } }
        // Special-case: ensure Konfiguration link is absolute
        if (/^konfiguration$/i.test(k)) { str = absolutizeUrl(str); }
        out[k] = str;
      }
    } catch(_) {}
    return out;
  }
  async function addToCartFromMessage(msg){
    try {
      var props = normalizeProperties(msg && msg.properties || {});
      var qty = Number(msg && msg.quantity) || 1;
      var id = (msg && msg.id) ? String(msg.id) : currentVariantId();
      if (!id) return;
      var payload = { items: [{ id: id, quantity: qty, properties: props }] };
      var res = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(payload),
        credentials: 'same-origin'
      });
      if (!res.ok) {
        try { console.warn('[WPD] cart add failed', res.status); } catch(_) {}
      } else {
        // Optionally open cart drawer if theme exposes it
        try { document.dispatchEvent(new CustomEvent('wpd:cart:added', { detail: payload })); } catch(_) {}
        // Force-refresh cart state to avoid stale drawer/cache
        try { await fetch('/cart.js?_ts=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' }); } catch(_) {}
        // Fire common theme events used by many themes
        try { document.dispatchEvent(new CustomEvent('cart:refresh', { detail: payload })); } catch(_) {}
        try { document.dispatchEvent(new CustomEvent('cart:updated', { detail: payload })); } catch(_) {}
        try { document.dispatchEvent(new CustomEvent('ajaxProduct:added', { detail: payload })); } catch(_) {}
        // Try opening cart drawer if available
        try { if (window.CartDrawer && typeof window.CartDrawer.open === 'function') window.CartDrawer.open(); } catch(_) {}
        try {
          var toggle = document.querySelector('[data-cart-toggle], [data-drawer-open="cart"], .js-open-cart, button[name="cart"], a[href="/cart"]');
          if (toggle && toggle.click) toggle.click();
        } catch(_) {}
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
        __wpd_closeAll();
      }
    } catch(_) {}
  }, false);

  // Auto-upgrade any plain buttons to launcher style
  function upgradeButtons(){
    // Keep theme styling intact; only remove inline onclick to avoid duplicate launches.
    var btns = document.querySelectorAll('[data-wpd] [data-wpd-open]');
    for (var i=0; i<btns.length; i++) {
      var b = btns[i];
      if (!b) continue;
      try { b.removeAttribute('onclick'); } catch(_) {}
      // Opt-in styling: add our class only if explicitly requested
      try {
        var wantsStyle = b.hasAttribute('data-wpd-style') || (b.closest('[data-wpd]') && b.closest('[data-wpd]').getAttribute('data-wpd-style') === '1');
        if (wantsStyle) {
          if (!b.classList.contains('wpd-launcher-btn')) {
            b.classList.add('wpd-launcher-btn');
            try { console.info('[WPD] style applied to trigger', b); } catch(_) {}
          }
        } else {
          // Remove class if present but not requested to avoid unintended dark styling
          if (b.classList.contains('wpd-launcher-btn')) {
            b.classList.remove('wpd-launcher-btn');
            try { console.info('[WPD] style removed (not requested)'); } catch(_) {}
          }
        }
      } catch(_) {}
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
