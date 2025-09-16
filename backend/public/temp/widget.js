(function(){
  // Simple storefront widget: allows customers to upload an image and preview within given dimensions
  // Assumes the page includes a container with data attributes: data-width-cm, data-height-cm, data-material-sku
  const BACKEND = (window.WALLPAPER_BACKEND || 'https://app.wirzapp.ch');

  function formatCHF(v){ try{ return new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v||0)); }catch(e){ return String(v); } }

  function initContainer(el){
    const widthCm = Number(el.getAttribute('data-width-cm') || '400');
    const heightCm = Number(el.getAttribute('data-height-cm') || '240');
    const sku = String(el.getAttribute('data-material-sku') || '').trim();
    const productHandle = el.getAttribute('data-product-handle');
    // Try to detect the shop domain
    const shopDomain = (window.Shopify && window.Shopify.shop) || el.getAttribute('data-shop-domain') || '';
    const cm2px = 37.8;
    let fw = widthCm * cm2px, fh = heightCm * cm2px, sc = 1;
    if (fw > 1000 || fh > 500) { sc = Math.min(1000 / fw, 500 / fh); fw = Math.round(fw * sc); fh = Math.round(fh * sc); }
    const border = 40; const W = fw + border*2; const H = fh + border*2;

    el.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:#F9F8F4; padding:16px; border:1px solid #eee;';

    const preview = document.createElement('div');
    preview.style.cssText = `position:relative;width:${W}px;height:${H}px;margin:0 auto;background:#fff;overflow:hidden;`;

    const frame = document.createElement('div');
    frame.style.cssText = `position:absolute;left:${border}px;top:${border}px;width:${fw}px;height:${fh}px;border:1px solid #000;box-sizing:border-box;pointer-events:none;`;

    const img = document.createElement('img');
    img.style.cssText = `position:absolute;left:${border}px;top:${border}px;display:none;user-select:none;cursor:grab;max-width:none;max-height:none;`;

  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;gap:12px;align-items:center;justify-content:center;margin-top:12px;flex-wrap:wrap;';

  // Size inputs
  const wLabel = document.createElement('label'); wLabel.textContent = 'Breite (cm)';
  const wInput = document.createElement('input'); wInput.type = 'number'; wInput.min = '40'; wInput.max = '1000'; wInput.value = String(widthCm);
  const hLabel = document.createElement('label'); hLabel.textContent = 'Höhe (cm)';
  const hInput = document.createElement('input'); hInput.type = 'number'; hInput.min = '40'; hInput.max = '1000'; hInput.value = String(heightCm);

    const uploadBtn = document.createElement('button');
    uploadBtn.textContent = 'Bild auswählen';

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/tiff,image/svg+xml,application/pdf,application/postscript,application/eps,application/x-eps';
    input.style.display = 'none';

    const zoomLabel = document.createElement('span');
    zoomLabel.textContent = 'Zoom:';
    const zoom = document.createElement('input');
    zoom.type = 'range'; zoom.min = '0.5'; zoom.max = '2'; zoom.step = '0.01'; zoom.value = '1';
    const zoomVal = document.createElement('span');
    zoomVal.textContent = '100%';

    const priceArea = document.createElement('div');
    priceArea.style.cssText = 'margin-top:8px;text-align:center;color:#444;';

  const submitBtn = document.createElement('button');
    submitBtn.textContent = 'In den Warenkorb';
    submitBtn.disabled = true;

  controls.append(wLabel, wInput, hLabel, hInput, uploadBtn, input, zoomLabel, zoom, zoomVal, submitBtn);
    preview.append(img, frame);
    wrapper.appendChild(preview);
    wrapper.appendChild(controls);
    wrapper.appendChild(priceArea);
    el.appendChild(wrapper);

    let imgPos = { x: 0, y: 0 };
    let dragging = false; let start = { x: 0, y: 0 };
  function updateImage(){
      const z = Number(zoom.value);
      img.style.width = (img.naturalWidth * z) + 'px';
      img.style.height = (img.naturalHeight * z) + 'px';
      img.style.left = (border + imgPos.x) + 'px';
      img.style.top = (border + imgPos.y) + 'px';
      zoomVal.textContent = Math.round(z*100) + '%';
    }

    function centerImage(){
      const z = Number(zoom.value);
      const w = img.naturalWidth * z, h = img.naturalHeight * z;
      imgPos.x = Math.round(fw/2 - w/2);
      imgPos.y = Math.round(fh/2 - h/2);
      updateImage();
    }

    function boundDrag(nx, ny){
      const z = Number(zoom.value);
      const w = img.naturalWidth * z, h = img.naturalHeight * z;
      const minX = fw - w, minY = fh - h;
      nx = Math.min(0, Math.max(nx, minX));
      ny = Math.min(0, Math.max(ny, minY));
      return { x: nx, y: ny };
    }

    img.addEventListener('mousedown', (e)=>{ dragging = true; start = { x: e.clientX - imgPos.x, y: e.clientY - imgPos.y }; });
    window.addEventListener('mouseup', ()=> dragging = false);
    window.addEventListener('mousemove', (e)=>{ if(!dragging) return; const nx = e.clientX - start.x; const ny = e.clientY - start.y; imgPos = boundDrag(nx, ny); updateImage(); });

    zoom.addEventListener('input', ()=>{ updateImage(); });
    wInput.addEventListener('change', ()=>{ /* note: visual frame fixed for now; price only */ updatePrice(); });
    hInput.addEventListener('change', ()=>{ updatePrice(); });

    async function updatePrice(){
      if (!sku) return; priceArea.textContent = '';
      try {
        const qs = shopDomain ? ('?shop=' + encodeURIComponent(shopDomain)) : '';
        const r = await fetch(BACKEND + '/price/' + encodeURIComponent(sku) + qs);
        const p = await r.json();
        if (r.ok && p && p.price != null) {
          const wc = Number(wInput.value||widthCm); const hc = Number(hInput.value||heightCm);
          const sqm = Math.round((wc*hc)/10000 * 100) / 100;
          priceArea.textContent = 'Preis: CHF ' + formatCHF(p.price * sqm) + ' (ca.)';
        } else { priceArea.textContent = ''; }
      } catch {}
    }

    uploadBtn.addEventListener('click', ()=> input.click());
    let lastUpload = null; // { url, previewUrl, filename }
    input.addEventListener('change', async (e)=>{
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      // Upload to backend
      const fd = new FormData(); fd.append('wallpaper', f);
      uploadBtn.disabled = true; submitBtn.disabled = true; priceArea.textContent = 'Bitte warten…';
      try {
        const resp = await fetch(BACKEND + '/upload', { method: 'POST', body: fd });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data?.error || data?.message || 'Upload fehlgeschlagen');
        const url = BACKEND + '/uploads/' + data.filename;
        const previewUrl = data.preview ? (BACKEND + '/' + data.preview) : url;
        lastUpload = { url, previewUrl, filename: data.filename };
        img.src = previewUrl; img.style.display = 'block';
        await new Promise((r)=>{ if(img.complete) return r(); img.onload = r; });
        centerImage();
        priceArea.textContent = '';
        uploadBtn.disabled = false;
        // fetch price for SKU (optional)
  if (sku) { updatePrice(); }
        submitBtn.disabled = false;
      } catch (err) {
        priceArea.textContent = 'Fehler beim Upload.';
        uploadBtn.disabled = false; submitBtn.disabled = true;
      }
    });

    submitBtn.addEventListener('click', async ()=>{
      // Optional: redirect to product with selected variant by SKU
      if (sku) {
        try {
          const qs = 'sku=' + encodeURIComponent(sku) + (shopDomain ? ('&shop=' + encodeURIComponent(shopDomain)) : '');
          const r = await fetch(BACKEND + '/variant/by-sku?' + qs);
          const j = await r.json();
          if (r.ok && j && j.variantId) {
            // Try to add to cart directly with line item properties
            const props = {};
            if (lastUpload && lastUpload.previewUrl) props['Wallpaper Preview'] = lastUpload.previewUrl;
            const wc = Number(wInput.value||widthCm); const hc = Number(hInput.value||heightCm);
            props['Wall size (cm)'] = wc + ' x ' + hc;
            // Include crop/zoom metadata
            props['Zoom'] = Math.round(Number(zoom.value)*100) + '%';
            props['Offset X (px)'] = imgPos.x; props['Offset Y (px)'] = imgPos.y;
            props['Frame (px)'] = fw + ' x ' + fh;
            if (lastUpload && lastUpload.url) props['Wallpaper Source'] = lastUpload.url;
            try {
              const addResp = await fetch('/cart/add.js', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ id: j.variantId, quantity: 1, properties: props })
              });
              if (addResp.ok) {
                window.location.href = '/cart';
                return;
              }
            } catch {}
            // Fallback: Redirect to product page with variant preselected if handle provided
            if (productHandle) {
              const url = `/products/${productHandle}?variant=${j.variantId}`;
              window.location.href = url;
              return;
            }
          }
        } catch {}
      }
      // Fallback: go to cart (requires line item form on theme) — keep simple here
      alert('Bild wurde vorbereitet. Bitte wählen Sie die Variante im Produkt und fügen Sie in den Warenkorb.');
    });
  }

  function boot(){
    document.querySelectorAll('[data-wallpaper-designer]')?.forEach(initContainer);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
