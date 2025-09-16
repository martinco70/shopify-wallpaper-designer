const path = require('path');
const fs = require('fs');
const sharp = (()=>{ try { return require('sharp'); } catch { return null; } })();
const { execFile } = require('child_process');

const magickCmd = process.platform === 'win32' ? 'magick' : 'magick';

async function generatePreview({ inputPath, mime, previewsDir }) {
  const baseName = path.basename(inputPath).replace(/\.[^.]+$/, '');
  const previewName = `${baseName}-preview.jpg`;
  const previewPath = path.join(previewsDir, previewName);
  const generationTimeoutMs = 60_000;
  let originalWidthPx = null, originalHeightPx = null;
  let preview = null;

  const isRasterOrSvg = ['image/jpeg', 'image/tiff', 'image/svg+xml'].includes(mime);
  if (isRasterOrSvg && sharp) {
    try {
      const meta = await sharp(inputPath).metadata();
      originalWidthPx = meta.width || null;
      originalHeightPx = meta.height || null;
    } catch {}
    try {
      await Promise.race([
        sharp(inputPath)
          .rotate()
          .jpeg({ quality: 85 })
          .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
          .toFile(previewPath),
        new Promise((_, reject) => setTimeout(() => reject(new Error('preview_timeout')), generationTimeoutMs))
      ]);
      preview = previewPath;
    } catch (e) {
      if (mime === 'image/tiff') throw e; // tiff braucht preview
    }
  } else if ([
    'application/pdf',
    'application/postscript',
    'application/eps',
    'application/x-eps'
  ].includes(mime)) {
    // identify first page size
    let origWidth = null, origHeight = null;
    try {
      await new Promise((resolve, reject) => {
        const args = [ (process.platform === 'win32' ? 'identify' : 'identify'), '-format', '%w %h', `${inputPath}[0]` ];
        const child = execFile(args[0], args.slice(1), { windowsHide: true }, (err, stdout) => {
          if (err) return reject(err);
            const parts = String(stdout).trim().split(/\s+/);
            if (parts.length === 2) { origWidth = parseInt(parts[0], 10); origHeight = parseInt(parts[1], 10); }
            resolve();
        });
        setTimeout(() => { try { child.kill('SIGKILL'); } catch {} reject(new Error('identify_timeout')); }, generationTimeoutMs);
      });
    } catch {}
    try {
      let resizeArg = '';
      if (origWidth && origHeight) {
        const maxDim = 3000;
        if (origWidth > maxDim || origHeight > maxDim) {
          resizeArg = (origWidth >= origHeight) ? `${maxDim}x` : `x${maxDim}`;
        }
      }
      await new Promise((resolve, reject) => {
        const args = (process.platform === 'win32')
          ? ['convert','-density','150',`${inputPath}[0]`,'-quality','85', ...(resizeArg ? ['-resize', resizeArg] : []), previewPath]
          : ['-density','150',`${inputPath}[0]`,'-quality','85', ...(resizeArg ? ['-resize', resizeArg] : []), previewPath];
        const child = execFile(magickCmd, args, { windowsHide: true }, (err) => {
          if (err) return reject(err); resolve();
        });
        const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} reject(new Error('preview_timeout')); }, generationTimeoutMs);
        child.on('exit', () => clearTimeout(t));
      });
      if (fs.existsSync(previewPath)) {
        preview = previewPath;
        originalWidthPx = origWidth; originalHeightPx = origHeight;
      }
    } catch (e) {
      const msg = String(e && e.message || '');
      if (msg.includes('preview_timeout')) throw e;
      // fallback: no preview
    }
  }
  return { previewPath: preview, originalWidthPx, originalHeightPx };
}

module.exports = { generatePreview };
