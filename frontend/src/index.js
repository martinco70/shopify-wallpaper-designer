import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ImportImages from './ImportImages';
// (Rollback) Build-Diagnostikmarker entfernt

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
// Feature flag: wd-feature=classic to bypass new bahnen preview logic
const WD_FEATURE = ((URL_PARAMS.get('wd-feature') || '').trim().toLowerCase()) || null; // 'classic' | null
const USE_CLASSIC_PREVIEW = WD_FEATURE === 'classic';
// (Rollback Option A) Rücksprung-Mechanik entfernt: Feste Default-Route für expliziten "Zurück" Button außerhalb Overlay-Kontext
const DEFAULT_RETURN_URL = 'https://rtp0h2-cv.myshopify.com';
function goBackFallback(){ try { window.location.href = DEFAULT_RETURN_URL; } catch(_) {} }
// (Rollback) Erweiterte Launcher-Flags & Material-Preset deaktiviert
const LAUNCH_MODE = '';
const START_EMPTY = false;
const SHOW_UPLOAD_FLAG = true; // Basis-Upload wieder standardmäßig aktiv
const SHOW_MATERIAL_FLAG = false; // Kein Material-Dropdown mehr
const MATERIAL_PRESET = '';
const INITIAL_IMAGE_URL = (() => {
  const raw = URL_PARAMS.get('image');
  if (!raw) return null;
  const v = String(raw).trim().replace(/^"|"$/g, '');
  if (/^https?:\/\//i.test(v)) return v;
  // Falls Shop liefert einen pfad wie //cdn.shopify.com/... oder /cdn/shop/... -> absolutify
  if (/^\/\//.test(v)) return `https:${v}`;
  if (/^\//.test(v)) return `${window.location.origin}${v}`;
  return v;
})();
// Calculation mode and strip width
const WD_CALC_PARAM = ((URL_PARAMS.get('wd-calc') || '').trim().toLowerCase()) || null; // 'bahnen' | 'm2' | null
// Default: 'm2'; kann durch Theme-Metafeld ersetzt werden (kein Material-Katalog mehr)
const DEFAULT_WD_CALC = WD_CALC_PARAM || 'm2';
const BAHNENBREITE_PARAM = (() => {
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
// Pricing mode: default fixed_total; enable quantity scaling via ?qtyMode=area_x100
const QTY_MODE_PARAM = ((URL_PARAMS.get('qtyMode') || '').trim().toLowerCase()) || null; // 'area_x100' | null
// Standard jetzt: Mengen-Skalierung aktiv, außer explizit ?qtyMode=fixed oder fixed_total
const USE_QTY_SCALING = QTY_MODE_PARAM === 'area_x100' || QTY_MODE_PARAM === null;
const formatCHF = (value) => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));

// --- Inline SVG Icons (stroke=currentColor) ---
// Improved icon set (legible metaphors, consistent stroke=2)
const IconReset = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 5a7 7 0 1 1-4.95 2.05" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 5H4V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IconStripes = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="4" width="18" height="16" stroke="currentColor" strokeWidth="2" />
    <line x1="9" y1="4" x2="9" y2="20" stroke="currentColor" strokeWidth="2" />
    <line x1="15" y1="4" x2="15" y2="20" stroke="currentColor" strokeWidth="2" />
  </svg>
);
const IconOverage = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="4" width="18" height="16" stroke="currentColor" strokeWidth="2" />
    <rect x="15" y="4" width="6" height="16" fill="currentColor" opacity="0.25" />
  </svg>
);
const IconFlipH = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 12h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M8 8l-4 4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M16 8l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IconFlipV = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 21V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M8 16l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 8l4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IconTrash = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 6h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M9 6l1-2h4l1 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="6" y="6" width="12" height="13" rx="1" stroke="currentColor" strokeWidth="2" />
    <path d="M10 10v6M14 10v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// Pure frame/preview component
function FrameDesigner({ imageUrl, frameWidthCm, frameHeightCm, zoom = 1, flipH = false, flipV = false, onDropFile, onPickFile, working = false, uploadDisabled = false, overlayWallWidthCm = null, overlayWallHeightCm = null, codeInput, onChangeCodeInput, onLoadByCode, onTransformChange, onRequestZoom, readonly = false, initTransform = null, 
  // New optional props for bahnen preview enhancements
  displayWidthCm = null, // visible image width (W+10) within print frame
  extraWhiteWidthCm = 0, // white overlay width on the right (<= bahnenbreite)
  showStripLines = false, // toggle for fine red strip boundaries
  stripWidthCm = null, // bahnenbreite in cm
  stripsCount = null, // number of strips
  wallOffsetCm = null, // if provided, anchor wall overlay this many cm from the left of the VISIBLE image
  overageSide = 'right', // 'right' (default) or 'left'
  showDimensions = true, // neue Steuerung: Labels + roter Overlay erst nach Eingabe anzeigen
  fixedContainerMinWidthPx = null,
  fixedContainerMinHeightPx = null
}) {
  const [imgPos, setImgPos] = useState({ x: 0, y: 0 });
  const [overInfoHover, setOverInfoHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [startDrag, setStartDrag] = useState({ x: 0, y: 0 });
  const [imgSize, setImgSize] = useState({ width: 0, height: 0, scale: 1, naturalWidth: 0, naturalHeight: 0 });
  const [imgError, setImgError] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const imgRef = useRef(null);
  const appliedInitRef = useRef(false);
  const lastOffsetsRef = useRef({ ox: 0.5, oy: 0.5 });

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
  const layoutWidth = frameWidthPx + borderPx * 2;
  const layoutHeight = frameHeightPx + borderPx * 2;
  const containerWidth = Math.max(layoutWidth, Number(fixedContainerMinWidthPx)||0);
  const containerHeight = Math.max(layoutHeight, Number(fixedContainerMinHeightPx)||0);
  const offsetX = Math.round((containerWidth - layoutWidth) / 2);
  const offsetY = Math.round((containerHeight - layoutHeight) / 2);
  const wallOverlayWidthPx = overlayWallWidthCm ? Math.max(0, (overlayWallWidthCm * CM_TO_PX) * scale) : 0;
  const wallOverlayHeightPx = overlayWallHeightCm ? Math.max(0, (overlayWallHeightCm * CM_TO_PX) * scale) : 0;
  const cmToPxScaled = CM_TO_PX * scale;
  const visibleWidthPx = (displayWidthCm != null) ? Math.max(0, Math.round(displayWidthCm * cmToPxScaled)) : frameWidthPx;
  const extraWhitePx = extraWhiteWidthCm ? Math.max(0, Math.round(extraWhiteWidthCm * cmToPxScaled)) : 0;
  const visibleOffsetPx = (overageSide === 'left') ? extraWhitePx : 0; // sichtbarer Bildbereich beginnt bei 0 oder bei extraWhitePx

  // Reposition on zoom changes using last known offsets (relative to visible image width)
  useEffect(() => {
    if (readonly) return;
    if (!imgSize || !imgSize.width || !imgSize.height) return;
    // Offsets sind jetzt auf Naturalgröße bezogen; zur Positionierung müssen wir die gezeichnete Größe berücksichtigen
    const ox = Math.max(0, Math.min(1, Number(lastOffsetsRef.current.ox ?? 0.5)));
    const oy = Math.max(0, Math.min(1, Number(lastOffsetsRef.current.oy ?? 0.5)));
    const denomW = imgSize.naturalWidth * imgSize.scale * zoom;
    const denomH = imgSize.naturalHeight * imgSize.scale * zoom;
    let newX = Math.round((visibleWidthPx / 2) - ox * denomW);
    let newY = Math.round((frameHeightPx / 2) - oy * denomH);
    const minX = visibleWidthPx - denomW;
    const minY = frameHeightPx - denomH;
    newX = Math.min(0, Math.max(newX, minX));
    newY = Math.min(0, Math.max(newY, minY));
    setImgPos({ x: newX, y: newY });
  }, [zoom, imgSize.width, imgSize.height, visibleWidthPx, frameHeightPx]);

  // On image load: compute base cover scale
  useEffect(() => {
    setImgError(false);
    if (!imageUrl) return;
    const handleLoad = (e) => {
      const naturalWidth = e.target.naturalWidth;
      const naturalHeight = e.target.naturalHeight;
      if (!naturalWidth || !naturalHeight) return;
  const scaleW = visibleWidthPx / naturalWidth;
      const scaleH = frameHeightPx / naturalHeight;
      let s = Math.max(scaleW, scaleH);
      if (s > 1) s = 1;
      const scaledWidth = Math.round(naturalWidth * s);
      const scaledHeight = Math.round(naturalHeight * s);
      setImgSize({ width: scaledWidth, height: scaledHeight, scale: s, naturalWidth, naturalHeight });
  let pos = { x: Math.round((visibleWidthPx - scaledWidth) / 2), y: Math.round((frameHeightPx - scaledHeight) / 2) };
      // Apply initial transform once if provided (offsetXPct/offsetYPct)
      if (initTransform && !appliedInitRef.current) {
        const ox = Number(initTransform.offsetXPct);
        const oy = Number(initTransform.offsetYPct);
        const hasOffsets = Number.isFinite(ox) && Number.isFinite(oy);
        if (hasOffsets && scaledWidth > 0 && scaledHeight > 0) {
          const z = Number.isFinite(Number(initTransform.zoom)) ? Number(initTransform.zoom) : zoom;
          // offsets beziehen sich auf Naturalgröße; positioniere mit gezeichneter Größe (natural * scale * zoom)
          const denomW = naturalWidth * s * z;
          const denomH = naturalHeight * s * z;
          const centerX = Math.max(0, Math.min(1, ox)) * denomW;
          const centerY = Math.max(0, Math.min(1, oy)) * denomH;
          pos = { x: Math.round((visibleWidthPx / 2) - centerX), y: Math.round((frameHeightPx / 2) - centerY) };
          lastOffsetsRef.current = { ox: Math.max(0, Math.min(1, ox)), oy: Math.max(0, Math.min(1, oy)) };
          appliedInitRef.current = true;
        }
      }
      setImgPos(pos);
      onTransformChange && onTransformChange({ zoom, offsetXPct: initTransform?.offsetXPct ?? 0.5, offsetYPct: initTransform?.offsetYPct ?? 0.5, naturalWidth, naturalHeight });
      // Ensure initial coverage by requesting zoom if needed (so the slider moves too)
      if (onRequestZoom) {
        // If initTransform carries a target zoom, prefer it; otherwise compute needed cover zoom
        const targetZoom = Number.isFinite(Number(initTransform?.zoom)) ? Number(initTransform.zoom) : null;
        if (targetZoom && targetZoom !== zoom) {
          onRequestZoom(Math.max(1, Math.min(3, Number(targetZoom.toFixed(4)))));
        } else {
          const needZoomW = scaledWidth ? (visibleWidthPx / scaledWidth) : 1;
          const needZoomH = scaledHeight ? (frameHeightPx / scaledHeight) : 1;
          const zoomNeeded = Math.max(needZoomW, needZoomH, 1);
          if (zoomNeeded > zoom) onRequestZoom(Math.min(3, Number(zoomNeeded.toFixed(4))));
        }
      }
    };
    if (imgRef.current) {
      imgRef.current.onload = handleLoad;
      imgRef.current.onerror = () => setImgError(true);
    }
  }, [imageUrl, visibleWidthPx, frameHeightPx, initTransform, zoom]);

  // When frame size changes (wall/print dims), recompute base cover scale and enforce coverage
  useEffect(() => {
    if (!imgSize.naturalWidth || !imgSize.naturalHeight) return;
  const scaleW = visibleWidthPx / imgSize.naturalWidth;
    const scaleH = frameHeightPx / imgSize.naturalHeight;
    let s = Math.max(scaleW, scaleH);
    if (s > 1) s = 1;
    const scaledWidth = Math.round(imgSize.naturalWidth * s);
    const scaledHeight = Math.round(imgSize.naturalHeight * s);
    if (scaledWidth !== imgSize.width || scaledHeight !== imgSize.height || s !== imgSize.scale) {
      setImgSize({ ...imgSize, width: scaledWidth, height: scaledHeight, scale: s });
  // Reposition with current zoom using last known offsets
  // IMPORTANT: use the same denominator as elsewhere (naturalWidth * scale * zoom)
  // to avoid tiny drift between initial load and subsequent recalculations.
  const ox = Math.max(0, Math.min(1, Number(lastOffsetsRef.current.ox ?? 0.5)));
  const oy = Math.max(0, Math.min(1, Number(lastOffsetsRef.current.oy ?? 0.5)));
  const denomW = imgSize.naturalWidth * s * zoom;
  const denomH = imgSize.naturalHeight * s * zoom;
  let newX = Math.round((visibleWidthPx / 2) - ox * denomW);
  let newY = Math.round((frameHeightPx / 2) - oy * denomH);
  const minX = visibleWidthPx - denomW;
      const minY = frameHeightPx - denomH;
      newX = Math.min(0, Math.max(newX, minX));
      newY = Math.min(0, Math.max(newY, minY));
      setImgPos({ x: newX, y: newY });
    }
    // Ensure no white stripes: if current zoom is too small, request a larger zoom
  const needZoomW = scaledWidth ? (visibleWidthPx / scaledWidth) : 1;
    const needZoomH = scaledHeight ? (frameHeightPx / scaledHeight) : 1;
    const zoomNeeded = Math.max(needZoomW, needZoomH, 1);
    if (onRequestZoom && zoomNeeded > zoom) {
      onRequestZoom(Math.min(3, Number(zoomNeeded.toFixed(4))));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleWidthPx, frameHeightPx, imgSize.naturalWidth, imgSize.naturalHeight, zoom]);

  const emitTransform = () => {
    if (!onTransformChange || !imgSize.width || !imgSize.height) return;
    // Frame center relative to image top-left (zoomed)
    const centerX = (visibleWidthPx / 2) - imgPos.x;
    const centerY = (frameHeightPx / 2) - imgPos.y;
    // Offsets künftig auf Naturalgröße beziehen
    const denomW = imgSize.naturalWidth * imgSize.scale * zoom;
    const denomH = imgSize.naturalHeight * imgSize.scale * zoom;
    const offsetXPct = Math.max(0, Math.min(1, denomW ? centerX / denomW : 0.5));
    const offsetYPct = Math.max(0, Math.min(1, denomH ? centerY / denomH : 0.5));
    lastOffsetsRef.current = { ox: offsetXPct, oy: offsetYPct };
    onTransformChange({
      zoom,
      offsetXPct,
      offsetYPct,
      naturalWidth: imgSize.naturalWidth,
      naturalHeight: imgSize.naturalHeight
    });
  };

  const onMouseDown = (e) => {
    if (readonly) return;
    setDragging(true);
    setStartDrag({ x: e.clientX - imgPos.x, y: e.clientY - imgPos.y });
  };
  const onMouseUp = () => setDragging(false);
  const onMouseMove = (e) => {
    if (!dragging) return;
    let newX = e.clientX - startDrag.x;
    let newY = e.clientY - startDrag.y;
    if (imgRef.current) {
      const minX = visibleWidthPx - imgSize.width * zoom;
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
    // Do not emit a duplicate right after applying initTransform; still compute from current state
  const centerX = (visibleWidthPx / 2) - imgPos.x;
    const centerY = (frameHeightPx / 2) - imgPos.y;
    // Natural-basierte Offsets
    const denomW = imgSize.naturalWidth * imgSize.scale * zoom;
    const denomH = imgSize.naturalHeight * imgSize.scale * zoom;
    const offsetXPct = Math.max(0, Math.min(1, denomW ? centerX / denomW : 0.5));
    const offsetYPct = Math.max(0, Math.min(1, denomH ? centerY / denomH : 0.5));
    lastOffsetsRef.current = { ox: offsetXPct, oy: offsetYPct };
    onTransformChange({
      zoom,
      offsetXPct,
      offsetYPct,
      naturalWidth: imgSize.naturalWidth,
      naturalHeight: imgSize.naturalHeight
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleWidthPx, frameHeightPx, imgPos.x, imgPos.y, zoom, imgSize.width, imgSize.height, imgSize.naturalWidth, imgSize.naturalHeight]);

  return (
    <div style={{ marginTop: 0 }}>
      {imgError && (<div style={{ color: '#c00', marginTop: 8 }}>Fehler: Bild konnte nicht geladen werden.</div>)}
      <div style={{ position: 'relative', width: containerWidth, height: containerHeight, margin: '0 auto', minHeight: 300 }}>
        {/* Outer masks always visible */}
  <div style={{ position: 'absolute', left: 0, top: 0, width: containerWidth, height: offsetY + borderPx, background: 'rgba(255,255,255,0.8)', zIndex: 110, pointerEvents: 'none' }} />
  <div style={{ position: 'absolute', left: 0, top: offsetY + borderPx + frameHeightPx, width: containerWidth, height: containerHeight - (offsetY + borderPx + frameHeightPx), background: 'rgba(255,255,255,0.8)', zIndex: 110, pointerEvents: 'none' }} />
  <div style={{ position: 'absolute', left: 0, top: offsetY + borderPx, width: offsetX + borderPx, height: frameHeightPx, background: 'rgba(255,255,255,0.8)', zIndex: 110, pointerEvents: 'none' }} />
  <div style={{ position: 'absolute', left: offsetX + borderPx + frameWidthPx, top: offsetY + borderPx, width: containerWidth - (offsetX + borderPx + frameWidthPx), height: frameHeightPx, background: 'rgba(255,255,255,0.8)', zIndex: 110, pointerEvents: 'none' }} />
        {/* Image area clipped to visible image width (Wandmass + 10 cm) */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: containerWidth, height: containerHeight, zIndex: 101 }}>
          <div style={{ position: 'absolute', left: offsetX + borderPx + visibleOffsetPx, top: offsetY + borderPx, width: visibleWidthPx, height: frameHeightPx, overflow: 'hidden' }}>
            {imageUrl && !imgError && (
              <img
                ref={imgRef}
                src={imageUrl}
                alt="Wallpaper"
                style={{ position: 'absolute', left: imgPos.x, top: imgPos.y, cursor: readonly ? 'default' : 'grab', userSelect: 'none', width: imgSize.width * zoom, height: imgSize.height * zoom, maxWidth: 'none', maxHeight: 'none', display: 'block', transition: 'width 0.2s, height 0.2s', transform: `scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})` }}
                onMouseDown={onMouseDown}
                draggable={false}
              />
            )}
          </div>
        </div>
        {/* Frame border (Druckmass) */}
  <div style={{ position: 'absolute', left: offsetX + borderPx, top: offsetY + borderPx, width: frameWidthPx, height: frameHeightPx, border: '1px solid black', boxSizing: 'border-box', zIndex: 103, pointerEvents: 'none', background: imageUrl ? 'transparent' : '#fff' }} />
        {/* White overlay (Übermass) on chosen side with diagonal hatch */}
        {(extraWhitePx > 0) && (
          <div
            style={{ position: 'absolute', left: Math.round(offsetX + borderPx + (overageSide==='left' ? 0 : (frameWidthPx - extraWhitePx))), top: offsetY + borderPx, width: extraWhitePx, height: frameHeightPx, zIndex: 200, pointerEvents: 'none',
              backgroundImage: 'repeating-linear-gradient(-45deg, rgba(255,255,255,0.95) 0 8px, rgba(220,220,220,0.95) 8px 12px)'
            }}
          >
            {/* Info-Button nur wenn Übermass vorhanden, per Hover Tooltip */}
            <div style={{ position: 'absolute', top: 6, right: 6, pointerEvents: 'auto' }} onMouseEnter={() => setOverInfoHover(true)} onMouseLeave={() => setOverInfoHover(false)}>
              <div style={{ width: 18, height: 18, borderRadius: '50%', lineHeight: '16px', textAlign: 'center', fontWeight: 'bold', color: '#0a0', border: '1px solid #0a0', background: '#f6fff6', fontSize: 11, cursor: 'default' }}>i</div>
              {overInfoHover && (
                <div style={{ position: 'absolute', zIndex: 1000, top: '120%', right: 0, minWidth: 260, background: '#f6fff6', border: '1px solid #cfe9cf', color: '#0a0', padding: '8px 10px', fontSize: '0.75rem', boxShadow: '0 6px 18px rgba(0,0,0,0.18)' }}>
                  Wir verrechnen immer ganze Bahnen, der schraffierte Bereich zeigt die unbedruckte Fläche (Übermass). Mit dem Button „Übermass links/rechts“ kannst du wählen, auf welcher Seite des Bildes die unbedruckte Fläche sein soll.
                </div>
              )}
            </div>
          </div>
        )}
        {/* Strip boundary lines (fine red) */}
        {(showStripLines && stripWidthCm && stripsCount && stripsCount > 1) && (
          Array.from({ length: stripsCount - 1 }).map((_, i) => {
            let x;
            if (overageSide === 'left') {
              // Linien von rechtem sichtbarem Rand aus nach links
              const visibleRight = offsetX + borderPx + frameWidthPx; // gesamter Frame endet rechts, sichtbarer Bereich endet auch dort
              x = Math.round(visibleRight - Math.round((i + 1) * stripWidthCm * cmToPxScaled));
            } else {
              // Übermass rechts: Start links am sichtbaren Bereich
              x = Math.round(offsetX + borderPx + visibleOffsetPx + Math.round((i + 1) * stripWidthCm * cmToPxScaled));
            }
            return (
              <div key={`strip-${i}`} style={{ position: 'absolute', left: x, top: offsetY + borderPx, width: 0, height: frameHeightPx, borderLeft: '1px dashed rgba(200,0,0,0.7)', zIndex: 104, pointerEvents: 'none' }} />
            );
          })
        )}
        {/* Wall overlay (rot): centered by default; left-anchored with wallOffsetCm when provided */}
        {showDimensions && overlayWallWidthCm != null && overlayWallHeightCm != null && (
          <div style={{ position: 'absolute', left: offsetX + Math.round(borderPx + (wallOffsetCm != null ? (visibleOffsetPx + wallOffsetCm * cmToPxScaled) : (frameWidthPx - wallOverlayWidthPx) / 2)), top: offsetY + Math.round(borderPx + (frameHeightPx - wallOverlayHeightPx) / 2), width: Math.round(wallOverlayWidthPx), height: Math.round(wallOverlayHeightPx), border: '2px solid #c00', boxSizing: 'border-box', background: 'transparent', zIndex: 106, pointerEvents: 'none' }} />
        )}
        {/* Corner accents */}
  <div style={{position:'absolute',left:offsetX+borderPx,top:offsetY+borderPx,width:40,height:2,background:'linear-gradient(to right, black 0%, transparent 100%)',zIndex:104,pointerEvents:'none',transform:'rotate(-145deg)',transformOrigin:'left'}} />
  <div style={{position:'absolute',left:offsetX+borderPx+frameWidthPx,top:offsetY+borderPx,width:40,height:2,background:'linear-gradient(to right, black 0%, transparent 100%)',zIndex:104,pointerEvents:'none',transform:'rotate(-35deg)',transformOrigin:'left'}} />
  <div style={{position:'absolute',left:offsetX+borderPx,top:offsetY+borderPx+frameHeightPx,width:40,height:2,background:'linear-gradient(to right, black 0%, transparent 100%)',zIndex:104,pointerEvents:'none',transform:'rotate(145deg)',transformOrigin:'left'}} />
  <div style={{position:'absolute',left:offsetX+borderPx+frameWidthPx,top:offsetY+borderPx+frameHeightPx,width:40,height:2,background:'linear-gradient(to right, black 0%, transparent 100%)',zIndex:104,pointerEvents:'none',transform:'rotate(35deg)',transformOrigin:'left'}} />
        {/* Labels */}
        {showDimensions && overlayWallWidthCm != null && (
          <div style={{ position: 'absolute', left: offsetX + borderPx, top: offsetY + borderPx + frameHeightPx + borderPx/2 - 30, width: frameWidthPx, textAlign: 'center', color: '#c00', fontSize: '0.85em', zIndex: 121, pointerEvents: 'none' }}>{`Wandmass: ${Math.round(overlayWallWidthCm)} cm`}</div>
        )}
        {showDimensions && (
          <>
            <div style={{ position: 'absolute', left: offsetX + borderPx, top: offsetY + borderPx + frameHeightPx + borderPx/2 - 16, width: frameWidthPx, textAlign: 'center', color: '#222', fontSize: '1em', fontWeight: 'bold', letterSpacing: '1px', zIndex: 120, pointerEvents: 'none' }}>{`Druckmass Breite: ${Math.round(frameWidthCm)} cm`}</div>
            <div style={{ position: 'absolute', left: offsetX + borderPx - 40, top: offsetY + borderPx + frameHeightPx/2, textAlign: 'center', color: '#222', fontSize: '1em', fontWeight: 600, letterSpacing: '1px', zIndex: 120, pointerEvents: 'none', transform: 'translate(-50%, -50%) rotate(-90deg)', transformOrigin: 'center', whiteSpace: 'nowrap' }}>{`Druckmass Höhe: ${Math.round(frameHeightCm)} cm`}</div>
          </>
        )}
        {showDimensions && overlayWallHeightCm != null && (
          <div style={{ position: 'absolute', left: offsetX + borderPx - 20, top: offsetY + borderPx + frameHeightPx/2, textAlign: 'center', color: '#c00', fontSize: '0.85em', zIndex: 121, pointerEvents: 'none', transform: 'translate(-50%, -50%) rotate(-90deg)', transformOrigin: 'center', whiteSpace: 'nowrap' }}>{`Wandmass: ${Math.round(overlayWallHeightCm)} cm`}</div>
        )}
        {/* Dropzone */}
        {(!imageUrl || imgError) && (
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
            onDrop={(e) => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer?.files?.[0]; if (f && onDropFile) onDropFile(f); }}
            onClick={() => { if (uploadDisabled) return; if (onPickFile) onPickFile(); }}
            style={{ position: 'absolute', left: offsetX + borderPx, top: offsetY + borderPx, width: frameWidthPx, height: frameHeightPx, zIndex: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: uploadDisabled ? 'default' : 'pointer', boxSizing: 'border-box', background: '#fff', border: isDragOver ? '2px dashed var(--zoom-accent)' : '2px dashed #ccc' }}
            title={uploadDisabled ? 'Bitte zuerst Wandmasse oder einen Code eingeben.' : 'Bild hierher ziehen oder klicken, um auszuwählen'}
          >
            <div style={{ textAlign: 'center', color: '#666', maxWidth: Math.max(280, Math.min(520, frameWidthPx - 40)) }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>{imgError ? 'Bild konnte nicht geladen werden' : 'Kein Bild ausgewählt'}</div>
              <div style={{ marginBottom: 12 }}>Bild hierher ziehen oder klicken, um eine Datei auszuwählen (JPG, TIFF, EPS, SVG oder PDF)</div>
              <button type="button" disabled={uploadDisabled} style={{ background: 'var(--ui-bg)', opacity: uploadDisabled ? 0.5 : 1, cursor: uploadDisabled ? 'not-allowed' : 'pointer' }} onClick={(e) => { e.stopPropagation(); if (uploadDisabled) return; if (onPickFile) onPickFile(); }}>Datei auswählen</button>
              {/* Code laden Hinweis + Eingabe (Ereignisse stoppen) */}
              <div
                style={{ marginTop: 14, color: '#333' }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
              >
                <span style={{ color: '#0a0' }}>
                  Wenn du bereits eine Konfiguration erstellt hast, kannst du hier den Code der Konfiguration eingeben um diese erneut aufzurufen.
                </span>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center', marginTop: 6 }}>
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
                    style={{ width: 260, height: 32, background: '#f6fff6', border: '1px solid #0a0', borderRadius: 0, padding: '6px 8px' }}
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
  // Product context (from launcher URL or loaded config)
  const [productTitle, setProductTitle] = useState(() => {
    try { return (URL_PARAMS.get('title') || '').trim(); } catch(_) { return ''; }
  });
  const [productMaterial, setProductMaterial] = useState(() => {
    try { return (URL_PARAMS.get('material') || '').trim(); } catch(_) { return ''; }
  });
  // New: raw input text states to hide defaults until user enters values
  const [inputWidthText, setInputWidthText] = useState('');
  const [inputHeightText, setInputHeightText] = useState('');
  const [imageUrl, setImageUrl] = useState(START_EMPTY ? null : INITIAL_IMAGE_URL);
  const [originalUploadUrl, setOriginalUploadUrl] = useState(null);
  const [isVectorOrPdf, setIsVectorOrPdf] = useState(false);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [uploadLocked, setUploadLocked] = useState(false);
  const [codeOnly, setCodeOnly] = useState(false); // (Rollback) Code-only Modus entfernt
  const [lockedByCode, setLockedByCode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [pricePerM2, setPricePerM2] = useState(null);
  const [calcError, setCalcError] = useState('');
  // (Rollback) Material-Katalog entfernt
  const [materials, setMaterials] = useState([]); // leer
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialsError, setMaterialsError] = useState('');
  const [selectedMaterial, setSelectedMaterial] = useState(null); // bleibt null
  // Effektive Berechnungsparameter (nur aus Parametern/Theme)
  const [effectiveCalcMode, setEffectiveCalcMode] = useState(DEFAULT_WD_CALC);
  const [effectiveBahnenbreiteCm, setEffectiveBahnenbreiteCm] = useState(BAHNENBREITE_PARAM);

  // Apply launcher gating on mount
  useEffect(() => {
    // (Rollback) Immer Upload erlaubt
    setUploadLocked(false);
  }, []);

  // (Rollback) Kein Material-Fetch

  // (Rollback) wd_calc + bahnenbreite aus Theme-Data übernehmen, falls vorhanden
  useEffect(() => {
    try {
      const ds = (typeof document !== 'undefined') ? (document.querySelector('[data-wpd]')?.dataset || {}) : {};
      const wdc = (String(ds.wdCalc || '').trim().toLowerCase());
      if (wdc === 'bahnen' || wdc === 'm2') {
        setEffectiveCalcMode(wdc);
      }
      if (!BAHNENBREITE_PARAM) {
        const rawB = String(ds.bahnenbreite || '').replace(',', '.');
        const n = Number(rawB);
        if (Number.isFinite(n) && n > 0) setEffectiveBahnenbreiteCm(n);
      }
    } catch(_) {}
  }, []);
  const [configState, setConfigState] = useState({ id: null, code: null, detailUrl: null, signedUrl: null, confirmed: false, pdfUrl: null });
  const [approved, setApproved] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCreateTip, setShowCreateTip] = useState(false);
  const [showEditTip, setShowEditTip] = useState(false);
  const [transformState, setTransformState] = useState(null);
  const [qualityMsg, setQualityMsg] = useState(null);
  const [qualityColor, setQualityColor] = useState('#666');
  const [origDims, setOrigDims] = useState(null);
  const [qualityLevel, setQualityLevel] = useState(null); // 'red' | 'orange' | 'green' | 'none'
  const [showStripLines, setShowStripLines] = useState(true);
  const [overageSide, setOverageSide] = useState('right'); // 'right' | 'left'
  const [showOverInfo, setShowOverInfo] = useState(false);

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
  const LAYOUT_BREAKPOINT = 1200; // fixer Breakpoint, verhindert Layout-Sprünge beim Umschalten
  useEffect(() => {
    const onResize = () => setWinWidth(typeof window !== 'undefined' ? window.innerWidth : 1200);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Resolve secure return URL once on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      const finalUrl = await resolveReturnUrl(RAW_RET_PARAM, RAW_SIG_PARAM);
      if (!alive) return;
      setReturnUrl(finalUrl);
      setReturnReady(true);
    })();
    return () => { alive = false; };
  }, []);

  // Area computation (uses effectiveCalcMode + effectiveBahnenbreiteCm)
  const computeArea = () => {
    const widthCm = Number(frameWidthCm) || 0;
    const heightCm = Number(frameHeightCm) || 0;
    if (effectiveCalcMode === 'bahnen' && effectiveBahnenbreiteCm && effectiveBahnenbreiteCm > 0) {
      let strips = Math.ceil(widthCm / effectiveBahnenbreiteCm);
      let printWidthCm = strips * effectiveBahnenbreiteCm;
      const imageWidthTarget = widthCm + 10; // Bildmass (Wand + 10 cm)
      let addedExtraStrip = false;
      if (printWidthCm < imageWidthTarget) {
        strips += 1;
        printWidthCm = strips * effectiveBahnenbreiteCm;
        addedExtraStrip = true;
      }
      const printHeightCm = heightCm + 10; // Druckhöhe bleibt Wand + 10
      let visibleWidthCm = imageWidthTarget; // Immer exakt Wand + 10 cm
      if (visibleWidthCm > printWidthCm) visibleWidthCm = printWidthCm; // Sicherheitsfall
      const extraWhiteWidthCm = Math.max(0, printWidthCm - visibleWidthCm); // Rest der letzten Bahn (kann < Bahnenbreite sein)
      const areaM2 = (printWidthCm / 100) * (printHeightCm / 100);
      return { mode: 'bahnen', areaM2, strips, printWidthCm, printHeightCm, addedExtraStrip, visibleWidthCm, extraWhiteWidthCm };
    }
    if (effectiveCalcMode === 'm2') {
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
  // Flag: only after both inputs provided by the user
  const widthOk = (() => { const v = String(inputWidthText || '').replace(',', '.').trim(); const n = Number(v); return Number.isFinite(n) && n > 0; })();
  const heightOk = (() => { const v = String(inputHeightText || '').replace(',', '.').trim(); const n = Number(v); return Number.isFinite(n) && n > 0; })();
  const dimsEntered = widthOk && heightOk;
  useEffect(() => { if (dimsEntered) setActionHint(''); }, [dimsEntered]);
  // Blink-Steuerung für grünen Rahmen der Masseingabe (stoppt nach erstem Fokus)
  const [dimsTouched, setDimsTouched] = useState(false);
  const [showWidthInfo, setShowWidthInfo] = React.useState(false);
  const [returnUrl, setReturnUrl] = useState(null);
  const [returnReady, setReturnReady] = useState(false);
  // Hinweis bei gesperrten Aktionen
  const [actionHint, setActionHint] = useState('');

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
  const isNarrow = winWidth < LAYOUT_BREAKPOINT;

  // Price init (fallback if no material selected)
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
    // Normalize material (if passed via URL)
    const materialRaw = (params.material || '').trim();
    const materialNorm = materialRaw ? materialRaw.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase() : '';
    return {
      wall: { widthCm, heightCm },
      print: { widthCm: printW, heightCm: printH },
      areaM2: qm,
      calc: { mode: effectiveCalcMode, bahnenbreiteCm: effectiveBahnenbreiteCm || null, strips: area.strips || null, addedExtraStrip: !!area.addedExtraStrip,
        visiblePrintWidthCm: (area && area.visibleWidthCm && !USE_CLASSIC_PREVIEW) ? Math.round(area.visibleWidthCm) : null,
        extraWhiteWidthCm: (area && area.extraWhiteWidthCm && !USE_CLASSIC_PREVIEW) ? Math.round(area.extraWhiteWidthCm) : 0,
        wallOffsetCm: (!USE_CLASSIC_PREVIEW && effectiveCalcMode === 'bahnen') ? 5 : null,
        overageSide: (!USE_CLASSIC_PREVIEW && effectiveCalcMode === 'bahnen') ? overageSide : 'right'
      },
      price: { perM2: pricePerM2, total: totalPrice, currency: 'CHF' },
      image: { url: imageUrl, originalUrl: originalUploadUrl || null },
      // Important: place current zoom/flip after transformState so they always reflect latest UI state
      transform: { ...(transformState || {}), zoom, flipH, flipV },
      context: { backend: BACKEND_URL, shop: params.shop || null, productId: params.productId || null, sku: params.sku || null },
      // Provide product info for PDF/UI
      product: {
        title: params.title || null,
        sku: params.sku || null,
        material: materialRaw ? { raw: materialRaw, normalized: materialNorm } : null
      }
    };
  };

  const [initTransformForFrame, setInitTransformForFrame] = useState(null);
  const [frameKey, setFrameKey] = useState(0);

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
      // Set core config/meta
      setConfigState({ id: data.configId, code: data.code, detailUrl: data.detailUrl, signedUrl: data.signedUrl, confirmed: true, pdfUrl: data.pdfUrl || null });
      setApproved(false);
      setLockedByCode(true);
      setUploadLocked(true);
      setMessage(`Code geladen: ${data.code}. Du kannst jetzt das Gut zum Druck bestätigen und in den Warenkorb legen.`);
      // Rehydrate dimensions (correctly treat WALL vs PRINT)
      // Prefer explicit wall dims from the stored config. If missing, derive wall from print (subtract 10 cm bleed),
      // because our app logic computes print = wall + 10 cm (height) and W+10 logic for width in m2-mode.
      const wallW = Number(data?.wall?.widthCm);
      const wallH = Number(data?.wall?.heightCm);
      let w = Number.isFinite(wallW) && wallW > 0 ? Math.round(wallW) : null;
      let h = Number.isFinite(wallH) && wallH > 0 ? Math.round(wallH) : null;
      if (w == null) {
        const pw = Number(data?.print?.widthCm);
        if (Number.isFinite(pw) && pw > 0) w = Math.max(1, Math.round(pw - 10));
      }
      if (h == null) {
        const ph = Number(data?.print?.heightCm);
        if (Number.isFinite(ph) && ph > 0) h = Math.max(1, Math.round(ph - 10));
      }
      if (!Number.isFinite(w) || w <= 0) w = frameWidthCm;
      if (!Number.isFinite(h) || h <= 0) h = frameHeightCm;
      if (Number.isFinite(w) && w > 0) setFrameWidthCm(w);
      if (Number.isFinite(h) && h > 0) setFrameHeightCm(h);
  // Prefill visible inputs from loaded config so derived info becomes visible
  if (Number.isFinite(w) && w > 0) setInputWidthText(String(w));
  if (Number.isFinite(h) && h > 0) setInputHeightText(String(h));
      // Price if available
      if (data?.price?.perM2 != null) setPricePerM2(Number(data.price.perM2));
      // Product info for UI (title/material)
      try {
        const p = data && data.product ? data.product : null;
        if (p && typeof p === 'object') {
          if (p.title && String(p.title).trim()) setProductTitle(String(p.title).trim());
          const mat = (p.material && typeof p.material === 'object' && p.material.raw) ? String(p.material.raw) : (typeof p.material === 'string' ? p.material : '');
          if (mat && String(mat).trim()) setProductMaterial(String(mat).trim());
        }
      } catch(_) {}
      // Image URL preference: preview/url/originalUrl
      let restoredImage = null;
      if (data?.image) {
        if (data.image.preview) restoredImage = `${BACKEND_URL}/${String(data.image.preview).replace(/^\//,'')}`;
        else if (data.image.url) {
          restoredImage = /^https?:/i.test(data.image.url) ? data.image.url : `${BACKEND_URL}/${String(data.image.url).replace(/^\//,'')}`;
        } else if (data.image.originalUrl) {
          restoredImage = /^https?:/i.test(data.image.originalUrl) ? data.image.originalUrl : `${BACKEND_URL}/${String(data.image.originalUrl).replace(/^\//,'')}`;
        }
      }
  if (restoredImage) setImageUrl(restoredImage);
  // store originalUploadUrl as-is (could be absolute or relative); absolute-ify when using it
  setOriginalUploadUrl(data?.image?.originalUrl || null);
  // Transform
      if (data?.transform) {
        if (data.transform.zoom != null) setZoomClamped(Number(data.transform.zoom));
        if (data.transform.flipH != null) setFlipH(!!data.transform.flipH);
        if (data.transform.flipV != null) setFlipV(!!data.transform.flipV);
        setTransformState(ts => ({
          ...(ts || {}),
          zoom: Number(data.transform.zoom || ts?.zoom || 1),
          offsetXPct: Number.isFinite(Number(data.transform.offsetXPct)) ? Number(data.transform.offsetXPct) : ts?.offsetXPct,
          offsetYPct: Number.isFinite(Number(data.transform.offsetYPct)) ? Number(data.transform.offsetYPct) : ts?.offsetYPct,
          naturalWidth: Number(data.transform.naturalWidth || ts?.naturalWidth || 0),
          naturalHeight: Number(data.transform.naturalHeight || ts?.naturalHeight || 0)
        }));
        // Pass into FrameDesigner once to set initial image position
        setInitTransformForFrame({
          offsetXPct: Number.isFinite(Number(data.transform.offsetXPct)) ? Number(data.transform.offsetXPct) : 0.5,
          offsetYPct: Number.isFinite(Number(data.transform.offsetYPct)) ? Number(data.transform.offsetYPct) : 0.5,
          zoom: Number.isFinite(Number(data.transform.zoom)) ? Number(data.transform.zoom) : undefined
        });
      } else {
        setInitTransformForFrame(null);
      }
      // Calc rehydration (Bahnen, Übermass etc.)
      try {
        const calc = data && data.calc ? data.calc : null;
        if (calc) {
          // Restore overageSide if present
          if (typeof calc.overageSide === 'string') {
            const side = String(calc.overageSide).toLowerCase() === 'left' ? 'left' : 'right';
            setOverageSide(side);
          }
          // Recompute effective mode/bahnenbreite if payload includes them
          if (typeof calc.mode === 'string' && (calc.mode === 'bahnen' || calc.mode === 'm2')) {
            setEffectiveCalcMode(calc.mode);
          }
          if (calc.bahnenbreiteCm != null && Number(calc.bahnenbreiteCm) > 0) {
            setEffectiveBahnenbreiteCm(Number(calc.bahnenbreiteCm));
          }
        }
      } catch (_) {}
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
  setMessage(`Konfiguration gespeichert. Dein Code lautet ${data.code}. Du kannst diese Konfiguration jederzeit mit dem Code im Feld "Code einfügen" im Konfigurator wieder aufrufen.`);
      try {
        // Prefer a signed URL when the backend requires signatures
        let pdfUrlSigned = data && data.signedUrl ? String(data.signedUrl) : null;
        if (!pdfUrlSigned) {
          // Fallback: request a fresh signed link from the backend
          try {
            const r = await fetch(`${BACKEND_URL}/config/${encodeURIComponent(data.configId)}/signed-link`);
            const ctR = String(r.headers.get('content-type') || '').toLowerCase();
            const j = ctR.includes('application/json') ? await r.json() : { error: (await r.text()).slice(0, 300) };
            if (r.ok && j && j.pdf) {
              pdfUrlSigned = String(j.pdf);
            }
          } catch (_) { /* ignore */ }
        }

        // Build final URL and trigger download
        let finalUrl = pdfUrlSigned || `${BACKEND_URL}/config/${encodeURIComponent(data.configId)}/pdf`;
        if (finalUrl.startsWith('/')) finalUrl = `${BACKEND_URL}${finalUrl}`;
        finalUrl = finalUrl + (finalUrl.includes('?') ? '&' : '?') + 'download=1';

        const a = document.createElement('a');
        a.href = finalUrl;
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
    // Ensure we have a config (creates one if missing)
    let id = configState.id;
    if (!id) { id = await saveConfig(); }
    if (!id) return; // saving failed

    // Build cart properties
    const props = {};
    if (effectiveCalcMode === 'bahnen' && effectiveBahnenbreiteCm) {
      props['Bahnenbreite'] = `${effectiveBahnenbreiteCm} cm`;
      if (area.strips) props['Anzahl Bahnen'] = String(area.strips);
    }
    props['Fläche'] = `${qm.toFixed(3)} m²`;
    // Machine-readable properties for scripts/automation
    props['width_cm'] = String(Math.round(Number(frameWidthCm) || 0));
    props['height_cm'] = String(Math.round(Number(frameHeightCm) || 0));
    props['area_m2'] = qm.toFixed(3);
    if (pricePerM2 != null) {
      props['Preis/m²'] = `CHF ${formatCHF(pricePerM2)}`;
      props['Gesamtpreis'] = `CHF ${formatCHF(pricePerM2 * qm)}`;
    }
    if (configState.code) props['Code'] = configState.code;
    if (configState.signedUrl || configState.detailUrl) {
      props['Konfiguration'] = configState.signedUrl || configState.detailUrl;
    } else if (id) {
      props['Konfiguration'] = `${BACKEND_URL}/config/${encodeURIComponent(id)}/pdf`;
    }
    // Quantity mode
    let quantity = 1;
    if (USE_QTY_SCALING) {
      // Mengen-Skalierung in 0.01 m² Einheiten, aufrunden
      const units = Math.max(1, Math.ceil(qm * 100));
      quantity = units;
      props['Berechnungsmodus'] = 'Mengen-Skalierung (0.01 m²)';
      props['qty_mode'] = 'area_x100';
      props['unit_m2'] = '0.01';
      // Optional: Erwarteter Gesamtpreis zur Kontrolle
      if (pricePerM2 != null) {
        const expected = Number((pricePerM2 * qm).toFixed(2));
        props['Gesamtpreis (erwartet)'] = `CHF ${formatCHF(expected)}`;
      }
    } else {
      // Fixpreis: Menge = 1, nur Anzeigezwecke (Checkout nutzt Variantenpreis)
      props['Berechnungsmodus'] = 'Fixpreis (Menge=1)';
      if (pricePerM2 != null) {
        const total = Number((pricePerM2 * qm).toFixed(2));
        props['Gesamtpreis (berechnet)'] = `CHF ${formatCHF(total)}`;
        props['price_override_chf'] = String(total);
      }
      props['qty_mode'] = 'fixed_total';
    }
    try {
      const payload = { type: 'wpd.cart.add', source: 'wpd', properties: props, quantity };
      window.parent && window.parent.postMessage(payload, '*');
      window.parent && window.parent.postMessage({ type: 'wpd.overlay.close', source: 'wpd' }, '*');
    } catch (_) {}
  };

  const handleDelete = () => { setImageUrl(null); setMessage('Bild gelöscht.'); };

  const isShopImage = (url) => {
    // Zusätzlicher Hinweis: Rohwert aus ?image-Parameter (falls vorhanden)
    let raw = null;
    try { raw = (URL_PARAMS && URL_PARAMS.get && URL_PARAMS.get('image')) ? String(URL_PARAMS.get('image')) : null; } catch(_) {}

    // Schnelle Ablehnung für blob:/data:
    if (!url) return false;
    const urlStr = String(url);
    if (/^(blob:|data:)/i.test(urlStr)) return false;

    // Hilfsfunktion für Host/Path-Prüfung
    const checkHostPath = (candidate) => {
      try {
        const u = new URL(String(candidate), window.location.origin);
        const host = (u.hostname || '').toLowerCase();
        const path = (u.pathname || '').toLowerCase();
        const curHost = (window.location.hostname || '').toLowerCase();
        const isCdnHost = host === 'cdn.shopify.com'
          || host.endsWith('.cdn.shopify.com')
          || host.endsWith('shopifycdn.com')
          || host.endsWith('shopifycdn.net')
          || host.endsWith('shopifycloud.com')
          || host === 'files.shopifycdn.net'
          || host.endsWith('.shopify.com');
        const isMyShopify = host.endsWith('.myshopify.com');
        const isStoreCdnPath = path.startsWith('/cdn/shop/') || path.includes('/s/files/');
        const isCurrentStoreCdn = host === curHost && isStoreCdnPath;
        // Erweiterung: Auch Custom-Domains eines Shops (z. B. aahoma.ch) liefern Bilder unter
        // /cdn/shop/ oder /s/files/. Diese sollen ebenfalls als Shop-Bilder gelten – unabhängig
        // vom Hostnamen – solange der Pfad dem Shopify-CDN-Schema entspricht.
        const isCustomDomainCdn = isStoreCdnPath && host !== curHost;
        return isCdnHost || (isMyShopify && isStoreCdnPath) || isCurrentStoreCdn || isCustomDomainCdn;
      } catch(_) {
        const s = String(candidate || '').toLowerCase();
        return s.includes('cdn.shopify.com') || s.includes('/cdn/shop/') || s.includes('/s/files/') || s.includes('myshopify.com') || s.includes('shopifycdn');
      }
    };

    // 1) Direkte Prüfung der effektiven Bild-URL
    if (checkHostPath(urlStr)) return true;
    // 2) Fallback: Rohwert aus ?image (kann absolut oder pfadbasiert sein)
    if (raw && checkHostPath(raw)) return true;
    // 3) Letzter Versuch: Fremdhost mit "shopify" im Namen
    try {
      const u2 = new URL(urlStr, window.location.origin);
      const host2 = (u2.hostname || '').toLowerCase();
      if (host2 && host2 !== (window.location.hostname || '').toLowerCase() && host2.includes('shopify')) return true;
    } catch(_) {}
    return false;
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
    const showQuality = !!qualityMsg && !lockedByCode; // Unterdrücke Qualitätsanzeige im Read-only-Modus
    if (!message && !showQuality) return null;
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
        {showQuality && (
          <div style={{ marginTop: 8, padding: '8px 10px', border: '1px dashed #ddd', color: qualityColor }}>
            {qualityMsg}
          </div>
        )}
        {/* Return to shop button (secure ret handling) */}
        {returnReady && returnUrl && (
          <div style={{ marginTop: 10 }}>
            <button type="button" onClick={() => { try { window.location.href = returnUrl; } catch(_) {} }}>
              Zurück zum Shop
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: '8px 12px' }}>
      <style>{`button, input, select { border-radius: 0 !important; }
@keyframes pulseGreen { 0% { box-shadow: 0 0 0 0 rgba(0,160,0,0.55); } 50% { box-shadow: 0 0 0 6px rgba(0,160,0,0); } 100% { box-shadow: 0 0 0 0 rgba(0,160,0,0.55); } }`}</style>
      {/* Kompakter Hinweis: Nur Material anzeigen, um den doppelt sichtbaren Titel (Overlay-Header + App) zu vermeiden */}
      {productMaterial && (
        <div style={{ margin: '4px 0 10px', minHeight: 24 }}>
          <div style={{ fontSize: '0.9em', color: '#555' }}>Material: {productMaterial}</div>
        </div>
      )}
      {returnReady && returnUrl && (
        <div style={{ position: 'fixed', top: 8, right: 8, zIndex: 1000 }}>
          <button type="button" onClick={() => { try { window.location.href = returnUrl; } catch(_) {} }} style={{ padding: '6px 12px' }}>Zurück</button>
        </div>
      )}
      {/* Aktuelle Konfigurations-ID anzeigen – ausgeblendet */}
      {false && (
        <div style={{ background: '#ffe', color: '#333', padding: '6px 12px', marginBottom: 8, border: '1px solid #ccc', borderRadius: 4 }}>
          {configState && configState.id
            ? <>Aktive Konfiguration: <b>{configState.id}</b></>
            : <span style={{ color: 'red' }}>Keine Konfiguration aktiv! Bitte zuerst anlegen oder laden.</span>}
        </div>
      )}
      {/* Main layout */}
  <div style={{ display: 'flex', flexDirection: isNarrow ? 'column' : 'row', alignItems: isNarrow ? 'center' : 'flex-start', justifyContent: 'center', gap: isNarrow ? 8 : 12 }}>
        <div style={{ flex: '0 1 auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <FrameDesigner
            key={frameKey}
            imageUrl={imageUrl}
            frameWidthCm={Math.round(area.printWidthCm || frameWidthCm)}
            frameHeightCm={Math.round(area.printHeightCm || frameHeightCm)}
            zoom={zoom}
            flipH={flipH}
            flipV={flipV}
            onDropFile={(file) => uploadFile(file)}
            onPickFile={() => fileInputRef.current && fileInputRef.current.click()}
            working={working}
            uploadDisabled={uploadLocked || codeOnly || lockedByCode || !dimsEntered}
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
            readonly={lockedByCode || codeOnly}
            initTransform={initTransformForFrame}
            displayWidthCm={!USE_CLASSIC_PREVIEW && area.mode === 'bahnen' ? (area.visibleWidthCm ?? null) : null}
            extraWhiteWidthCm={!USE_CLASSIC_PREVIEW && area.mode === 'bahnen' ? (area.extraWhiteWidthCm ?? 0) : 0}
            showStripLines={!USE_CLASSIC_PREVIEW && area.mode === 'bahnen' ? showStripLines : false}
            stripWidthCm={!USE_CLASSIC_PREVIEW && area.mode === 'bahnen' ? (effectiveBahnenbreiteCm || null) : null}
            stripsCount={!USE_CLASSIC_PREVIEW && area.mode === 'bahnen' ? (area.strips || null) : null}
            wallOffsetCm={!USE_CLASSIC_PREVIEW && area.mode === 'bahnen' ? 5 : null}
            overageSide={!USE_CLASSIC_PREVIEW && area.mode === 'bahnen' ? overageSide : 'right'}
            showDimensions={dimsEntered}
            fixedContainerMinWidthPx={1000}
            fixedContainerMinHeightPx={700}
          />
          {/* Hinweis und Zoom/Spiegeln unter dem Frame */}
            <div style={{ width: containerWidthAligned, margin: '4px auto 0', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap', minHeight: 150 }}>
            <div style={{ flexBasis: '100%', color: '#666', marginBottom: 4, textAlign: 'center', minHeight: 22 }}>
              {renderMessage()}
              {!dimsEntered ? (
                <span style={{ color: '#c00', fontWeight: 600 }}>Bitte zuerst Wandmasse oder einen Code eingeben.</span>
              ) : 'Ziehe das Bild, um den Ausschnitt festzulegen.'}
              {actionHint && (
                <div style={{ marginTop: 6, color: '#c00', fontSize: '0.8em' }}>{actionHint}</div>
              )}
            </div>
            <label htmlFor="zoom-slider" style={{ fontWeight: 'bold' }}>Zoom:</label>
            <div style={{ position: 'relative', width: 250, paddingTop: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                title="Zoom zurücksetzen"
                onClick={() => { if (!dimsEntered) { setActionHint('Bitte zuerst Wandmasse oder einen Code eingeben.'); return; } if (!lockedByCode) setZoomClamped(1); }}
                onMouseEnter={() => setShowZoomTip(true)}
                onMouseLeave={() => setShowZoomTip(false)}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, color: 'var(--zoom-accent)', cursor: (!dimsEntered || lockedByCode) ? 'not-allowed' : 'pointer', userSelect: 'none', opacity: (!dimsEntered || lockedByCode) ? 0.4 : 1, background: '#f6fff6', border: '1px solid #cfe9cf', borderRadius: 0, padding: 0 }}
              >
                <IconReset size={24} />
              </button>
              <input
                id="zoom-slider"
                type="range"
                min={minZoom}
                max={maxZoom}
                step={0.01}
                value={zoom}
                onChange={e => { if (!dimsEntered) { setActionHint('Bitte zuerst Wandmasse oder einen Code eingeben.'); return; } setZoomClamped(Number(e.target.value)); }}
                style={{ flex: 1, verticalAlign: 'middle' }}
                disabled={lockedByCode || codeOnly || !dimsEntered}
                ref={sliderRef}
              />
            </div>
            <span style={{ minWidth: 44, textAlign: 'right' }}>{Math.round(zoom * 100)}%</span>
            {effectiveCalcMode === 'bahnen' && effectiveBahnenbreiteCm && !USE_CLASSIC_PREVIEW && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button type="button" title="Bahnen ein-/ausblenden" onClick={() => { if (!dimsEntered) { setActionHint('Bitte zuerst Wandmasse oder einen Code eingeben.'); return; } setShowStripLines(v => !v); }} style={{ width: 54, height: 54, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#f6fff6', border: '1px solid #cfe9cf', borderRadius: 0, opacity: (!dimsEntered) ? 0.4 : 1, cursor: (!dimsEntered) ? 'not-allowed' : 'pointer' }}><IconStripes size={29} /></button>
                <button type="button" title="Übermass links/rechts" onClick={() => { if (!dimsEntered) { setActionHint('Bitte zuerst Wandmasse oder einen Code eingeben.'); return; } if (!(lockedByCode || codeOnly)) setOverageSide(s => s === 'right' ? 'left' : 'right'); }} style={{ width: 54, height: 54, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#f6fff6', border: '1px solid #cfe9cf', borderRadius: 0, opacity: (!dimsEntered || lockedByCode || codeOnly) ? 0.4 : 1, cursor: (!dimsEntered || lockedByCode || codeOnly) ? 'not-allowed' : 'pointer' }}><IconOverage size={29} /></button>
              </div>
            )}
            {working && (<span style={{ marginLeft: 12, color: '#8C6A00' }}>Bitte warten…</span>)}
            {/* Zweite Zeile: Spiegeln / Löschen (zentriert) */}
            <div style={{ display: 'flex', gap: 8, marginTop: 0, alignItems: 'center' }}>
              <button onClick={() => { if (!dimsEntered) { setActionHint('Bitte zuerst Wandmasse oder einen Code eingeben.'); return; } if (!(lockedByCode || codeOnly)) setFlipH(f => !f); }} title="Horizontal spiegeln" style={{ width: 54, height: 54, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#f6fff6', border: '1px solid #cfe9cf', borderRadius: 0, opacity: (!dimsEntered || lockedByCode || codeOnly) ? 0.4 : 1, cursor: (!dimsEntered || lockedByCode || codeOnly) ? 'not-allowed' : 'pointer' }}><IconFlipH size={29} /></button>
              <button onClick={() => { if (!dimsEntered) { setActionHint('Bitte zuerst Wandmasse oder einen Code eingeben.'); return; } if (!(lockedByCode || codeOnly)) setFlipV(f => !f); }} title="Vertikal spiegeln" style={{ width: 54, height: 54, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#f6fff6', border: '1px solid #cfe9cf', borderRadius: 0, opacity: (!dimsEntered || lockedByCode || codeOnly) ? 0.4 : 1, cursor: (!dimsEntered || lockedByCode || codeOnly) ? 'not-allowed' : 'pointer' }}><IconFlipV size={29} /></button>
              {imageUrl && !uploadLocked && !codeOnly && (
                <button onClick={() => { if (!dimsEntered) { setActionHint('Bitte zuerst Wandmasse oder einen Code eingeben.'); return; } if (!(lockedByCode || codeOnly)) handleDelete(); }} title="Bild löschen" style={{ width: 54, height: 54, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#f6fff6', border: '1px solid #cfe9cf', borderRadius: 0, color: '#c00', fontWeight: 600, opacity: (!dimsEntered || lockedByCode || codeOnly) ? 0.4 : 1, cursor: (!dimsEntered || lockedByCode || codeOnly) ? 'not-allowed' : 'pointer' }}><IconTrash size={29} /></button>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ flex: isNarrow ? '0 1 auto' : '0 0 320px', marginLeft: 0, background: '#F4F2EC', borderRadius: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', padding: 24, alignSelf: isNarrow ? 'center' : 'flex-start', marginTop: isNarrow ? 8 : 0 }}>
          {/* hidden file input for dropzone/button */}
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/tiff,image/svg+xml,application/pdf,application/postscript,application/eps,application/x-eps" onChange={handleFileChange} style={{ display: 'none' }} />

          {/* Material selection (launcher-controlled) */}
          {SHOW_MATERIAL_FLAG && (
            <div style={{ marginBottom: 24, padding: '18px 12px', background: '#fff', borderRadius: 0, border: '1px solid #eee', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
              <h3 style={{ margin: '0 0 6px 0', fontSize: '1em', fontWeight: 'bold' }}>Material</h3>
              {materialsLoading && <div>Materialien werden geladen…</div>}
              {materialsError && <div style={{ color:'#c00' }}>{materialsError}</div>}
              {!materialsLoading && !materialsError && (
                <select value={selectedMaterial?.handle || ''} onChange={(e) => {
                  const h = e.target.value;
                  const m = materials.find(x => String(x.handle||'') === h) || null;
                  setSelectedMaterial(m);
                }} style={{ width: '100%' }}>
                  <option value="">Bitte Material wählen…</option>
                  {materials.map((m) => (
                    <option key={m.handle} value={m.handle}>{m.title || m.handle}</option>
                  ))}
                </select>
              )}
              {selectedMaterial && (
                <div style={{ marginTop: 8, color:'#333', fontSize:'0.9em' }}>
                  <div><b>Breite je Bahn:</b> {selectedMaterial.bahnenbreiteInCm ? `${selectedMaterial.bahnenbreiteInCm} cm` : '—'}</div>
                  <div><b>Berechnungsmodus:</b> {(selectedMaterial.wdCalc || '').toUpperCase()}</div>
                  {selectedMaterial.price != null && <div><b>Preis/m²:</b> CHF {formatCHF(selectedMaterial.price)}</div>}
                </div>
              )}
            </div>
          )}

          {/* Code-Eingabe (Duplikat ausserhalb der Dropzone) */}
          <div style={{ marginBottom: 24, padding: '18px 12px', background: '#fff', borderRadius: 0, border: '1px solid #eee', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '1em', fontWeight: 'bold' }}>Konfigurations-Code</h3>
            <div style={{ color: '#0a0', fontSize: '0.85em', marginBottom: 8 }}>
              Hast du bereits eine Konfiguration erstellt? Gib den Code hier ein, um sie erneut zu laden.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder="Code einfügen"
                value={codeInput || ''}
                onChange={e => setCodeInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { const v = String(codeInput || '').trim(); if (v) loadByCode(v); } }}
                style={{ flex: 1, height: 32, background: '#f6fff6', border: '1px solid #0a0', borderRadius: 0, padding: '6px 8px' }}
              />
              <button type="button" onClick={() => { const v = String(codeInput || '').trim(); if (v) loadByCode(v); }} style={{ background: 'var(--ui-bg)', height: 32 }}>Laden</button>
            </div>
          </div>

      {/* Size selection card */}
          <div style={{ marginBottom: 24, padding: '18px 12px', background: '#fff', borderRadius: 0, border: '1px solid #eee', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '1em', fontWeight: 'bold' }}>Wandmasse eingeben</h3>
            {effectiveCalcMode === 'bahnen' && (
              <div style={{ margin: '0 0 12px 0', color: '#c00', fontSize: '0.85em' }}>
                Gib das exakte Wandmass hier ein. Wir berechnen die benötigten Bahnen und geben 10 cm Toleranz in der Höhe hinzu.
              </div>
            )}
            {effectiveCalcMode === 'm2' && (
              <div style={{ margin: '0 0 12px 0', color: '#c00', fontSize: '0.85em' }}>
                Gib das exakte Wandmass hier ein. Wir geben 10 cm Toleranz in Breite und Höhe hinzu.
              </div>
            )}
            {/* Default handled by EFFECTIVE_WD_CALC */}
            <div style={{ display: 'grid', gridTemplateColumns: '130px 130px', columnGap: 36, rowGap: 4, padding: 8, border: '0 none', outline: (dimsTouched ? '2px solid #0a0' : 'none'), animation: (!dimsTouched ? 'pulseGreen 2.5s ease-in-out infinite' : 'none') }}>
              <span style={{ color: '#0a0', fontWeight: 400, fontSize: 13 }}>Wandbreite (cm)</span>
              <span style={{ color: '#0a0', fontWeight: 400, fontSize: 13 }}>Wandhöhe (cm)</span>
              <input
                type="number"
                value={inputWidthText}
                min={10}
                max={1000}
                placeholder="Breite in cm"
                onChange={e => {
                  const raw = e.target.value;
                  setInputWidthText(raw);
                  const n = Number(String(raw).replace(',', '.'));
                  if (Number.isFinite(n) && n > 0) setFrameWidthCm(n);
                }}
                onFocus={() => { if (!dimsTouched) setDimsTouched(true); }}
                disabled={lockedByCode || codeOnly}
                style={{ background: '#f6fff6', border: '1px solid #0a0', padding: '4px 6px', height: 30, width: 100, textAlign: 'right', fontSize: 13 }}
              />
              <input
                type="number"
                value={inputHeightText}
                min={10}
                max={1000}
                placeholder="Höhe in cm"
                onChange={e => {
                  const raw = e.target.value;
                  setInputHeightText(raw);
                  const n = Number(String(raw).replace(',', '.'));
                  if (Number.isFinite(n) && n > 0) setFrameHeightCm(n);
                }}
                onFocus={() => { if (!dimsTouched) setDimsTouched(true); }}
                disabled={lockedByCode || codeOnly}
                style={{ background: '#f6fff6', border: '1px solid #0a0', padding: '4px 6px', height: 30, width: 100, textAlign: 'right', fontSize: 13 }}
              />
            </div>
            {/* Compact calculation table: Platz reservieren, bis Werte sichtbar */}
            {(effectiveCalcMode === 'bahnen' && effectiveBahnenbreiteCm) && (
              <div style={{ marginTop: 8, color: '#333', visibility: dimsEntered ? 'visible' : 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85em' }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee', width: '50%' }}>Bahnenbreite</td>
                      <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee' }}>{effectiveBahnenbreiteCm} cm</td>
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
            {effectiveCalcMode === 'm2' && (
              <div style={{ marginTop: 8, color: '#333', visibility: dimsEntered ? 'visible' : 'hidden' }}>
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
                    <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee' }}><b>{dimsEntered ? `${qm.toFixed(3)} m²` : '–'}</b></td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee' }}>Preis pro m²</td>
                    <td style={{ padding: '4px 6px', borderBottom: '1px solid #eee' }}>
                      {!dimsEntered ? (
                        <span style={{ color: '#999' }}>–</span>
                      ) : qm < 3 ? (
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
            {dimsEntered && qm >= 3 && pricePerM2 !== null && !calcError && (
              <div style={{ marginTop: 8, fontSize: '1.1em', fontWeight: 'bold', color: 'var(--zoom-accent)' }}>Gesamtpreis: CHF {formatCHF(pricePerM2 * qm)}</div>
            )}
            {lockedByCode && (
              null
            )}
            {/* Aktionen */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
              {/* Edit again button (only when locked by code) */}
              {lockedByCode && (
                <>
                  <div style={{ position: 'relative' }}>
                    <button
                      type="button"
                      onClick={() => {
                        // Wechsel in den Bearbeitungsmodus
                        setLockedByCode(false);
                        setUploadLocked(false);
                        setMessage('Bearbeitung aktiviert. Du kannst die Masse, den Ausschnitt und das Bild wieder ändern.');
                        setApproved(false);
                        // GzD-Button zurücksetzen (Code/Links leeren)
                        setConfigState((cs) => ({ ...(cs || {}), id: null, code: null, pdfUrl: null, signedUrl: null, detailUrl: null }));
                        // Beim Weiterbearbeiten auf das Originalbild wechseln, damit die Qualitätsprüfung korrekt ist
                        if (originalUploadUrl) {
                          const abs = /^https?:/i.test(originalUploadUrl)
                            ? originalUploadUrl
                            : `${BACKEND_URL}/${String(originalUploadUrl).replace(/^\//, '')}`;
                          setImageUrl(abs);
                        }
                        // Gespeicherten Zoom übernehmen, falls vorhanden
                        const targetZoom = Number.isFinite(Number(transformState?.zoom)) ? Number(transformState.zoom) : zoom;
                        if (targetZoom && targetZoom !== zoom) setZoomClamped(targetZoom);
                        // Gespeicherte Offsets als initTransform erneut anwenden und Komponente remounten
                        if (Number.isFinite(Number(transformState?.offsetXPct)) && Number.isFinite(Number(transformState?.offsetYPct))) {
                          setInitTransformForFrame({ offsetXPct: Number(transformState.offsetXPct), offsetYPct: Number(transformState.offsetYPct), zoom: targetZoom });
                          setFrameKey((k) => k + 1); // remount to reset init application
                        }
                      }}
                      onMouseEnter={() => setShowEditTip(true)}
                      onMouseLeave={() => setShowEditTip(false)}
                      style={{ display: 'block', width: '100%', margin: '0 auto' }}
                    >
                      Konfiguration weiter bearbeiten
                    </button>
                    {showEditTip && (
                      <div style={{ position: 'absolute', zIndex: 10, top: '120%', right: 0, minWidth: 260, background: '#fffef6', border: '1px solid #eee6b3', color: '#5a5700', padding: '8px 10px', borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', textAlign: 'right', fontSize: '0.85em' }}>
                        Du kannst die Konfiguration weiter bearbeiten und anschiessend ein neues GzD erstellen. Durch die erneute Eingabe des Codes kannst du aber auch jederzeit zur aktuellen Konfiguration zurückkehren.
                      </div>
                    )}
                  </div>
                  <div style={{ marginTop: 8, color: '#0a0', fontWeight: 'bold' }}>
                    Bestätige das Gut zum Druck und lege es in den Warenkorb.
                  </div>
                </>
              )}
              {/* Gut zum Druck erstellen with Tooltip */}
              {!lockedByCode && !codeOnly && (
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    onClick={saveConfig}
                    disabled={saving || qualityLevel === 'red' || qm < 3 || !dimsEntered}
                    onMouseEnter={() => setShowCreateTip(true)}
                    onMouseLeave={() => setShowCreateTip(false)}
                    title={
                      !dimsEntered
                        ? 'Bitte Wandbreite und Wandhöhe eingeben.'
                        : qm < 3
                        ? 'Die Mindestgrösse für eine Bestellung beträgt 3m².'
                        : qualityLevel === 'red'
                          ? 'Die Qualität deines Bildes ist für den Druck in dieser Grösse ungenügend'
                          : undefined
                    }
                    style={{ display: 'block', width: '100%', margin: '0 auto', background: '#f6fff6', border: '1px solid #cfe9cf', cursor: (saving || qualityLevel==='red' || qm < 3 || !dimsEntered) ? 'not-allowed' : 'pointer', opacity: (saving || qualityLevel==='red' || qm < 3 || !dimsEntered) ? 0.7 : 1 }}
                  >
                    {saving ? 'Erstelle…' : (configState.code ? `Gut zum Druck erstellt (${configState.code})` : 'Gut zum Druck erstellen')}
                  </button>
                  {(!configState.code && showCreateTip) && (
                    <div style={{ position: 'absolute', zIndex: 10, top: '120%', right: 0, minWidth: 260, background: '#f6fff6', border: '1px solid #cfe9cf', color: '#0a0', padding: '8px 10px', borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', textAlign: 'right', fontSize: '0.85em' }}>
                      Nach dem Erstellen erhältst du einen Code. Mit diesem Code kannst du die Konfiguration im Feld „Code einfügen“ wieder laden.
                    </div>
                  )}
                </div>
              )}
              {/* Bestätigung (Checkbox) nur anzeigen, wenn ein Code vorhanden ist */}
              {configState.code && !codeOnly && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} />
                  <span>Ich bestätige das Gut zum Druck ({configState.code})</span>
                </label>
              )}
              {/* In den Warenkorb */}
              {!codeOnly && (
                <button type="button" onClick={(e) => { if (!dimsEntered) { setActionHint('Bitte zuerst Wandmasse oder einen Code eingeben.'); return; } if (!approved) { setActionHint('Bitte Gut zum Druck bestätigen.'); return; } addToCart(); }} disabled={!approved || !dimsEntered} style={{ display: 'block', width: '100%', margin: '0 auto', opacity: (!dimsEntered || !approved) ? 0.5 : 1, cursor: (!dimsEntered || !approved) ? 'not-allowed' : 'pointer' }}>
                  In den Warenkorb
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root'));
const PAGE = (typeof window !== 'undefined') ? (new URLSearchParams(window.location.search).get('page') || '') : '';
if (PAGE === 'import') {
  root.render(<ImportImages />);
} else {
  root.render(<App />);
}
