// Lightweight preview model builder
// Input: config object ({ wall:{widthCm,heightCm}, print:{widthCm,heightCm}, image:{url} })
// Output: { stage:{width,height}, aspect, imageUrl }

function buildPreviewModel(cfg) {
  cfg = cfg || {};
  const wall = cfg.print || cfg.wall || {};
  const w = Number(wall.widthCm || 0);
  const h = Number(wall.heightCm || 0);
  let aspect = 16/9;
  if (w > 0 && h > 0) aspect = w / h;
  // Base max box
  const MAX_W = 1000;
  const MAX_H = 700;
  let stageW = MAX_W;
  let stageH = Math.round(stageW / aspect);
  if (stageH > MAX_H) { stageH = MAX_H; stageW = Math.round(stageH * aspect); }
  return {
    aspect,
    stage: { width: stageW, height: stageH },
    imageUrl: cfg?.image?.url || ''
  };
}

module.exports = { buildPreviewModel };
