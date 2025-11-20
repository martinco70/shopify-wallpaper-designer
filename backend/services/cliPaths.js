const { spawnSync } = require('child_process');

function cmdExists(cmd, args = ['-version']) {
  try {
    const r = spawnSync(cmd, args, { stdio: 'ignore' });
    return r.status === 0 || r.status === null || typeof r.status === 'number';
  } catch (_) {
    return false;
  }
}

function resolveMagickCmd() {
  if (process.platform === 'win32') return 'magick';
  // Prefer magick if present (IM7), else fallback to convert (IM6)
  if (cmdExists('magick')) return 'magick';
  if (cmdExists('convert')) return 'convert';
  return 'magick';
}

function resolveGsCmd() {
  if (process.platform === 'win32') return 'gswin64c';
  return 'gs';
}

module.exports = {
  magickCmd: resolveMagickCmd(),
  ghostscriptCmd: resolveGsCmd(),
};
