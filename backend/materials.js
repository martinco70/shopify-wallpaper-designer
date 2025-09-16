// Backend: Materialliste und Endpunkte
const express = require('express');
const router = express.Router();


const fs = require('fs');
const path = require('path');
const MATERIALS_FILE = path.join(__dirname, 'materials.json');

function readMaterials() {
  try {
    const data = fs.readFileSync(MATERIALS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Fehler beim Lesen der materials.json:', err);
    return [];
  }
}

function writeMaterials(materials) {
  try {
    fs.writeFileSync(MATERIALS_FILE, JSON.stringify(materials, null, 2), 'utf8');
  } catch (err) {
    console.error('Fehler beim Schreiben der materials.json:', err);
  }
}

// GET /materials
router.get('/', (req, res) => {
  res.json(readMaterials());
});

// POST /materials (Material hinzufügen)
router.post('/', (req, res) => {
  try {
    console.log('POST /materials body:', req.body);
    const { name, sku, price, productTitle, variantTitle } = req.body;
    if (!name) return res.status(400).json({ error: 'Name erforderlich' });
    const materials = readMaterials();
    const newMat = {
      id: Date.now(),
      name,
      sku: sku || '',
      price: price != null ? Number(price) : 0,
      productTitle: productTitle || '',
      variantTitle: variantTitle || ''
    };
    materials.push(newMat);
    writeMaterials(materials);
    console.log('Material hinzugefügt:', newMat);
    res.json(newMat);
  } catch (err) {
    console.error('Fehler bei POST /materials:', err);
    res.status(500).json({ error: 'Interner Serverfehler', details: err.message });
  }
});

// Material aktualisieren (z.B. SKU zuordnen)
router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, sku, price, productTitle, variantTitle } = req.body;
    let materials = readMaterials();
    materials = materials.map(m => (
      m.id === id
        ? {
            ...m,
            name: name || m.name,
            sku: sku ?? m.sku,
            price: price != null ? Number(price) : m.price,
            productTitle: productTitle != null ? productTitle : (m.productTitle || ''),
            variantTitle: variantTitle != null ? variantTitle : (m.variantTitle || '')
          }
        : m
    ));
    writeMaterials(materials);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Interner Serverfehler', details: err.message });
  }
});

// DELETE /materials/:id (Material löschen)
router.delete('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const materials = readMaterials().filter(m => m.id !== id);
    writeMaterials(materials);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Interner Serverfehler', details: err.message });
  }
});

module.exports = router;
