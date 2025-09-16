import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

// Backend and URL params
// Prefer explicit override (?backend= or window.WALLPAPER_BACKEND). Fallback to same-origin, not hardcoded :3001.
const BACKEND_URL = (() => {
  if (typeof window !== 'undefined') {
    const override = window.WALLPAPER_BACKEND || new URLSearchParams(window.location.search).get('backend');
    if (override) return String(override);
    return window.location.origin;
  }
  return 'http://localhost:3001';
})();
// (Debug fetch interceptor entfernt im Cleanup)
const URL_PARAMS = (typeof window !== 'undefined') ? new URLSearchParams(window.location.search) : new URLSearchParams('');
const INITIAL_IMAGE_URL = URL_PARAMS.get('image') || null;
// Calculation mode and strip width
const WD_CALC = ((URL_PARAMS.get('wd-calc') || '').trim().toLowerCase()) || null; // 'bahnen' | 'm2' | null
// Default to 'm2' if metafield wd-calc is missing
const EFFECTIVE_WD_CALC = WD_CALC || 'm2';
const BAHNENBREITE_CM = (() => {
  const raw = URL_PARAMS.get('bahnenbreite');
  if (!raw) return null;
  const cleaned = String(raw).replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
})();
const INITIAL_PRICE_PARAM = (() => {
  const p = URL_PARAMS.get('price');
  if (p == null || p === '') return null;
  const cleaned = String(p).replace(/[\s'’_]/g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
})();
const formatCHF = (value) => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));

// Pure frame/preview component
function FrameDesigner({ imageUrl, frameWidthCm, frameHeightCm, zoom = 1, flipH = false, flipV = false, onDropFile, onPickFile, working = false, uploadDisabled = false, overlayWallWidthCm = null, overlayWallHeightCm = null, codeInput, onChangeCodeInput, onLoadByCode, onTransformChange, onRequestZoom }) {
  const [imgPos, setImgPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [startDrag, setStartDrag] = useState({ x: 0, y: 0 });
  const [imgSize, setImgSize] = useState({ width: 0, height: 0, scale: 1, naturalWidth: 0, naturalHeight: 0 });
  const [imgError, setImgError] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const imgRef = useRef(null);

  const CM_TO_PX = 37.8;
  let frameWidthPx = frameWidthCm * CM_TO_PX;
  let frameHeightPx = frameHeightCm * CM_TO_PX;
  let scale = 1;
  if (frameWidthPx > 800 || frameHeightPx > 400) {
    scale = Math.min(800 / frameWidthPx, 400 / frameHeightPx);
    frameWidthPx = Math.round(frameWidthPx * scale);
    frameHeightPx = Math.round(frameHeightPx * scale);
  }
  const borderPx = 100;
  const containerWidth = frameWidthPx + borderPx * 2;
  const containerHeight = frameHeightPx + borderPx * 2;
  const wallOverlayWidthPx = overlayWallWidthCm ? Math.max(0, (overlayWallWidthCm * CM_TO_PX) * scale) : 0;
  const wallOverlayHeightPx = overlayWallHeightCm ? Math.max(0, (overlayWallHeightCm * CM_TO_PX) * scale) : 0;

  // Recenter when zoom changes
  useEffect(() => {
    if (!imgSize || !imgSize.width || !imgSize.height) return;
    const newX = Math.round(frameWidthPx / 2 - (imgSize.width * zoom) / 2);
    const newY = Math.round(frameHeightPx / 2 - (imgSize.height * zoom) / 2);
    setImgPos({ x: newX, y: newY });
  }, [zoom, imgSize.width, imgSize.height, frameWidthPx, frameHeightPx]);

  // On image load: compute base cover scale
  useEffect(() => {
    setImgError(false);
    if (!imageUrl) return;
    const handleLoad = (e) => {
      const naturalWidth = e.target.naturalWidth;
      const naturalHeight = e.target.naturalHeight;
      if (!naturalWidth || !naturalHeight) return;
      const scaleW = frameWidthPx / naturalWidth;
      const scaleH = frameHeightPx / naturalHeight;
      let s = Math.max(scaleW, scaleH);
      if (s > 1) s = 1;
      const scaledWidth = Math.round(naturalWidth * s);
      const scaledHeight = Math.round(naturalHeight * s);
      setImgSize({ width: scaledWidth, height: scaledHeight, scale: s, naturalWidth, naturalHeight });
      const pos = { x: Math.round((frameWidthPx - scaledWidth) / 2), y: Math.round((frameHeightPx - scaledHeight) / 2) };
      setImgPos(pos);
      onTransformChange && onTransformChange({ zoom, offsetXPct: 0.5, offsetYPct: 0.5, naturalWidth, naturalHeight });
      // Ensure initial coverage by requesting zoom if needed (so the slider moves too)
      if (onRequestZoom) {
        const needZoomW = scaledWidth ? (frameWidthPx / scaledWidth) : 1;
        const needZoomH = scaledHeight ? (frameHeightPx / scaledHeight) : 1;
        const zoomNeeded = Math.max(needZoomW, needZoomH, 1);
        if (zoomNeeded > zoom) onRequestZoom(Math.min(3, Number(zoomNeeded.toFixed(4))));
      }
    };
    if (imgRef.current) {
      imgRef.current.onload = handleLoad;
      imgRef.current.onerror = () => setImgError(true);
    }
  }, [imageUrl, frameWidthPx, frameHeightPx]);

  // When frame size changes (wall/print dims), recompute base cover scale and enforce coverage
  useEffect(() => {
    if (!imgSize.naturalWidth || !imgSize.naturalHeight) return;
    const scaleW = frameWidthPx / imgSize.naturalWidth;
    const scaleH = frameHeightPx / imgSize.naturalHeight;
    let s = Math.max(scaleW, scaleH);
    if (s > 1) s = 1;
    const scaledWidth = Math.round(imgSize.naturalWidth * s);
    const scaledHeight = Math.round(imgSize.naturalHeight * s);
    if (scaledWidth !== imgSize.width || scaledHeight !== imgSize.height || s !== imgSize.scale) {
      setImgSize({ ...imgSize, width: scaledWidth, height: scaledHeight, scale: s });
      // recentre with current zoom
      const newX = Math.round(frameWidthPx / 2 - (scaledWidth * zoom) / 2);
      const newY = Math.round(frameHeightPx / 2 - (scaledHeight * zoom) / 2);
      setImgPos({ x: newX, y: newY });
    }
    // Ensure no white stripes: if current zoom is too small, request a larger zoom
    const needZoomW = scaledWidth ? (frameWidthPx / scaledWidth) : 1;
    const needZoomH = scaledHeight ? (frameHeightPx / scaledHeight) : 1;
    const zoomNeeded = Math.max(needZoomW, needZoomH, 1);
    if (onRequestZoom && zoomNeeded > zoom) {
      onRequestZoom(Math.min(3, Number(zoomNeeded.toFixed(4))));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameWidthPx, frameHeightPx, imgSize.naturalWidth, imgSize.naturalHeight, zoom]);

  const emitTransform = () => {
    if (!onTransformChange || !imgSize.width || !imgSize.height) return;
    // Frame center relative to image top-left (zoomed)
    const centerX = (frameWidthPx / 2) - imgPos.x;
    const centerY = (frameHeightPx / 2) - imgPos.y;
    const denomW = imgSize.width * zoom;
    const denomH = imgSize.height * zoom;
    const offsetXPct = Math.max(0, Math.min(1, denomW ? centerX / denomW : 0.5));
    const offsetYPct = Math.max(0, Math.min(1, denomH ? centerY / denomH : 0.5));
    onTransformChange({
      zoom,
      offsetXPct,
      offsetYPct,
      naturalWidth: imgSize.naturalWidth,
      naturalHeight: imgSize.naturalHeight
    });
  };

  const onMouseDown = (e) => {
    setDragging(true);
    setStartDrag({ x: e.clientX - imgPos.x, y: e.clientY - imgPos.y });
  };
  const onMouseUp = () => setDragging(false);
  const onMouseMove = (e) => {
    if (!dragging) return;
    let newX = e.clientX - startDrag.x;
    let newY = e.clientY - startDrag.y;
    if (imgRef.current) {
      const minX = frameWidthPx - imgSize.width * zoom;
      const minY = frameHeightPx - imgSize.height * zoom;
      newX = Math.min(0, Math.max(newX, minX));
      newY = Math.min(0, Math.max(newY, minY));
    }
    const pos = { x: newX, y: newY };
    setImgPos(pos);
  };
  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  });

  // Emit transform when frame size, image pos, zoom, or image size changes
  useEffect(() => {
    if (!onTransformChange) return;
    if (!imgSize.width || !imgSize.height) return;
    const centerX = (frameWidthPx / 2) - imgPos.x;
    const centerY = (frameHeightPx / 2) - imgPos.y;
    const denomW = imgSize.width * zoom;
    const denomH = imgSize.height * zoom;
    const offsetXPct = Math.max(0, Math.min(1, denomW ? centerX / denomW : 0.5));
    const offsetYPct = Math.max(0, Math.min(1, denomH ? centerY / denomH : 0.5));
    onTransformChange({
      zoom,
      offsetXPct,
      offsetYPct,
      naturalWidth: imgSize.naturalWidth,
      naturalHeight: imgSize.naturalHeight
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameWidthPx, frameHeightPx, imgPos.x, imgPos.y, zoom, imgSize.width, imgSize.height, imgSize.naturalWidth, imgSize.naturalHeight]);

  return (
    <div style={{ marginTop: 0 }}>
      {imgError && (<div style={{ color: '#c00', marginTop: 8 }}>Fehler: Bild konnte nicht geladen werden.</div>)}
      <div style={{ position: 'relative', width: containerWidth, height: containerHeight, margin: '0 auto', minHeight: 300 }}>
        {/* Outer masks always visible */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: containerWidth, height: borderPx, background: 'rgba(255,255,255,0.8)', zIndex: 110, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: 0, top: borderPx + frameHeightPx, width: containerWidth, height: borderPx, background: 'rgba(255,255,255,0.8)', zIndex: 110, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: 0, top: borderPx, width: borderPx, height: frameHeightPx, background: 'rgba(255,255,255,0.8)', zIndex: 110, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: borderPx + frameWidthPx, top: borderPx, width: borderPx, height: frameHeightPx, background: 'rgba(255,255,255,0.8)', zIndex: 110, pointerEvents: 'none' }} />
        {/* Image area */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: containerWidth, height: containerHeight, overflow: 'hidden', zIndex: 101 }}>
          {imageUrl && !imgError && (
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Wallpaper"
              style={{ position: 'absolute', left: borderPx + imgPos.x, top: borderPx + imgPos.y, cursor: 'grab', userSelect: 'none', width: imgSize.width * zoom, height: imgSize.height * zoom, maxWidth: 'none', maxHeight: 'none', display: 'block', transition: 'width 0.2s, height 0.2s', transform: `scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})` }}
              onMouseDown={onMouseDown}
              draggable={false}
            />
          )}
        </div>
        {/* Frame border (Druckmass) */}
        <div style={{ position: 'absolute', left: borderPx, top: borderPx, width: frameWidthPx, height: frameHeightPx, border: '1px solid black', boxSizing: 'border-box', zIndex: 103, pointerEvents: 'none', background: imageUrl ? 'transparent' : '#fff' }} />
        {/* Centered wall overlay (rot) */}
        {overlayWallWidthCm != null && overlayWallHeightCm != null && (
          <div style={{ position: 'absolute', left: Math.round(borderPx + (frameWidthPx - wallOverlayWidthPx) / 2), top: Math.round(borderPx + (frameHeightPx - wallOverlayHeightPx) / 2), width: Math.round(wallOverlayWidthPx), height: Math.round(wallOverlayHeightPx), border: '2px solid #c00', boxSizing: 'border-box', background: 'transparent', zIndex: 106, pointerEvents: 'none' }} />
        )}
        {/* Corner accents */}
        <div style={{position:'absolute',left:borderPx,top:borderPx,width:40,height:2,background:'linear-gradient(to right, black 0%, transparent 100%)',zIndex:104,pointerEvents:'none',transform:'rotate(-145deg)',transformOrigin:'left'}} />
        <div style={{position:'absolute',left:borderPx+frameWidthPx,top:borderPx,width:40,height:2,background:'linear-gradient(to right, black 0%, transparent 100%)',zIndex:104,pointerEvents:'none',transform:'rotate(-35deg)',transformOrigin:'left'}} />
        <div style={{position:'absolute',left:borderPx,top:borderPx+frameHeightPx,width:40,height:2,background:'linear-gradient(to right, black 0%, transparent 100%)',zIndex:104,pointerEvents:'none',transform:'rotate(145deg)',transformOrigin:'left'}} />
        <div style={{position:'absolute',left:borderPx+frameWidthPx,top:borderPx+frameHeightPx,width:40,height:2,background:'linear-gradient(to right, black 0%, transparent 100%)',zIndex:104,pointerEvents:'none',transform:'rotate(35deg)',transformOrigin:'left'}} />
        {/* Labels */}
        {overlayWallWidthCm != null && (
          <div style={{ position: 'absolute', left: borderPx, top: borderPx + frameHeightPx + borderPx/2 - 30, width: frameWidthPx, textAlign: 'center', color: '#c00', fontSize: '0.85em', zIndex: 121, pointerEvents: 'none' }}>{`Wandmass: ${Math.round(overlayWallWidthCm)} cm`}</div>
        )}
        <div style={{ position: 'absolute', left: borderPx, top: borderPx + frameHeightPx + borderPx/2 - 16, width: frameWidthPx, textAlign: 'center', color: '#222', fontSize: '1em', fontWeight: 'bold', letterSpacing: '1px', zIndex: 120, pointerEvents: 'none' }}>{`Druckmass Breite: ${Math.round(frameWidthCm)} cm`}</div>
        <div style={{ position: 'absolute', left: borderPx - 40, top: borderPx + frameHeightPx/2, textAlign: 'center', color: '#222', fontSize: '1em', fontWeight: 600, letterSpacing: '1px', zIndex: 120, pointerEvents: 'none', transform: 'translate(-50%, -50%) rotate(-90deg)', transformOrigin: 'center', whiteSpace: 'nowrap' }}>{`Druckmass Höhe: ${Math.round(frameHeightCm)} cm`}</div>
        {overlayWallHeightCm != null && (
          <div style={{ position: 'absolute', left: borderPx - 20, top: borderPx + frameHeightPx/2, textAlign: 'center', color: '#c00', fontSize: '0.85em', zIndex: 121, pointerEvents: 'none', transform: 'translate(-50%, -50%) rotate(-90deg)', transformOrigin: 'center', whiteSpace: 'nowrap' }}>{`Wandmass: ${Math.round(overlayWallHeightCm)} cm`}</div>
        )}
        {/* Dropzone */}
        {(!imageUrl || imgError) && !uploadDisabled && (
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
            onDrop={(e) => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer?.files?.[0]; if (f && onDropFile) onDropFile(f); }}
            onClick={() => { if (onPickFile) onPickFile(); }}
            style={{ position: 'absolute', left: borderPx, top: borderPx, width: frameWidthPx, height: frameHeightPx, zIndex: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxSizing: 'border-box', background: '#fff', border: isDragOver ? '2px dashed var(--zoom-accent)' : '2px dashed #ccc' }}
            title="Bild hierher ziehen oder klicken, um auszuwählen"
          >
            <div style={{ textAlign: 'center', color: '#666', maxWidth: Math.max(280, Math.min(520, frameWidthPx - 40)) }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>{imgError ? 'Bild konnte nicht geladen werden' : 'Kein Bild ausgewählt'}</div>
              <div style={{ marginBottom: 12 }}>Bild hierher ziehen oder klicken, um eine Datei auszuwählen (JPG, TIFF, EPS, SVG oder PDF)</div>
              <button type="button" style={{ background: 'var(--ui-bg)' }} onClick={(e) => { e.stopPropagation(); if (onPickFile) onPickFile(); }}>Datei auswählen</button>
              {/* Code laden Hinweis + Eingabe (Ereignisse stoppen) */}
              <div
                style={{ marginTop: 14, color: '#333' }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
              >
                Wenn du bereits eine Konfiguration erstellt hast, kannst du hier den Code der Konfiguration eingeben um diese erneut aufzurufen.
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: 8 }}>
                  <input
                    type="text"
                    placeholder="Code einfügen"
                    value={codeInput || ''}
                    onChange={e => onChangeCodeInput && onChangeCodeInput(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.stopPropagation();
                        const v = String(codeInput || '').trim();
                        if (v && onLoadByCode) onLoadByCode(v);
                      }
                    }}
                    style={{ width: 260 }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function App() {
  // Core state
  const [frameWidthCm, setFrameWidthCm] = useState(400);
  const [frameHeightCm, setFrameHeightCm] = useState(240);
  const [imageUrl, setImageUrl] = useState(INITIAL_IMAGE_URL);
  const [originalUploadUrl, setOriginalUploadUrl] = useState(null);
  const [isVectorOrPdf, setIsVectorOrPdf] = useState(false);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [uploadLocked, setUploadLocked] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [pricePerM2, setPricePerM2] = useState(null);
  const [calcError, setCalcError] = useState('');
  const [configState, setConfigState] = useState({ id: null, code: null, detailUrl: null, signedUrl: null, confirmed: false, pdfUrl: null });
  const [approved, setApproved] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCreateTip, setShowCreateTip] = useState(false);
  const [transformState, setTransformState] = useState(null);
  const [qualityMsg, setQualityMsg] = useState(null);
  const [qualityColor, setQualityColor] = useState('#666');
  const [origDims, setOrigDims] = useState(null);
  const [qualityLevel, setQualityLevel] = useState(null); // 'red' | 'orange' | 'green' | 'none'

  // Zoom slider UI
  const minZoom = 0.5;
  const maxZoom = 3; // limit per request
  const sliderRef = useRef(null);
  const [showZoomTip, setShowZoomTip] = useState(false);
  const setZoomClamped = (z) => setZoom(prev => {
    const target = Math.min(maxZoom, Math.max(minZoom, Number(z) || 1));
    if (Math.abs(target - prev) < 0.0005) return prev; // avoid tiny state churn
    return target;
  });
  useEffect(() => {
    const readWidth = () => {};
    window.addEventListener('resize', readWidth);
    return () => window.removeEventListener('resize', readWidth);
  }, []);

  // Responsive layout calc based on Druckmass
  const [winWidth, setWinWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1200));
  useEffect(() => {
    const onResize = () => setWinWidth(typeof window !== 'undefined' ? window.innerWidth : 1200);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Area computation
  const computeArea = () => {
    const widthCm = Number(frameWidthCm) || 0;
    const heightCm = Number(frameHeightCm) || 0;
    if (EFFECTIVE_WD_CALC === 'bahnen' && BAHNENBREITE_CM && BAHNENBREITE_CM > 0) {
      let strips = Math.ceil(widthCm / BAHNENBREITE_CM);
      let printWidthCm = strips * BAHNENBREITE_CM;
      const minNeededWidth = widthCm + 10;
      let addedExtraStrip = false;
      if (printWidthCm < minNeededWidth) {
        strips += 1;
        printWidthCm = strips * BAHNENBREITE_CM;
        addedExtraStrip = true;
      }
      const printHeightCm = heightCm + 10;
      const areaM2 = (printWidthCm / 100) * (printHeightCm / 100);
      return { mode: 'bahnen', areaM2, strips, printWidthCm, printHeightCm, addedExtraStrip };
    }
    if (EFFECTIVE_WD_CALC === 'm2') {
      const printWidthCm = widthCm + 10;
      const printHeightCm = heightCm + 10;
      const areaM2 = (printWidthCm / 100) * (printHeightCm / 100);
      return { mode: 'm2', areaM2, printWidthCm, printHeightCm };
    }
    const areaM2 = (widthCm * heightCm) / 10000;
    return { mode: 'default', areaM2, printWidthCm: widthCm, printHeightCm: heightCm };
  };
  const area = computeArea();
  const qm = Number(area.areaM2.toFixed(3));
  const [showWidthInfo, setShowWidthInfo] = React.useState(false);

  // Alignment helper for hint/controls
  const CM_TO_PX = 37.8;
  let fw = (area.printWidthCm || frameWidthCm) * CM_TO_PX;
  let fh = (area.printHeightCm || frameHeightCm) * CM_TO_PX;
  let sc = 1;
  if (fw > 800 || fh > 400) { sc = Math.min(800 / fw, 400 / fh); fw = Math.round(fw * sc); fh = Math.round(fh * sc); }
  const borderPx = 100;
  const containerWidthAligned = Math.round(fw + borderPx * 2);
  const alignShift = 0;
  const sidebarWidth = 360;
  const isNarrow = (containerWidthAligned + sidebarWidth) > winWidth;

  // Price init
  useEffect(() => {
    if (INITIAL_PRICE_PARAM == null) {
      setCalcError('Kein Preis für diese Variante vorhanden.');
    } else {
      setCalcError('');
      setPricePerM2(INITIAL_PRICE_PARAM);
    }
  }, []);

  // Upload helpers
  const fileInputRef = useRef(null);
  const handleFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) uploadFile(file);
    if (e.target) e.target.value = '';
  };
  const uploadFile = async (file) => {
    if (!file) return;
    setMessage('Bild wird hochgeladen und aufbereitet...');
    setWorking(true);
    const formData = new FormData();
    formData.append('wallpaper', file);
    // PATCH: configId mitsenden, damit Backend die Konfiguration zuordnen kann
    if (configState && configState.id) {
      formData.append('id', configState.id);
    }
    try {
      const response = await fetch(`${BACKEND_URL}/upload`, { method: 'POST', body: formData });
      const ct = String(response.headers.get('content-type') || '').toLowerCase();
      const data = ct.includes('application/json') ? await response.json() : { error: (await response.text()).slice(0, 300) };
      if (!response.ok) throw new Error(data?.error || data?.message || 'Upload fehlgeschlagen');
      setMessage(data.message || 'Upload erfolgreich!');
      const url = `${BACKEND_URL}/uploads/${data.filename}`;
      const previewUrl = data.preview ? `${BACKEND_URL}/${data.preview}` : url;
      setImageUrl(previewUrl);
      setOriginalUploadUrl(data.originalUrl ? `${BACKEND_URL}/${data.originalUrl}` : url);
      setIsVectorOrPdf(!!data.isVectorOrPdf);
      if (data && (data.originalWidthPx || data.originalHeightPx)) {
        setOrigDims({ w: data.originalWidthPx || null, h: data.originalHeightPx || null });
      } else {
        setOrigDims(null);
      }
      // Override known natural dimensions for quality checks if provided by backend
      if (data && (data.originalWidthPx || data.originalHeightPx)) {
        setTransformState(ts => ({
          ...(ts || {}),
          naturalWidth: data.originalWidthPx || ts?.naturalWidth || 0,
          naturalHeight: data.originalHeightPx || ts?.naturalHeight || 0
        }));
      }
    } catch (error) {
      const err = String(error?.message || '');
      if (err.includes('timeout')) {
        setMessage('Dein Bild kann vom Konfigurator nicht verarbeitet werden. Bitte kontaktiere uns unter witaprint@wirzwelt.ch.');
      } else if (err.includes('imagemagick_missing')) {
        setMessage('Vorschau konnte nicht erstellt werden (ImageMagick nicht installiert). Die Datei wurde gespeichert.');
      } else if (err.includes('preview_failed')) {
        setMessage('Vorschau konnte nicht erstellt werden. Die Datei wurde gespeichert.');
      } else {
        setMessage('Fehler beim Upload.');
      }
    }
    setWorking(false);
  };

  // Config payload
  const buildConfigPayload = () => {
    const widthCm = Math.round(Number(frameWidthCm) || 0);
    const heightCm = Math.round(Number(frameHeightCm) || 0);
    const printW = Math.round(Number(area.printWidthCm) || widthCm);
    const printH = Math.round(Number(area.printHeightCm) || heightCm);
    const totalPrice = (pricePerM2 != null) ? Number((pricePerM2 * qm).toFixed(2)) : null;
    const params = Object.fromEntries(URL_PARAMS.entries());
    return {
      wall: { widthCm, heightCm },
      print: { widthCm: printW, heightCm: printH },
      areaM2: qm,
      calc: { mode: EFFECTIVE_WD_CALC, bahnenbreiteCm: BAHNENBREITE_CM || null, strips: area.strips || null, addedExtraStrip: !!area.addedExtraStrip },
      price: { perM2: pricePerM2, total: totalPrice, currency: 'CHF' },
      image: { url: imageUrl, originalUrl: originalUploadUrl || null },
      transform: { zoom, flipH, flipV, ...(transformState || {}) },
      context: { backend: BACKEND_URL, shop: params.shop || null, productId: params.productId || null, sku: params.sku || null }
    };
  };

  const loadByCode = async (code) => {
    const c = String(code || '').trim();
    if (!c) return;
    try {
      let res, data;
      try {
        res = await fetch(`${BACKEND_URL}/config/by-code/${encodeURIComponent(c)}`);
        {
          const ct = String(res.headers.get('content-type') || '').toLowerCase();
          data = ct.includes('application/json') ? await res.json() : { error: (await res.text()).slice(0, 300) };
        }
      } catch (_) {
        res = await fetch(`/config/by-code/${encodeURIComponent(c)}`);
        const ct2 = String(res.headers.get('content-type') || '').toLowerCase();
        data = ct2.includes('application/json') ? await res.json() : { error: (await res.text()).slice(0, 300) };
      }
      if (!res.ok) throw new Error(data?.error || 'Code nicht gefunden');
      setConfigState({ id: data.configId, code: data.code, detailUrl: data.detailUrl, signedUrl: data.signedUrl, confirmed: true, pdfUrl: data.pdfUrl || null });
      setApproved(false);
      setMessage(`Code geladen: ${data.code}. Du kannst jetzt das Gut zum Druck bestätigen und in den Warenkorb legen.`);
    } catch (e) {
      setMessage('Code konnte nicht geladen werden.');
    }
  };

  const saveConfig = async () => {
    if (saving) return configState.id;
    setSaving(true);
    try {
      const payload = buildConfigPayload();
      let res, data;
      try {
        res = await fetch(`${BACKEND_URL}/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        {
          const ct = String(res.headers.get('content-type') || '').toLowerCase();
          data = ct.includes('application/json') ? await res.json() : { error: (await res.text()).slice(0, 300) };
        }
      } catch (_) {
        res = await fetch(`/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const ct2 = String(res.headers.get('content-type') || '').toLowerCase();
        data = ct2.includes('application/json') ? await res.json() : { error: (await res.text()).slice(0, 300) };
      }
      if (!res.ok) throw new Error(data?.error || 'Speichern fehlgeschlagen');
      setConfigState({ id: data.configId, code: data.code, detailUrl: data.detailUrl, signedUrl: data.signedUrl, confirmed: false, pdfUrl: null });
      setMessage(`Konfiguration gespeichert. Dein Code lautet ${data.code}. Du kannst diese Konfiguration jederzeit unter ${data.detailUrl} ansehen oder mit dem Code im Feld "Code einfügen" im Konfigurator wieder aufrufen.`);
      try {
        const pdfUrl = `${BACKEND_URL}/config/${encodeURIComponent(data.configId)}/pdf?download=1`;
        const a = document.createElement('a');
        a.href = pdfUrl;
        a.download = `${data.code}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (_) {}
      return data.configId;
    } catch (e) {
      let msg = String(e?.message || '');
      if (/^\s*<!doctype|<html/i.test(msg)) {
        msg = 'Serverfehler (möglicherweise 502). Bitte später erneut versuchen oder witaprint@wirzwelt.ch kontaktieren.';
      }
      setMessage(`Fehler beim Erstellen des Gut zum Druck: ${msg}`.trim());
      return null;
    } finally {
      setSaving(false);
    }
  };

  const addToCart = async () => {
    let id = configState.id;
    if (!id) { id = await saveConfig(); }
    if (!file) return;
    if (!configState || !configState.id) {
      setMessage('Bitte zuerst eine Konfiguration anlegen oder laden, bevor du ein Bild hochlädst.');
      return;
    }
    setMessage('Bild wird hochgeladen und aufbereitet...');
    setWorking(true);
    const formData = new FormData();
    formData.append('wallpaper', file);
    formData.append('id', configState.id);
  if (EFFECTIVE_WD_CALC === 'bahnen' && BAHNENBREITE_CM) {
      props['Bahnenbreite'] = `${BAHNENBREITE_CM} cm`;
      if (area.strips) props['Anzahl Bahnen'] = String(area.strips);
    }
    props['Fläche'] = `${qm.toFixed(3)} m²`;
    if (pricePerM2 != null) {
      props['Preis/m²'] = `CHF ${formatCHF(pricePerM2)}`;
      props['Gesamtpreis'] = `CHF ${formatCHF(pricePerM2 * qm)}`;
    }
    if (configState.signedUrl || configState.detailUrl) props['Konfiguration'] = configState.signedUrl || configState.detailUrl;
    try {
      const payload = { type: 'wpd.cart.add', source: 'wpd', properties: props, quantity: 1 };
      window.parent && window.parent.postMessage(payload, '*');
      window.parent && window.parent.postMessage({ type: 'wpd.overlay.close', source: 'wpd' }, '*');
    } catch (_) {}
  };

  const handleDelete = () => { setImageUrl(null); setMessage('Bild gelöscht.'); };

  const isShopImage = (url) => {
    if (!url) return false;
    const u = String(url).toLowerCase();
    return u.includes('/products/') || u.includes('/shopify/') || u.includes('/cdn.shopify.com');
  };

  const recomputeQuality = () => {
    const url = imageUrl;
    // Case 1: Shop image (products) -> do not check
    if (isShopImage(url)) {
      setQualityLevel('none');
      setQualityMsg(null);
      setQualityColor('#666');
      return;
    }
    // Case 2: PDF/SVG/EPS -> green info
    if (isVectorOrPdf) {
      setQualityLevel('none');
      setQualityMsg(null);
      setQualityColor('#666');
      return;
    }
    // Case 3: Other images -> check quality
    const natW = transformState?.naturalWidth || 0;
    const natH = transformState?.naturalHeight || 0;
    if (!natW || !natH) {
      setQualityLevel(null);
      setQualityMsg(null);
      setQualityColor('#666');
      return;
    }
    const effW = Math.floor(natW / (transformState?.zoom || 1));
    const effH = Math.floor(natH / (transformState?.zoom || 1));
    const wallWcm = Math.round(Number(frameWidthCm) || 0);
    const wallHcm = Math.round(Number(frameHeightCm) || 0);
    const needW10 = wallWcm * 10, needH10 = wallHcm * 10;
    const needW15 = wallWcm * 15, needH15 = wallHcm * 15;
    const needW20 = wallWcm * 20, needH20 = wallHcm * 20;

    // Red
    if (effW < needW10 || effH < needH10) {
      const maxWcm = Math.round(effW / 15);
      const maxHcm = Math.round(effH / 15);
      setQualityLevel('red');
      setQualityMsg(`Die Qualität deines Bildes ist für den Druck in dieser Grösse ungenügend. Das maximale Druckmass ist Breite (${maxWcm} cm), Höhe (${maxHcm} cm)`);
      setQualityColor('#c00');
      return;
    }
    // Orange
    if (effW < needW15 || effH < needH15) {
      const maxWcm = Math.round(effW / 15);
      const maxHcm = Math.round(effH / 15);
      setQualityLevel('orange');
      setQualityMsg(`Die Qualität deines Bildes ist für den Druck in dieser Grösse knapp ungenügend. Das maximal empfohlene  Druckmass ist Breite (${maxWcm} cm), Höhe (${maxHcm} cm)`);
      setQualityColor('#e69100');
      return;
    }
    // Grün (sehr gut) if below 20x -> show no message per spec
    if (effW < needW20 || effH < needH20) {
      setQualityLevel('green');
      setQualityMsg(null);
      setQualityColor('#0a0');
      return;
    }
    // Above 20x: Keine Aussage (no message)
    setQualityLevel('none');
    setQualityMsg(null);
    setQualityColor('#666');
  };

  useEffect(() => {
    recomputeQuality();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, frameWidthCm, frameHeightCm, transformState?.zoom, transformState?.naturalWidth, transformState?.naturalHeight]);

  const renderMessage = () => {
    if (!message && !qualityMsg) return null;
    const isError = /Fehler|konnte nicht|nicht verarbeitet/i.test(message);
    const email = 'witaprint@wirzwelt.ch';
    const parts = (message || '').split(email);
    return (
      <div style={{ margin: '8px 0 12px', padding: '10px 12px', border: '1px solid #eee', background: isError ? '#FDECEA' : '#FFF8E1', color: isError ? '#A30000' : '#8C6A00' }}>
        {/* Existing status message */}
        {parts.map((p, i) => (
          <React.Fragment key={i}>
            {p}
            {i < parts.length - 1 && (
              <a href={`mailto:${email}`} style={{ color: '#8C6A00', textDecoration: 'underline' }}>{email}</a>
            )}
          </React.Fragment>
        ))}
        {/* Quality message */}
        {qualityMsg && (
          <div style={{ marginTop: 8, padding: '8px 10px', border: '1px dashed #ddd', color: qualityColor }}>
            {qualityMsg}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: 20 }}>
      {/* Aktuelle Konfigurations-ID anzeigen */}
      <div style={{ background: '#ffe', color: '#333', padding: '6px 12px', marginBottom: 8, border: '1px solid #ccc', borderRadius: 4 }}>
        {configState && configState.id
          ? <>Aktive Konfiguration: <b>{configState.id}</b></>
          : <span style={{ color: 'red' }}>Keine Konfiguration aktiv! Bitte zuerst anlegen oder laden.</span>}
      </div>
      {/* Main layout */}
      <div style={{ display: 'flex', flexDirection: isNarrow ? 'column' : 'row', alignItems: isNarrow ? 'center' : 'flex-start', justifyContent: 'center', gap: isNarrow ? 16 : 16 }}>
        <div style={{ flex: '0 1 auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {/* Hinweis */}
          <div style={{ color: '#888', marginBottom: 8, width: containerWidthAligned, margin: '0 auto', textAlign: 'left' }}>
            {renderMessage()}
            Ziehe das Bild mit der Maus, um es im Rahmen zu verschieben und den Ausschnitt für deine Wand zu bestimmen.<br />Der hellgraue Bereich zeigt an, was abgeschnitten wird.
          </div>
          <FrameDesigner
            imageUrl={imageUrl}
            frameWidthCm={Math.round(area.printWidthCm || frameWidthCm)}
            frameHeightCm={Math.round(area.printHeightCm || frameHeightCm)}
            zoom={zoom}
            flipH={flipH}
            flipV={flipV}
            onDropFile={(file) => uploadFile(file)}
            onPickFile={() => fileInputRef.current && fileInputRef.current.click()}
            working={working}
            uploadDisabled={uploadLocked}
            overlayWallWidthCm={frameWidthCm}
            overlayWallHeightCm={frameHeightCm}
            codeInput={codeInput}
            onChangeCodeInput={setCodeInput}
            onLoadByCode={loadByCode}
            onTransformChange={(tr) => setTransformState({
              ...tr,
              naturalWidth: (origDims?.w || tr.naturalWidth || 0),
              naturalHeight: (origDims?.h || tr.naturalHeight || 0)
            })}
            onRequestZoom={(z) => setZoomClamped(z)}
          />
          {/* Zoom/Spiegeln unter dem Frame */}
          <div style={{ width: containerWidthAligned, margin: '8px auto 0', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
            <label htmlFor="zoom-slider" style={{ fontWeight: 'bold' }}>Zoom:</label>
            <div style={{ position: 'relative', width: 120, paddingTop: 18 }}>
              <div
                title="Zoom zurücksetzen"
                onClick={() => setZoomClamped(1)}
                onMouseEnter={() => setShowZoomTip(true)}
                onMouseLeave={() => setShowZoomTip(false)}
                style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 0, fontSize: '0.85rem', color: 'var(--zoom-accent)', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
              >
                Reset zoom
              </div>
              {showZoomTip && (
                <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: -26, background: 'var(--ui-bg)', border: '1px solid var(--border)', padding: '4px 8px', fontSize: '0.8rem', color: 'var(--text)', borderRadius: 0, whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}>
                  Klick: Zoom zurücksetzen
                </div>
              )}
              <input
                id="zoom-slider"
                type="range"
                min={minZoom}
                max={maxZoom}
                step={0.01}
                value={zoom}
                onChange={e => setZoomClamped(Number(e.target.value))}
                style={{ width: '100%' }}
                ref={sliderRef}
              />
            </div>
            <span style={{ minWidth: 56 }}>{Math.round(zoom * 100)}%</span>
            {working && (<span style={{ marginLeft: 12, color: '#8C6A00' }}>Bitte warten…</span>)}
            <button onClick={() => setFlipH(f => !f)}>Horizontal spiegeln</button>
            <button onClick={() => setFlipV(f => !f)}>Vertikal spiegeln</button>
            {imageUrl && !uploadLocked && (<button onClick={handleDelete} style={{ marginLeft: 24, color: '#c00', fontWeight: 'bold' }}>Bild löschen</button>)}
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ flex: isNarrow ? '0 1 auto' : '0 0 320px', marginLeft: 0, background: '#F4F2EC', borderRadius: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', padding: 24, alignSelf: isNarrow ? 'center' : 'flex-start', marginTop: isNarrow ? 8 : 0 }}>
          {/* hidden file input for dropzone/button */}
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/tiff,image/svg+xml,application/pdf,application/postscript,application/eps,application/x-eps" onChange={handleFileChange} style={{ display: 'none' }} />

      {/* Size selection card */}
          <div style={{ marginBottom: 24, padding: '18px 12px', background: '#fff', borderRadius: 0, border: '1px solid #eee', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '1em', fontWeight: 'bold' }}>Passe die Masse auf deine Wandgrösse an</h3>
            {EFFECTIVE_WD_CALC === 'bahnen' && (
              <div style={{ margin: '0 0 12px 0', color: '#c00', fontSize: '0.85em' }}>
                Gib das exakte Wandmass hier ein. Wir berechnen die benötigten Bahnen und geben 10 cm Toleranz in der Höhe hinzu.
              </div>
            )}
            {EFFECTIVE_WD_CALC === 'm2' && (
              <div style={{ margin: '0 0 12px 0', color: '#c00', fontSize: '0.85em' }}>
                Gib das exakte Wandmass hier ein. Wir geben 10 cm Toleranz in Breite und Höhe hinzu.
              </div>
            )}
            {/* Default handled by EFFECTIVE_WD_CALC */}
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label>Wandbreite (cm): </label>
                <input type="number" value={frameWidthCm} min={10} max={1000} onChange={e => setFrameWidthCm(Number(e.target.value))} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Wandhöhe (cm): </label>
                <input type="number" value={frameHeightCm} min={10} max={1000} onChange={e => setFrameHeightCm(Number(e.target.value))} />
              </div>
            </div>
            {/* Compact calculation table */}
            {(EFFECTIVE_WD_CALC === 'bahnen' && BAHNENBREITE_CM) && (
              <div style={{ marginTop: 8, color: '#333' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85em' }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee', width: '50%' }}>Bahnenbreite</td>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee' }}>{BAHNENBREITE_CM} cm</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee' }}>Anzahl Bahnen</td>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee' }}>{area.strips}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee' }}>Druckmass Breite</td>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee' }}>
                        <span style={{ position: 'relative', display: 'inline-block' }}>
                          <b>{Math.round(area.printWidthCm)} cm</b>
                          {area.addedExtraStrip && (
                            <span
                              onMouseEnter={() => setShowWidthInfo(true)}
                              onMouseLeave={() => setShowWidthInfo(false)}
                              style={{
                                marginLeft: 8,
                                display: 'inline-block',
                                width: 16,
                                height: 16,
                                lineHeight: '16px',
                                textAlign: 'center',
                                borderRadius: '50%',
                                border: '1px solid #0a0',
                                color: '#0a0',
                                fontSize: 12,
                                cursor: 'default'
                              }}
                              aria-label="Info"
                            >i
                              {showWidthInfo && (
                                <div style={{
                                  position: 'absolute',
                                  zIndex: 10,
                                  top: '120%',
                                  right: 0,
                                  minWidth: 240,
                                  background: '#f6fff6',
                                  border: '1px solid #cfe9cf',
                                  color: '#0a0',
                                  padding: '8px 10px',
                                  borderRadius: 4,
                                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                                  textAlign: 'right'
                                }}>
                                  Da das Druckmass nur minimal grösser war als das Wandmass, haben wir eine Bahn hinzugefügt. Ohne diese Bahn kann es zu Problemen bei der Verarbeitung kommen.
                                </div>
                              )}
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee' }}>Druckmass Höhe</td>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee' }}><b>{(Number(frameHeightCm)||0) + 10} cm</b></td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px' }}>Total Fläche</td>
                      <td style={{ padding: '4px 6px' }}><b>{((area.printWidthCm/100) * (area.printHeightCm/100)).toFixed(3)} m²</b></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {EFFECTIVE_WD_CALC === 'm2' && (
              <div style={{ marginTop: 8, color: '#333' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85em' }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee', width: '50%' }}>Druckmass Breite</td>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee' }}><b>{(Number(frameWidthCm)||0) + 10} cm</b></td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee' }}>Druckmass Höhe</td>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee' }}><b>{(Number(frameHeightCm)||0) + 10} cm</b></td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 6px' }}>Total Fläche</td>
                      <td style={{ padding: '4px 6px' }}><b>{((area.printWidthCm/100) * (area.printHeightCm/100)).toFixed(3)} m²</b></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div style={{ marginTop: 32, padding: '18px 12px', background: '#fff', borderRadius: 0, border: '1px solid #eee', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1em', fontWeight: 'bold' }}>Preisrechner</h3>
            <div style={{ color: '#333' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85em' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee', width: '50%' }}>Quadratmeter</td>
                    <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee' }}><b>{qm.toFixed(3)} m²</b></td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee' }}>Preis pro m²</td>
                    <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee' }}>
                      {qm < 3 ? (
                        <span style={{ color: '#c00', fontWeight: 'bold' }}>Mindestgrösse 3m²</span>
                      ) : pricePerM2 !== null && !calcError ? (
                        <b>CHF {formatCHF(pricePerM2)}</b>
                      ) : (
                        <span style={{ color: '#c00' }}>{calcError || '–'}</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {qm >= 3 && pricePerM2 !== null && !calcError && (
              <div style={{ marginTop: 8, fontSize: '1.1em', fontWeight: 'bold', color: 'var(--zoom-accent)' }}>Gesamtpreis: CHF {formatCHF(pricePerM2 * qm)}</div>
            )}
            {/* Aktionen */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
              {/* Gut zum Druck erstellen with Tooltip */}
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={saveConfig}
                  disabled={saving || qualityLevel === 'red' || qm < 3}
                  onMouseEnter={() => setShowCreateTip(true)}
                  onMouseLeave={() => setShowCreateTip(false)}
                  title={
                    qm < 3
                      ? 'Die Mindestgrösse für eine Bestellung beträgt 3m².'
                      : qualityLevel === 'red'
                        ? 'Die Qualität deines Bildes ist für den Druck in dieser Grösse ungenügend'
                        : undefined
                  }
                  style={{ display: 'block', width: '100%', margin: '0 auto', background: '#f6fff6', border: '1px solid #cfe9cf', cursor: (saving || qualityLevel==='red' || qm < 3) ? 'not-allowed' : 'pointer', opacity: (saving || qualityLevel==='red' || qm < 3) ? 0.7 : 1 }}
                >
                  {saving ? 'Erstelle…' : (configState.code ? `Gut zum Druck erstellt (${configState.code})` : 'Gut zum Druck erstellen')}
                </button>
                {(!configState.code && showCreateTip) && (
                  <div style={{ position: 'absolute', zIndex: 10, top: '120%', right: 0, minWidth: 260, background: '#f6fff6', border: '1px solid #cfe9cf', color: '#0a0', padding: '8px 10px', borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', textAlign: 'right', fontSize: '0.85em' }}>
                    Nach dem Erstellen erhältst du einen Code. Mit diesem Code kannst du die Konfiguration im Feld „Code einfügen“ wieder laden.
                  </div>
                )}
              </div>
              {/* Bestätigung (Checkbox) nur anzeigen, wenn ein Code vorhanden ist */}
              {configState.code && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} />
                  <span>Ich bestätige das Gut zum Druck ({configState.code})</span>
                </label>
              )}
              {/* In den Warenkorb */}
              <button type="button" onClick={addToCart} disabled={!!calcError || !approved} style={{ display: 'block', width: '100%', margin: '0 auto' }}>
                In den Warenkorb
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);
