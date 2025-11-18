const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { parse } = require('csv-parse');
const XLSX = require('xlsx');
const Shopify = require('shopify-api-node');

function normalizeShopName(input) {
  if (!input) return '';
  let s = String(input).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/\.myshopify\.com.*/, '');
  s = s.replace(/\/$/, '');
  return s;
}

function normalizeHandle(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  try {
    if (/^https?:\/\//.test(s)) {
      const u = new URL(s);
      const parts = u.pathname.split('/').filter(Boolean);
      const idx = parts.lastIndexOf('products');
      const seg = idx >= 0 ? parts[idx + 1] : parts[parts.length - 1];
      s = (seg || '').split('?')[0].split('#')[0];
    }
  } catch {}
  s = s.replace(/^.*\/products\//, '');
  s = s.split('?')[0].split('#')[0];
  s = s.replace(/^\//, '');
  return s;
}

function getShopifyClient({ shop, token }) {
  const shopName = normalizeShopName(shop);
  return new Shopify({ shopName, accessToken: token });
}

// Ensure a metafield definition exists so the field is visible in Admin UI
async function ensureWdPictureDefinition(client) {
  // Try fetch existing definition
  try {
    const q = `query($ownerType: MetafieldOwnerType!, $namespace: String!, $key: String!){
      metafieldDefinitionByOwnerTypeAndKey(ownerType:$ownerType, namespace:$namespace, key:$key){ id name type{ name } pinned }
    }`;
    const raw = await client.graphql(q, { ownerType: 'PRODUCT', namespace: 'custom', key: 'wd-picture' });
    let obj; try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = raw; }
    const def = obj?.data?.metafieldDefinitionByOwnerTypeAndKey || null;
    if (def && def.id) {
      const t = def?.type?.name || '';
      if (String(t).toLowerCase() === 'file_reference') return { ok: true, id: def.id };
      // Wrong type found: attempt delete and recreate as file_reference
      try {
        const delRaw = await client.graphql(`mutation($id:ID!){ metafieldDefinitionDelete(id:$id){ deletedDefinitionId userErrors{ field message } } }`, { id: def.id });
        let del; try { del = typeof delRaw === 'string' ? JSON.parse(delRaw) : delRaw; } catch { del = delRaw; }
        const errs = del?.data?.metafieldDefinitionDelete?.userErrors || [];
        if (errs.length) {
          const msg = errs.map(e => e?.message).join('; ');
          // If cannot delete, we cannot proceed; return with error so caller can surface diagnostics
          return { ok: false, error: `existing_definition_wrong_type:${t} delete_failed:${msg}` };
        }
      } catch (e) {
        return { ok: false, error: `existing_definition_wrong_type:${def?.type?.name || ''} delete_error:${e?.message || String(e)}` };
      }
      // fallthrough to create anew below
    }
  } catch (_) {}
  // Create when missing (best effort)
  try {
    const m = `mutation($definition: MetafieldDefinitionInput!){
      metafieldDefinitionCreate(definition:$definition){ metafieldDefinition{ id name type{ name } pinned definitionsDuplicate } userErrors{ field message } }
    }`;
    const vars = { definition: {
      name: 'WD Picture',
      namespace: 'custom',
      key: 'wd-picture',
      ownerType: 'PRODUCT',
      type: 'file_reference',
      visibleToStorefront: true,
      pinned: true,
      validationStatus: 'ENABLED',
      // Validate that the file reference is an image (MediaImage or image File)
      validations: [
        { name: 'file_type', value: 'image' }
      ]
    } };
    const raw = await client.graphql(m, vars);
    let obj; try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = raw; }
    const errs = obj?.data?.metafieldDefinitionCreate?.userErrors || [];
    if (errs.length) {
      const msg = errs.map(e => e?.message).join('; ');
      if (!/already exists/i.test(msg)) return { ok: false, error: msg };
    }
    const node = obj?.data?.metafieldDefinitionCreate?.metafieldDefinition || null;
    const id = node?.id || null;
    return { ok: Boolean(id), id, pinned: node?.pinned || false, type: node?.type?.name || 'file_reference' };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function downloadToBuffer(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download_failed:${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function rasterToJpegPng(buf, prefer = 'jpeg') {
  const s = sharp(buf);
  // Performance-Policy: Lange Kante stets auf max. 3000px begrenzen (ohne Upscaling)
  s.resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: true });
  if (prefer === 'png') return await s.png({ compressionLevel: 9 }).toBuffer();
  return await s.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
}

function parseCsv(buffer) {
  return new Promise((resolve, reject) => {
    parse(buffer, { columns: true, skip_empty_lines: true, trim: true }, (err, out) => {
      if (err) return reject(err);
      resolve(out);
    });
  });
}

function parseXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

function productNumericIdFromGid(gid) {
  const m = String(gid || '').match(/Product\/(\d+)/);
  return m ? Number(m[1]) : null;
}

async function ensureProductIdByVariantSku(client, sku) {
  const s = String(sku || '').trim();
  if (!s) throw new Error('invalid_sku');
  // 0) GraphQL variant search (exact SKU) – more reliable than REST filter if supported
  try {
    const gql = `query($q:String!){ productVariants(first:1, query:$q){ edges{ node{ id sku product{ id } } } } }`;
    const raw = await client.graphql(gql, { q: `sku:${s}` });
    let obj; try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = raw; }
    const edges = obj?.data?.productVariants?.edges || [];
    if (edges.length) {
      const node = edges[0].node;
      const pid = productNumericIdFromGid(node?.product?.id);
      if (pid) return pid;
    }
  } catch (_) {}
  // 0b) GraphQL products search by variants.sku
  try {
    const raw = await client.graphql(
      `query($q:String!){ products(first:10, query:$q){ edges{ node{ id handle title variants(first:50){ edges{ node{ id sku } } } } } } }`,
      { q: `variants.sku:${s}` }
    );
    let obj; try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = raw; }
    const edges = obj?.data?.products?.edges || [];
    for (const e of edges) {
      const n = e?.node; if (!n) continue;
      const has = (n.variants?.edges || []).some(ed => String(ed?.node?.sku || '').trim() === s);
      if (has) {
        const pid = productNumericIdFromGid(n.id);
        if (pid) return pid;
      }
    }
  } catch (_) {}
  // 1) Fast path: REST variant lookup by SKU
  try {
    // Note: REST productVariant.list does not officially support filtering by SKU.
    // Some SDKs ignore unknown params; keep this as a best-effort fast path.
    const variants = await client.productVariant.list({ sku: s, limit: 1 });
    if (Array.isArray(variants) && variants.length) {
      const v = variants[0];
      if (v && v.product_id) return Number(v.product_id);
    }
  } catch (_) {}
  // 2) Fallback: REST product scan (pagination)
  try {
    const limit = 250; let since_id = undefined; let pages = 0;
    const candidates = new Map(); // product_id -> count of matching variants (fuzzy)
    while (true) {
      const params = { limit, published_status: 'any', status: 'any' };
      if (since_id) params.since_id = since_id;
      const products = await client.product.list(params);
      if (!Array.isArray(products) || products.length === 0) break;
      for (const p of products) {
        const vs = Array.isArray(p.variants) ? p.variants : [];
        // exact match
        if (vs.some(v => String(v.sku || '').trim() === s)) {
          const idNum = Number(p.id);
          if (idNum) return idNum;
        }
        // product-level SKU fallback (in case shop/apps expose a top-level sku)
        const topSku = String(p.sku || p.SKU || p.product_sku || p.productSku || '').trim();
        if (topSku && topSku === s) {
          const idNum = Number(p.id);
          if (idNum) return idNum;
        }
        // fuzzy collect
        for (const v of vs) {
          const k = String(v.sku || '').trim();
          if (!k) continue;
          if (k.includes(s)) {
            const pid = Number(p.id);
            if (pid) candidates.set(pid, (candidates.get(pid) || 0) + 1);
          }
        }
      }
      since_id = products[products.length - 1]?.id;
      pages++;
      if (!since_id || products.length < limit) break;
      if (pages > 200) break; // safety cap
    }
    if (candidates.size === 1) {
      const only = Array.from(candidates.keys())[0];
      if (only) return Number(only);
    }
  } catch (_) {}
  throw new Error('sku_not_found');
}

// Try variant SKU first, then fallback to a product-level SKU match during REST scan
async function ensureProductIdBySkuAny(client, sku) {
  try {
    const pid = await ensureProductIdByVariantSku(client, sku);
    return { productId: pid, via: 'variant_sku' };
  } catch (e) {
    // As an extra attempt, do a reduced REST scan focused on product-level SKU
    try {
      const s = String(sku || '').trim();
      if (!s) throw new Error('invalid_sku');
      const limit = 250; let since_id = undefined; let pages = 0;
      while (true) {
        const params = { limit, published_status: 'any', status: 'any' };
        if (since_id) params.since_id = since_id;
        const products = await client.product.list(params);
        if (!Array.isArray(products) || products.length === 0) break;
        for (const p of products) {
          const topSku = String(p.sku || p.SKU || p.product_sku || p.productSku || '').trim();
          if (topSku && topSku === s) {
            const idNum = Number(p.id);
            if (idNum) return { productId: idNum, via: 'product_sku' };
          }
        }
        since_id = products[products.length - 1]?.id;
        pages++;
        if (!since_id || products.length < limit) break;
        if (pages > 200) break;
      }
    } catch (_) {}
    throw e;
  }
}

function isAffirmative(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === 'yes' || s === 'ja' || s === 'true' || s === '1' || s === 'y';
}

function sleep(ms){ return new Promise(res => setTimeout(res, ms)); }

async function setWdPictureMetafield(client, productId, imageSrc, originalUrl, imageId) {
  // Ziel: In Shopify Admin sichtbar – bevorzugt File (Files) referenzieren; MediaImage nur als Fallback
  const productGid = `gid://shopify/Product/${Number(productId)}`;
  const canon = (u) => { try { const x = new URL(String(u)); x.search = ''; return x.toString(); } catch { return String(u).split('?')[0]; } };
  const filename = (u) => { try { return new URL(String(u)).pathname.split('/').pop(); } catch { const p = String(u).split('?')[0]; return p.substring(p.lastIndexOf('/')+1); } };
  const stem = (name) => { const base = String(name || '').replace(/\?.*$/, ''); const n = base.replace(/\.[a-z0-9]+$/i,''); return n.split('_')[0] || n; };
  const target = canon(imageSrc);
  const targetName = filename(target);
  const targetStem = stem(targetName);
    try {
    // Ensure definition exists so Admin UI displays the field
    try { await ensureWdPictureDefinition(client); } catch (_) {}
    // 1) Bevorzugt: In Files importieren und als file_reference setzen (Admin zeigt diesen Typ zuverlässig)
    try {
      const fileCreateMutation = `mutation fileCreate($files: [FileCreateInput!]!) { fileCreate(files: $files) { files { id } userErrors { field message } } }`;
      const sourceA = (originalUrl && /^https?:\/\//i.test(String(originalUrl))) ? String(originalUrl) : String(imageSrc);
      const fcVars = { files: [{ originalSource: sourceA, contentType: 'IMAGE' }] };
      const fcRaw = await client.graphql(fileCreateMutation, fcVars);
      let fcObj; try { fcObj = typeof fcRaw === 'string' ? JSON.parse(fcRaw) : fcRaw; } catch { fcObj = fcRaw; }
      const fcErrs = fcObj?.data?.fileCreate?.userErrors || [];
      if (fcErrs.length) {
        const msg = fcErrs.map(e => e?.message).filter(Boolean).join('; ');
        throw new Error(msg || 'fileCreate_failed');
      }
      const filesArr = (fcObj?.data?.fileCreate?.files || []);
      const fileId = filesArr[0]?.id || null;
      if (!fileId) throw new Error(`file_id_missing (files_len=${filesArr.length})`);
      const mfMutation = `mutation mfset($metafields:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$metafields){ metafields { id namespace key } userErrors { field message } } }`;
      const mfVars = { metafields: [{ ownerId: productGid, namespace: 'custom', key: 'wd-picture', type: 'file_reference', value: String(fileId) }] };
      const mfRaw = await client.graphql(mfMutation, mfVars);
      let mfObj; try { mfObj = typeof mfRaw === 'string' ? JSON.parse(mfRaw) : mfRaw; } catch { mfObj = mfRaw; }
      const mfErrs = mfObj?.data?.metafieldsSet?.userErrors || [];
      if (mfErrs.length) {
        const msg = mfErrs.map(e => e?.message).filter(Boolean).join('; ');
        throw new Error(msg || 'metafieldsSet_failed');
      }
      const mfNode = (mfObj?.data?.metafieldsSet?.metafields || [])[0] || null;
      return { ok: true, metafield_id: mfNode?.id || null, ref_id: String(fileId), ref_kind: 'File' };
    } catch (e) {
      // Wenn Files nicht möglich (z.B. fehlende write_files), in MediaImage fallen
    }
    // 2) Fallback: MediaImage am Produkt referenzieren (nicht immer im Admin sichtbar)
    // 2a) Schnellweg via REST image_id
    if (imageId) {
      try {
        const mediaGid = `gid://shopify/MediaImage/${Number(imageId)}`;
        const mfMutation0 = `mutation mfset($metafields:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$metafields){ metafields { id namespace key } userErrors { field message } } }`;
        const mfVars0 = { metafields: [{ ownerId: productGid, namespace: 'custom', key: 'wd-picture', type: 'file_reference', value: String(mediaGid) }] };
        const mfRaw0 = await client.graphql(mfMutation0, mfVars0);
        let mfObj0; try { mfObj0 = typeof mfRaw0 === 'string' ? JSON.parse(mfRaw0) : mfRaw0; } catch { mfObj0 = mfRaw0; }
        const mfErrs0 = mfObj0?.data?.metafieldsSet?.userErrors || [];
        if (!mfErrs0.length) {
          const mfNode = (mfObj0?.data?.metafieldsSet?.metafields || [])[0] || null;
          return { ok: true, metafield_id: mfNode?.id || null, ref_id: String(mediaGid), ref_kind: 'MediaImage' };
        }
      } catch (_) {}
    }
    // 2b) Suche MediaImage per product.media (Retry + Paging)
    let mediaId = null;
    for (let attempt = 0; attempt < 20 && !mediaId; attempt++) {
      let after = null; let page = 0;
      while (!mediaId) {
        const raw = await client.graphql(
          `query($id:ID!,$after:String){ product(id:$id){ media(first:100, after:$after){ pageInfo{ hasNextPage endCursor } edges{ node{ __typename ... on MediaImage { id image { url } } } } } } }`,
          { id: productGid, after }
        );
        let obj; try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = raw; }
        const media = obj?.data?.product?.media;
        const edges = media?.edges || [];
        for (const e of edges) {
          const n = e?.node; if (!n || n.__typename !== 'MediaImage') continue;
          const url = n?.image?.url ? canon(n.image.url) : null;
          const name = url ? filename(url) : null;
          const match = (url && url === target) || (name && (name === targetName || stem(name) === targetStem));
          if (match) { mediaId = n.id; break; }
        }
        if (mediaId) break;
        page++;
        const hasNext = media?.pageInfo?.hasNextPage;
        const cursor = media?.pageInfo?.endCursor || null;
        if (!hasNext || !cursor || page > 10) break;
        after = cursor;
      }
      if (!mediaId) await sleep(250);
    }
    if (mediaId) {
      const mfMutation = `mutation mfset($metafields:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$metafields){ metafields { id namespace key } userErrors { field message } } }`;
      const mfVars = { metafields: [{ ownerId: productGid, namespace: 'custom', key: 'wd-picture', type: 'file_reference', value: String(mediaId) }] };
      const mfRaw = await client.graphql(mfMutation, mfVars);
      let mfObj; try { mfObj = typeof mfRaw === 'string' ? JSON.parse(mfRaw) : mfRaw; } catch { mfObj = mfRaw; }
      const mfErrs = mfObj?.data?.metafieldsSet?.userErrors || [];
      if (mfErrs.length) {
        const msg = mfErrs.map(e => e?.message).filter(Boolean).join('; ');
        throw new Error(msg || 'metafieldsSet_failed');
      }
      const mfNode = (mfObj?.data?.metafieldsSet?.metafields || [])[0] || null;
      return { ok: true, metafield_id: mfNode?.id || null, ref_id: String(mediaId), ref_kind: 'MediaImage' };
    }
  } catch (e) {
    // weiter zu Fallback
  }
  // 3) Finaler Fallback: Files erneut versuchen (falls oben an anderer Stelle gescheitert)
  try {
    const fileCreateMutation = `mutation fileCreate($files: [FileCreateInput!]!) { fileCreate(files: $files) { files { id } userErrors { field message } } }`;
    // Bevorzugt die Original-URL aus der CSV (falls vorhanden), sonst die CDN-URL
    const sourceA = (originalUrl && /^https?:\/\//i.test(String(originalUrl))) ? String(originalUrl) : String(imageSrc);
    const fcVars = { files: [{ originalSource: sourceA, contentType: 'IMAGE' }] };
    const fcRaw = await client.graphql(fileCreateMutation, fcVars);
    let fcObj; try { fcObj = typeof fcRaw === 'string' ? JSON.parse(fcRaw) : fcRaw; } catch { fcObj = fcRaw; }
    const fcErrs = fcObj?.data?.fileCreate?.userErrors || [];
    if (fcErrs.length) {
      const msg = fcErrs.map(e => e?.message).filter(Boolean).join('; ');
      throw new Error(msg || 'fileCreate_failed');
    }
    const filesArr = (fcObj?.data?.fileCreate?.files || []);
    const fileId = filesArr[0]?.id || null;
  if (!fileId) throw new Error(`file_id_missing (files_len=${filesArr.length})`);
    const mfMutation = `mutation mfset($metafields:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$metafields){ metafields { id namespace key } userErrors { field message } } }`;
    const mfVars = { metafields: [{ ownerId: `gid://shopify/Product/${Number(productId)}`, namespace: 'custom', key: 'wd-picture', type: 'file_reference', value: String(fileId) }] };
    const mfRaw = await client.graphql(mfMutation, mfVars);
    let mfObj; try { mfObj = typeof mfRaw === 'string' ? JSON.parse(mfRaw) : mfRaw; } catch { mfObj = mfRaw; }
    const mfErrs = mfObj?.data?.metafieldsSet?.userErrors || [];
    if (mfErrs.length) {
      const msg = mfErrs.map(e => e?.message).filter(Boolean).join('; ');
      throw new Error(msg || 'metafieldsSet_failed');
    }
    const mfNode = (mfObj?.data?.metafieldsSet?.metafields || [])[0] || null;
    return { ok: true, metafield_id: mfNode?.id || null, ref_id: String(fileId), ref_kind: 'File' };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Ensure variant-level metafield definition for custom.wd-picture (type url)
async function ensureVariantWdPictureDefinition(client) {
  try {
    const q = `query($ownerType: MetafieldOwnerType!, $namespace: String!, $key: String!){
      metafieldDefinitionByOwnerTypeAndKey(ownerType:$ownerType, namespace:$namespace, key:$key){ id name type{ name } pinned }
    }`;
    const raw = await client.graphql(q, { ownerType: 'PRODUCTVARIANT', namespace: 'custom', key: 'wd-picture' });
    let obj; try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = raw; }
    const def = obj?.data?.metafieldDefinitionByOwnerTypeAndKey || null;
    if (def && def.id) {
      const t = String(def?.type?.name || '').toLowerCase();
      if (t === 'url') return { ok: true, id: def.id };
      // Wrong type: try delete and recreate
      try {
        const delRaw = await client.graphql(`mutation($id:ID!){ metafieldDefinitionDelete(id:$id){ deletedDefinitionId userErrors{ field message } } }`, { id: def.id });
        let del; try { del = typeof delRaw === 'string' ? JSON.parse(delRaw) : delRaw; } catch { del = delRaw; }
        const errs = del?.data?.metafieldDefinitionDelete?.userErrors || [];
        if (errs.length) {
          const msg = errs.map(e => e?.message).join('; ');
          return { ok: false, error: `variant_definition_wrong_type:${def?.type?.name || ''} delete_failed:${msg}` };
        }
      } catch (e) {
        return { ok: false, error: `variant_definition_wrong_type:${def?.type?.name || ''} delete_error:${e?.message || String(e)}` };
      }
    }
  } catch (_) {}
  try {
    const m = `mutation($definition: MetafieldDefinitionInput!){
      metafieldDefinitionCreate(definition:$definition){ metafieldDefinition{ id name type{ name } pinned } userErrors{ field message } }
    }`;
    const vars = { definition: {
      name: 'WD Picture (Variant URL)',
      namespace: 'custom',
      key: 'wd-picture',
      ownerType: 'PRODUCTVARIANT',
      type: 'url',
      visibleToStorefront: true,
      pinned: true
    } };
    const raw = await client.graphql(m, vars);
    let obj; try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = raw; }
    const errs = obj?.data?.metafieldDefinitionCreate?.userErrors || [];
    if (errs.length) {
      const msg = errs.map(e => e?.message).join('; ');
      if (!/already exists/i.test(msg)) return { ok: false, error: msg };
    }
    const node = obj?.data?.metafieldDefinitionCreate?.metafieldDefinition || null;
    return { ok: Boolean(node?.id), id: node?.id || null };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function ensureVariantIdBySku(client, sku) {
  const s = String(sku || '').trim(); if (!s) throw new Error('invalid_sku');
  // GraphQL exact search
  try {
    const raw = await client.graphql(`query($q:String!){ productVariants(first:1, query:$q){ edges{ node{ id sku } } } }`, { q: `sku:${s}` });
    let obj; try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = raw; }
    const edges = obj?.data?.productVariants?.edges || [];
    if (edges.length) {
      const gid = edges[0]?.node?.id || null; if (gid) return Number(String(gid).replace(/.*\/(\d+)$/, '$1'));
    }
  } catch (_) {}
  // REST best-effort
  try {
    const variants = await client.productVariant.list({ sku: s, limit: 1 });
    if (Array.isArray(variants) && variants.length) return Number(variants[0].id);
  } catch (_) {}
  throw new Error('variant_sku_not_found');
}

async function setVariantWdPictureMetafield(client, variantId, url) {
  const gid = `gid://shopify/ProductVariant/${Number(variantId)}`;
  // Ensure definition exists (best-effort)
  try { await ensureVariantWdPictureDefinition(client); } catch (_) {}
  const mfMutation = `mutation mfset($metafields:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$metafields){ metafields { id namespace key } userErrors { field message } } }`;
  const mfVars = { metafields: [{ ownerId: gid, namespace: 'custom', key: 'wd-picture', type: 'url', value: String(url) }] };
  const raw = await client.graphql(mfMutation, mfVars);
  let obj; try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = raw; }
  const errs = obj?.data?.metafieldsSet?.userErrors || [];
  if (errs.length) {
    const msg = errs.map(e => e?.message).filter(Boolean).join('; ');
    return { ok: false, error: msg || 'metafieldsSet_failed' };
  }
  const node = (obj?.data?.metafieldsSet?.metafields || [])[0] || null;
  return { ok: true, metafield_id: node?.id || null };
}

async function ensureProductIdByHandle(client, handle) {
  const h = normalizeHandle(handle);
  // 1) Try productByHandle
  const byHandleQry = /* GraphQL */ `
    query($h: String!) { productByHandle(handle: $h) { id handle } }
  `;
  let raw = await client.graphql(byHandleQry, { h });
  let obj; try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = raw; }
  let data = obj && (obj.data || obj);
  let gid = data && data.productByHandle && data.productByHandle.id;
  let num = productNumericIdFromGid(gid);
  if (process.env.DEBUG_IMPORT) {
    try { console.warn('[ensureProductIdByHandle] byHandle', { h, gid, ok: Boolean(num) }); } catch {}
  }
  if (num) return num;

  // 2) Fallback: products query handle:<h>
  const productsQry = /* GraphQL */ `
    query($q: String!) { products(first: 1, query: $q) { edges { node { id handle } } } }
  `;
  raw = await client.graphql(productsQry, { q: `handle:${h}` });
  try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = raw; }
  data = obj && (obj.data || obj);
  let node = data && data.products && data.products.edges && data.products.edges[0] && data.products.edges[0].node;
  num = productNumericIdFromGid(node && node.id);
  if (process.env.DEBUG_IMPORT) {
    try { console.warn('[ensureProductIdByHandle] products', { h, found: Boolean(node), nodeHandle: node && node.handle, ok: Boolean(num) }); } catch {}
  }
  if (num) return num;

  // 3) Heuristic: strip trailing -digits and retry both
  const stripped = h.replace(/-\d+$/, '');
  if (stripped && stripped !== h) {
    raw = await client.graphql(byHandleQry, { h: stripped });
    try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = raw; }
    data = obj && (obj.data || obj);
    gid = data && data.productByHandle && data.productByHandle.id;
    num = productNumericIdFromGid(gid);
    if (process.env.DEBUG_IMPORT) {
      try { console.warn('[ensureProductIdByHandle] byHandle stripped', { stripped, gid, ok: Boolean(num) }); } catch {}
    }
    if (num) return num;

    raw = await client.graphql(productsQry, { q: `handle:${stripped}` });
    try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { obj = raw; }
    data = obj && (obj.data || obj);
    node = data && data.products && data.products.edges && data.products.edges[0] && data.products.edges[0].node;
    num = productNumericIdFromGid(node && node.id);
    if (process.env.DEBUG_IMPORT) {
      try { console.warn('[ensureProductIdByHandle] products stripped', { stripped, found: Boolean(node), nodeHandle: node && node.handle, ok: Boolean(num) }); } catch {}
    }
    if (num) return num;
  }
  // 4) Final fallback: REST pagination scan for exact handle match (costly but robust)
  try {
    const tryHandles = stripped && stripped !== h ? [h, stripped] : [h];
    const limit = 250;
    let since_id = undefined;
    let pages = 0;
    while (true) {
      const params = { limit, published_status: 'any' };
      if (since_id) params.since_id = since_id;
      const products = await client.product.list(params);
      if (!Array.isArray(products) || products.length === 0) break;
      for (const p of products) {
        if (p && tryHandles.includes(String(p.handle || '').toLowerCase())) {
          const idNum = Number(p.id);
          if (idNum) return idNum;
        }
      }
      since_id = products[products.length - 1]?.id;
      pages++;
      if (!since_id || products.length < limit) break;
      if (pages > 200) break; // safety cap
    }
  } catch (_) {}
  throw new Error('product_not_found');
}

async function importImages({ shop, token, rows, prefer = 'jpeg', concurrency = 4, onProgress = null }) {
  const client = getShopifyClient({ shop, token });
  const results = [];
  // Export-Zeilen für Produkt-Metafeld (file_reference ID)
  const productExportRows = []; // { handle, product_id, ref_id, ref_kind }
  let resultsFileUrl = null;

  // Robuste SKU-Extraktion: unterstützt unterschiedliche Header-Schreibweisen und Whitespaces
  function extractSkuFlexible(row) {
    if (!row || typeof row !== 'object') return '';
    // 1) Direkte, häufige Varianten
    const direct = row.variant_sku || row['variant sku'] || row.sku || row['sku#'] || row.SKU || row['Variant SKU'] || '';
    const d = String(direct || '').trim();
    if (d) return d;
    // 2) Fuzzy: irgendein Header mit 'sku' (bevorzuge solche, die auch 'variant' oder 'variante' enthalten)
    let best = '';
    let bestScore = -1;
    for (const [k, v] of Object.entries(row)) {
      if (v == null || v === '') continue;
      const val = String(v).trim(); if (!val) continue;
      const key = String(k || '');
      const norm = key.trim().toLowerCase();
      const hasSku = norm.includes('sku');
      if (!hasSku) continue;
      const hasVariant = norm.includes('variant') || norm.includes('variante');
      const score = (hasSku ? 1 : 0) + (hasVariant ? 1 : 0);
      if (score > bestScore) { best = val; bestScore = score; }
    }
    return best || '';
  }

  const byId = new Map();
  const byHandle = new Map();
  for (const row of rows) {
    let url = String(
      row.image_url || row.imageurl || row['image url'] || row.url || row.link || row.href ||
      row['bild-url'] || row['bild url'] || row['Bild-URL'] || row['Bild URL'] ||
      ''
    ).trim();
    if (!url) {
      try {
        for (const [k, v] of Object.entries(row || {})) {
          if (v && typeof v === 'string') {
            const s = v.trim();
            if (/^https?:\/\//i.test(s)) { url = s; break; }
          }
        }
      } catch (_) {}
    }
  const posRaw = row.position || row.Position || row.postition || row.Postition || row.pos || row.Pos || row['bild position'] || row['Bild Position'] || row['Bild-Position'] || '';
    const position = Number(posRaw);
    const pidRaw = row.product_id || row.ProductID || row['product id'] || row['Product ID'] || row['Produkt-ID'] || row['Produkt ID'];
    const pid = Number(pidRaw);
  const sku = extractSkuFlexible(row);
    const handle = normalizeHandle(row.handle || row.Handle || row.product_handle || '');
  const wdRaw = row['wd-picture'] || row['wd_picture'] || row['WD-Picture'] || row['Wd-Picture'] || row['WD_PICTURE'] || '';
  const hasCol = String(wdRaw || '').trim() !== '';
  const wd_picture = hasCol ? isAffirmative(wdRaw) : false;

    if (!url) {
  const r = { handle, product_id: pid, sku, url, ok: false, error: 'missing_url', wd_picture, debug_keys: Object.keys(row || {}) };
      results.push(r); if (onProgress) onProgress({ processed: 1, ok: 0, fail: 1, last: r });
      continue;
    }
    if (Number.isFinite(pid) && pid > 0) {
      const list = byId.get(pid) || [];
      list.push({ product_id: pid, sku: sku || null, handle: handle || null, url, position, wd_picture });
      byId.set(pid, list);
      continue;
    }
    if (handle) {
      const list = byHandle.get(handle) || [];
      list.push({ product_id: null, sku: sku || null, handle, url, position, wd_picture });
      byHandle.set(handle, list);
      continue;
    }
    const r2 = { handle: '', product_id: null, sku: '', url, ok: false, error: 'missing_identifier', wd_picture };
    results.push(r2); if (onProgress) onProgress({ processed: 1, ok: 0, fail: 1, last: r2 });
  }

  async function runPool(items, concurrency, iteratee) {
    const r = new Array(items.length);
    let nextIndex = 0;
    const conc = Math.max(1, Number(concurrency) || 1);
    async function worker() {
      while (true) {
        const i = nextIndex++;
        if (i >= items.length) break;
        try { r[i] = await iteratee(items[i], i); } catch (e) { r[i] = e; }
      }
    }
    const workers = Array.from({ length: Math.min(conc, items.length || 1) }, () => worker());
    await Promise.all(workers);
    return r;
  }

  // 1) Known product IDs
  for (const [pid, items] of byId) {
    const productId = Number(pid);
    // Wichtig: Uploads pro Produkt seriell ausführen, um 422-Konflikte zu vermeiden
    const out = await runPool(items, 1, async (it) => {
      try {
        const raw = await downloadToBuffer(it.url);
        const converted = await rasterToJpegPng(raw, prefer);
        const payload = { product_id: productId, attachment: converted.toString('base64') };
        if (Number.isFinite(it.position) && it.position > 0) payload.position = Number(it.position);
        const img = await client.productImage.create(productId, payload);
        // Produkt-Metafeld (immer setzen): speichert Datei-/MediaImage-Referenz-ID
        const mf = await setWdPictureMetafield(client, productId, img && img.src, it.url, img && img.id);
        const wd_set = Boolean(mf && mf.ok);
        const wd_error = wd_set ? null : (mf && mf.error || 'wd_picture_failed');
        if (wd_set && mf && mf.ref_id) {
          productExportRows.push({ handle: it.handle || '', product_id: productId, ref_id: mf.ref_id, ref_kind: mf.ref_kind || '' });
        }
        return { ...it, ok: true, image_id: img.id, src: img.src, position: img.position, resolved_via: 'product_id', wd_picture_set: wd_set, wd_picture_error: wd_error, wd_picture_ref_id: mf && mf.ref_id || null, wd_picture_ref_kind: mf && mf.ref_kind || null };
      } catch (e) {
        const sc = e?.statusCode || e?.status;
        const body = e?.response?.body || e?.body;
        const detail = body && typeof body === 'string' ? body.slice(0, 200) : (body && JSON.stringify(body).slice(0,200));
        const msg = (e?.message || String(e)) + (sc ? ` [${sc}]` : '') + (detail ? ` :: ${detail}` : '');
        return { ...it, ok: false, error: msg, resolved_via: 'product_id' };
      }
    });
    results.push(...out);
    if (onProgress) {
      let okc = 0, failc = 0; for (const r of out) { if (r && r.ok) okc++; else failc++; }
      onProgress({ processed: out.length, ok: okc, fail: failc, last: out[out.length-1] });
    }
  }

  // 2) Via Handle (SKU wird ignoriert)
  for (const [handle, items] of byHandle) {
    let productId;
    try {
      productId = await ensureProductIdByHandle(client, handle);
    } catch (e) {
      for (const it of items) { const r = { ...it, ok: false, error: 'product_not_found', resolved_via: 'handle' }; results.push(r); if (onProgress) onProgress({ processed: 1, ok: 0, fail: 1, last: r }); }
      continue;
    }
    // Seriell je Produkt hochladen
    const out = await runPool(items, 1, async (it) => {
      try {
        const raw = await downloadToBuffer(it.url);
        const converted = await rasterToJpegPng(raw, prefer);
        const payload = { product_id: productId, attachment: converted.toString('base64') };
        if (Number.isFinite(it.position) && it.position > 0) payload.position = Number(it.position);
        const img = await client.productImage.create(productId, payload);
        const mf = await setWdPictureMetafield(client, productId, img && img.src, it.url, img && img.id);
        const wd_set = Boolean(mf && mf.ok);
        const wd_error = wd_set ? null : (mf && mf.error || 'wd_picture_failed');
        if (wd_set && mf && mf.ref_id) {
          productExportRows.push({ handle: it.handle || '', product_id: productId, ref_id: mf.ref_id, ref_kind: mf.ref_kind || '' });
        }
        return { ...it, ok: true, image_id: img.id, src: img.src, position: img.position, resolved_via: 'handle', wd_picture_set: wd_set, wd_picture_error: wd_error, wd_picture_ref_id: mf && mf.ref_id || null, wd_picture_ref_kind: mf && mf.ref_kind || null };
      } catch (e) {
        const sc = e?.statusCode || e?.status;
        const body = e?.response?.body || e?.body;
        const detail = body && typeof body === 'string' ? body.slice(0, 200) : (body && JSON.stringify(body).slice(0,200));
        const msg = (e?.message || String(e)) + (sc ? ` [${sc}]` : '') + (detail ? ` :: ${detail}` : '');
        return { ...it, ok: false, error: msg, resolved_via: 'handle' };
      }
    });
    results.push(...out);
    if (onProgress) { let okc = 0, failc = 0; for (const r of out) { if (r && r.ok) okc++; else failc++; } onProgress({ processed: out.length, ok: okc, fail: failc, last: out[out.length-1] }); }
  }
  // XLSX- oder CSV-Export erstellen: Spalten [handle, variant metafield:wd-picture, sku]
  try {
    const exportDir = path.join(__dirname, '..', 'exports');
    try { if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true }); } catch(_) {}
    // 1) Detaillierte Ergebnisse als JSON persistieren (immer)
    try {
      const tsRes = Date.now();
      const rPath = path.join(exportDir, `results-${tsRes}.json`);
      const payload = { generatedAt: tsRes, count: results.length, results };
      fs.writeFileSync(rPath, JSON.stringify(payload, null, 2), 'utf8');
      resultsFileUrl = `/exports/results-${tsRes}.json`;
      setLastResultsUrl(resultsFileUrl);
    } catch(_) {}
    // 2) Produkt-Metafeld-Export (nur wenn Zeilen vorhanden)
    if (productExportRows.length) {
      const ts = Date.now();
      const xrows = productExportRows.map(r => ({ 'handle': r.handle, 'product id': r.product_id, 'product metafield:custom.wd-picture': r.ref_id, 'ref kind': r.ref_kind }));
      let filename = `wd-picture-product-export-${ts}.xlsx`;
      try {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(xrows);
        XLSX.utils.book_append_sheet(wb, ws, 'wd-picture');
        const xPath = path.join(exportDir, filename);
        XLSX.writeFile(wb, xPath);
        setLastVariantExportUrl(`/exports/${filename}`);
      } catch (e) {
        // Fallback CSV
        filename = `wd-picture-product-export-${ts}.csv`;
        const headers = ['handle','product id','product metafield:custom.wd-picture','ref kind'];
        const lines = [headers.join(',')].concat(xrows.map(r => headers.map(h => {
          let v = r[h]; v = v == null ? '' : String(v);
          if (v.includes('"') || v.includes(',') || v.includes('\n')) v = '"' + v.replace(/"/g,'""') + '"';
          return v;
        }).join(',')));
        const cPath = path.join(exportDir, filename);
        fs.writeFileSync(cPath, lines.join('\n'), 'utf8');
        setLastVariantExportUrl(`/exports/${filename}`);
      }
    }
  } catch(_) {}
  return results;
}

async function rowsFromFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.csv')) return await parseCsv(buf);
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return parseXlsx(buf);
  throw new Error('unsupported_file');
}

// Small module-scoped holder for last export URL (served under /exports)
let __lastVariantExportUrl = null;
function setLastVariantExportUrl(u){ __lastVariantExportUrl = u; }
function getLastVariantExportUrl(){ return __lastVariantExportUrl; }

// Small module-scoped holder for last results URL (JSON under /exports)
let __lastResultsUrl = null;
function setLastResultsUrl(u){ __lastResultsUrl = u; }
function getLastResultsUrl(){ return __lastResultsUrl; }

module.exports = { importImages, rowsFromFile, ensureProductIdByHandle, ensureProductIdByVariantSku, getLastVariantExportUrl, getLastResultsUrl };
