# Projekt-Dokumentation – Shopify Wallpaper Designer

Stand: 2025-11-03

Diese Dokumentation fasst die Architektur, die implementierten Features und alle relevanten technischen Details zusammen, die im Projektverlauf dieses Chats umgesetzt bzw. angepasst wurden. Ziel ist, dass Entwickler die Logik schnell nachvollziehen und sicher weiterentwickeln können.

---

## 1. Gesamtüberblick

- Monorepo-Struktur mit Backend (Node/Express) und Frontend/Assets (Shopify-Theme-Assets). Wichtigste Pfade:
  - `backend/` – Express-Server, Admin-API-Proxys, Datei-Uploads, Health, Utilities
  - `backend/public/` – öffentlich servierte Assets (JS, Bilder) inkl. Widgets und Inline-Skripte
  - `frontend/` – lokaler Dev-Build für den Designer (Webpack)
  - `docs/` – Projektdokumentation und Betriebshandbuch
- Hosting-Ziel: Remote-Server (Linux) mit PM2, NGINX/Proxy. Statischer Designer-Output unter `/opt/wallpaper-app/public/designer`.
- Shopify Admin API wird ausschließlich vom Backend angesprochen; Token liegen serverseitig unter `backend/tokens/`. Keine Secrets im Theme.

---

## 2. Server-Architektur (Backend)

- Technologie: Node.js/Express, `shopify-api-node` (REST + GraphQL), `multer` (Uploads), `sharp` (Bildvorschau), optional `pdfkit` (PDF-Erzeugung), CORS offen für die Widgets.
- Einstiegspunkt: `backend/index.js`
  - JSON-Parsing, CORS, rudimentäre Rate-Limiter je Route
  - Statische Auslieferung: `/designer` (verschiedene Suchpfade), `/public` (Assets), `/uploads`, `/exports`
  - Health-Endpunkte: `/healthz`, `/imagemagick/health`, `/ghostscript/health`, Diagnose-Routen
  - Token-Handling: Token-Dateien nach Shopnamen. Bevorzugt `<shop>-admin.json`. Flexible JSON/Plaintext-Leselogik.
  - Logging & einfache Fehlerbehandlung (globaler 404-Handler, zentraler Error-Handler)

### 2.1 Token- und Shop-Handling
- Normalisierung von Shopnamen (mit/ohne `.myshopify.com`).
- Token-Resolution bevorzugt Admin-Token (`<shop>-admin.json`); Fallbacks dokumentiert.
- Debug-Endpoints: `/debug/token-check`, `/debug/env`.

### 2.2 Statische Designer-Assets
- Kandidatenpfade werden in Priorität geordnet gescannt (ENV, Default-Deploy-Pfad, Projektpfade).
- Für `wpd-materials.js` wurde eine explizite No-Cache-Route ergänzt: `GET /wpd-materials.js` (Cache-Control: no-store).

### 2.3 Wichtige Backend-Endpunkte

- Materialien (Materialvarianten): `GET /api/materials`
  - Zweck: Liste der Materialvarianten für eine Produktgruppe.
  - Quelle: Shopify Admin GraphQL `products(query: ...)` mit strenger Server-Filterung.
  - Strikte Regeln:
    - Gruppierung per Produkt-Metafield `custom.artikelgruppierung` + optional Vendor-Filter
    - Material-Label aus `custom.material`
    - Exkludiere Produkte vom Typ `Muster`
    - Dedupe nach Material (diakritik- und case-insensitiv)
    - Limit standardmäßig `<= 8`
  - Parameter:
    - `group` (string, required) – Artikelgruppe (exakter Match, normalisiert)
    - `vendor` (string, optional) – Vendor (exakter Match, normalisiert)
    - `shop` (string, optional) – Shopname ohne/mit `.myshopify.com`
    - `limit` (int, optional, max 8)
    - `debug=1` (optional) – liefert Diagnosezähler, Suchstring u.a.
    - `includeDraft=1` (optional) – inkludiert Status ≠ ACTIVE
    - `allowVendorFallback=1` (optional) – wenn Gruppe Matches hat, aber Vendor-Filter 0 ergibt, dann ohne Vendor zählen (nur deduped Materialien, bis Limit)
  - Debug-Payload (bei `debug=1`):
    - `search`, `shop`, `vendorNormalized`, `groupNormalized`, `includeDraft`
    - Zähler: `fetched`, `keptByGroup`, `keptByVendor`, `withMaterial`, `excludedMuster`, `withoutVendorCount`
    - Feinzähler: `withGroupMeta`, `groupMatched`, `vendorMatchedWithinGroup`, `vendorMismatchedWithinGroup`, `withMaterialWithinGroup`
    - `fallbackUsed`, `samples` (bis 5 Beispielprodukte), `tookMs`

- Materialien – Diagnose:
  - `GET /api/materials/inspect` – Prüft ein einzelnes Produkt (per `id`/`gid`, `handle` oder `title`) und zeigt `artikelgruppierung`/`material` (roh/normalisiert) an. Parameter: `shop`, `includeDraft` optional.
  - `GET /api/materials/group-scan` – Scannt Shop-seitig eine Gruppe und listet Beispielprodukte samt Zählern. Parameter: `shop`, `group` required; `vendor`, `includeDraft`, `limit` optional.

- Designvarianten (Geschwister):
  - `GET /public/siblings`, `GET /api/siblings`, `GET /designer/siblings`
    - Zweck: Produkte ermitteln, die dasselbe Metafeld (z. B. `custom.designname`) teilen.
    - Admin GraphQL mit striktem Gruppen-Match; liefert Liste inkl. Bilder/Inventar.
  - `GET /api/siblings/by-handle` – Ermittelt Gruppe via `productByHandle` und listet Geschwister ohne das Ausgangsprodukt.

- Weitere relevante Services:
  - Bild-Import (`POST /import/images`, CSV/XLSX Upload mit Fortschritt, Schreibrechte-Prüfung `write_products`)
  - Upload/Preview (`POST /upload`, Vorschau via `sharp` oder ImageMagick/Ghostscript)
  - Preisabfrage per SKU (`GET /price/:sku`) – REST-Variante, Fallback `materials.json`
  - Variant-Auflösung per SKU (`GET /variant/by-sku`)
  - Diverse Debug-/Export-Endpunkte (`/shopify/health`, `/shopify/access-scopes`, `/debug/export-skus`, u.a.)

---

## 3. Theme-/Client-Assets und Editor-Debug

### 3.1 Materialvarianten – Client (`backend/public/wpd-materials.js`)
- Verantwortlich für die Anzeige der Material-Buttons auf der PDP.
- Baut die URL zum Remote-Endpoint (`/api/materials`) und hängt im Theme Editor automatisch `debug=1&includeDraft=1&allowVendorFallback=1` an.
- Sortierung: bevorzugte Reihenfolge (Standard: `Vlies, Vinyl, Textil, Papier`), ansonsten A–Z.
- Editor-Debug:
  - Gelbe Debug-Box im Section bleibt jetzt dauerhaft sichtbar.
  - Implementiert einen `MutationObserver` und ein Keep-Alive-Intervall, das `hidden`/`display:none` rückgängig macht.
  - Zusätzlich ein fixiertes gelbes Overlay unten rechts (z‑Index max), das Debug-Zeilen unabhängig vom Section-DOM anzeigt.
- Barrierefreiheit: Buttons als `role=radio`, aktueller Zustand via `aria-checked`.

### 3.2 Designvarianten – Client
- `backend/public/wpd-siblings-inline.js`, `wpd-siblings-v2.js`, `wpd-siblings-probe.js` – inline/Probe-Skripte, die Sibling-API nutzen und UI aktualisieren.

### 3.3 Farbvarianten/Swatches – Client
- `backend/public/wpd-collection-swatches.js` – Logik für Farbswatches auf Collections/Produktlisten (einsetzbar je nach Theme-Integration). Details je nach Theme-Sektion.

---

## 4. Anwendungslogik pro App

### 4.1 Wallpaper Designer
- Auslieferung der Designer-Oberfläche via `/designer` (statische Pfade: ENV/Deploy-Pfad/Projektpfad/Frontend-Dist).
- Konfig-Endpoints:
  - `POST /config` – erstellt eine Konfiguration, liefert `configId`, Kurzcode und PDF-Link.
  - `GET /config/:id/pdf` – PDF-Erzeugung mit PDFKit (oder Minimal-PDF als Fallback), optional signierte Links (`/config/:id/signed-link`).
  - `GET /config/by-code/:code` – Kurzcode -> volle Konfig.
- Upload/Vorschau: `POST /upload` (JPG/TIFF/SVG/PDF/EPS), Vorschauerzeugung, Rückgabe von Preview-URL + Metadaten.
- Hilfsrouten: `/config-sample` (Berechnung Wand/Print/Area; „Tapetenrechner“-Bezug siehe 4.2).

### 4.2 Tapetenrechner
- Abgebildet über `GET /config-sample`:
  - Modus „wall“ oder Standard, Berechnung `wall` vs. `print` inkl. `bleed` (Standard 10 cm), `areaM2`.
  - Dient als Beispiel/Referenz für die Dimensionierungslogik im Designer.

### 4.3 Farbrechner
- In diesem Repo nicht als separater Service implementiert, aber Farblogik/Swatches über `wpd-collection-swatches.js` und ggf. Theme-Sektionen einsetzbar.
- Erweiterbar über ähnliche Proxy-Pattern (Admin GraphQL) falls Farb-Metafelder oder Farbcodes serverseitig ausgewertet werden sollen.

### 4.4 Farbvarianten
- Clientseitig über Collection-/Produktlisten-Skripte (`wpd-collection-swatches.js`).
- Serverseitig kann die Siblings-Logik genutzt werden, wenn „Farbe“ über ein gemeinsames Metafeld gruppiert wird (analog `designname`).

### 4.5 Materialvarianten
- Kern dieser Implementierung (siehe 2.3 und 3.1): strikte Serverlogik, Debug-fähig im Editor, dedupliziert, begrenzt.
- Parameter vollständig dokumentiert; Debug-Zähler erklären 0‑Treffer-Fälle transparent.

### 4.6 Designvarianten
- Implementiert über die Siblings-Proxys (`/public/siblings`, `/api/siblings`, `/designer/siblings`) sowie `by-handle`-Variante.
- Exakter Match des Gruppen-Metafelds (z. B. `custom.designname`).

---

## 5. Änderungen & neue Dateien (während dieses Chats)

### 5.1 Geänderte Dateien
- `backend/index.js`
  - Materialien-Endpoint `/api/materials` überarbeitet: strikte Filterlogik, Debug-Zähler, `includeDraft`, Vendor-Fallback optional.
  - Neue Diagnose-Endpoints: `/api/materials/inspect`, `/api/materials/group-scan`.
  - No-Cache-Route: `GET /wpd-materials.js` (Cache-Control: no-store).
  - Diverse Robustheits-/Debug-Anpassungen dokumentiert in Kommentaren.
- `backend/public/wpd-materials.js`
  - Stabilisierung der Debug-Box im Editor (MutationObserver, Keep-Alive).
  - Fixiertes Overlay „Materials – Debug“ hinzugefügt.
  - Automatische Debug-Parameter im Editor: `debug=1&includeDraft=1&allowVendorFallback=1`.

### 5.2 Neue Dateien
- `docs/TECHNICAL-DESIGN.md` (dieses Dokument – Quelle für die PDF-Erzeugung)
- `backend/scripts/generate-docs-pdf.js` (Skript zur PDF-Erstellung aus Markdown)

---

## 6. Deployment & Betrieb

### 6.1 Windows-Tasks (VS Code)
- Vorkonfigurierte Tasks (Start Backend/Frontend, Build Frontend, Deploy-Skripte, Theme-Sync, etc.)
- Remote-Deploy: `scripts/windows/deploy-backend.ps1` – lädt Backend und Assets hoch, PM2 Reload, Health-Prüfung.

### 6.2 Server (Linux)
- PM2-Prozess: `wallpaper-backend`
- Statischer Designer-Path: `/opt/wallpaper-app/public/designer`
- Token-Ordner: `/opt/wallpaper-app/backend/tokens` (z. B. `rtp0h2-cv-admin.json`)
- Health: `GET https://app.wirzapp.ch/healthz` (200 OK)

---

## 7. Sicherheits- und Performance-Aspekte
- Keine Secrets im Theme; Admin-Tokens ausschließlich auf dem Server.
- Rate-Limits pro IP/Route.
- CORS offen für Widgets; im Zweifel engere Restriktion erwägen.
- Siblings/Materials haben Sicherheitskappen (Pagination max Seiten, harte Obergrenzen).

---

## 8. Weiterentwicklung (Empfehlungen)
- Unit-/Integrationstests für Hauptendpunkte ergänzen (Materials/Siblings/Upload).
- Optionale Admin-UI (eingebettet) zur Token-Verwaltung.
- CI/CD-Pipeline für Build + Deploy.
- Erweiterte PDF-Layouts (Designer-Angebot/Bestellzusammenfassung).

---

## 9. Schnellreferenz – Endpunkte (Auszug)

- Materialien
  - `GET /api/materials?group=...&vendor=...&shop=...&limit=8&debug=1&includeDraft=1&allowVendorFallback=1`
  - `GET /api/materials/inspect?shop=...&(id|gid|handle|title)=...&includeDraft=1`
  - `GET /api/materials/group-scan?shop=...&group=...&vendor=...&includeDraft=1&limit=20`
- Designvarianten
  - `GET /public/siblings?group=...&limit=12`
  - `GET /api/siblings/by-handle?handle=...&limit=12`
- Designer
  - `POST /config`, `GET /config/:id/pdf`, `GET /config/by-code/:code`, `GET /config-sample`
- Upload/Preis/SKU
  - `POST /upload`, `GET /price/:sku`, `GET /variant/by-sku`
- Health/Diag
  - `GET /healthz`, `GET /shopify/health`, `GET /shopify/access-scopes`

---

## 10. Anhang: Parameterdetails Materialien

- `group`: exakter Gruppenwert aus `custom.artikelgruppierung` (normalisiert: lowercased, diakritikfrei, getrimmt)
- `vendor`: exakter Herstellername (normalisiert analog)
- `shop`: Shop ohne/mit `.myshopify.com`; Token muss serverseitig vorhanden sein
- `limit`: 1–8 (Clamp auf 8)
- `debug=1`: Debug-Payload aktiviert
- `includeDraft=1`: Produkte mit Status ≠ ACTIVE werden berücksichtigt
- `allowVendorFallback=1`: Falls Gruppe passt, aber kein Produkt mit Vendor passt, werden gruppengleiche Produkte ohne Vendorfilter dedupliziert bis Limit übernommen

