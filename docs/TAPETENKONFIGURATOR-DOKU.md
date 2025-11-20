# Tapetenkonfigurator – verständliche Dokumentation für Einsteiger

Stand: 2025-11-06

Diese Dokumentation erklärt in einfachen Worten, was der Tapetenkonfigurator macht, wie er aufgebaut ist und welche Daten/Verbindungen er braucht. Ziel: Jede/r kann nachvollziehen, wie die Bausteine zusammenspielen und was für den Betrieb nötig ist.

---

## 1) Was ist der Tapetenkonfigurator?

- Eine Online-Oberfläche, mit der Kund:innen eigene Wandbilder/Tapeten konfigurieren können (z. B. Motiv, Material, Maße, Preisvorschau, PDF-Angebot).
- Er erscheint als Button auf der Produktseite (PDP) im Shopify-Theme. Nach dem Klick öffnet sich die Designer-Oberfläche.
- Die Daten (z. B. Materialien, Preise, Bilder) kommen aus Shopify und aus unserem eigenen Backend-Server.

---

## 2) Aus welchen Bausteinen besteht das System?

- Shopify-Theme (Storefront)
  - Snippet/Block „Launcher-Button“ (`wpd-launcher-button.liquid`) zeigt den „Konfigurator öffnen“-Knopf.
  - Dieses Snippet übergibt wichtige Infos als Datenattribute, z. B. Produkt-ID und Bild-URL.
- Launcher-Skript (JavaScript im Theme-Asset `wpd-launcher.js`)
  - Lädt/öffnet die Designer-Oberfläche und reicht die Produktdaten weiter.
  - Liest optional eine versteckte Variantentabelle (für Preis) oder nutzt direkt die Datenattribute.
- Backend-Server (z. B. `https://app.wirzapp.ch`)
  - Läuft separat (Node/Express) und spricht die Shopify Admin API an (mit Token).
  - Bietet Endpunkte für Materiallisten, Designvarianten (Geschwister), Uploads und PDFs.
  - Stellt die statische Designer-Oberfläche bereit (als Web-App).
- Designer-Oberfläche (statische Web-App)
  - Die eigentliche UI für Konfiguration/Upload, Maßangaben und PDF-Erzeugung.
  - Wird vom Launcher geöffnet und mit Produktinfos (z. B. Bild-URL, Produkt-ID) gestartet.

---

## 3) Welche Daten braucht der Konfigurator?

Mindestens:
- Produktbild-Referenz (Produkt-Metafeld)
  - Produkt-Metafeld `custom.wd-picture` (Dateityp: file_reference)
  - Es enthält eine Bild-ID (kein direkter Link). Das Theme löst diese ID automatisch in eine URL auf.
  - Wird zentral für den Designer als Startbild genutzt.
- Produkt-Identität und Preise
  - Produkt-ID, Variants/Preise (für Anzeige/Preisvorschau; Standard-Preis kommt aus Shopify).

Für Varianten/Filter (optional, aber empfohlen):
- Artikelgruppe (Metafeld `custom.artikelgruppierung`)
  - Damit findet der Server „Materialvarianten“ zur gleichen Gruppe (z. B. Vlies/Vinyl/Textil).
- Material (Metafeld `custom.material`)
  - Das sichtbare Material-Label, mit dem die UI Buttons baut.
- Hersteller/Vendor
  - Optionaler Filter, um nur Materialien des gleichen Herstellers zu zeigen. Es gibt Server-Logik für Fallbacks.
- Designname (Metafeld z. B. `custom.designname`)
  - Für „Geschwister“-Produkte (Designvarianten mit gleichem Motiv).

Hinweise:
- Diese Metafelder liegen am Produkt, nicht mehr an der Variante.
- Bilder werden (beim Import) als file_reference auf dem Produkt gesetzt. Vorteil: stabilere Referenz, keine Theme-Secrets nötig.

---

## 4) Welche Verbindungen sind beteiligt?

- Browser (Shopify-Storefront) → Backend-Server
  - Beispiel-Endpunkte:
    - `GET /api/materials` (Materialvarianten einer Gruppe)
    - `GET /api/siblings` bzw. `/api/siblings/by-handle` (Designvarianten)
    - `POST /upload` (Dateiupload für eigene Bilder)
    - `POST /config` / `GET /config/:id/pdf` (Konfiguration speichern, PDF erzeugen)
- Backend-Server → Shopify Admin API (mit Token)
  - Liest Produkt-/Metafelddaten (und schreibt bei Bedarf, z. B. Bild-Import in `custom.wd-picture`).
  - Wichtig: Das Token liegt nur serverseitig, niemals im Theme.
- Backend-Server → Shopify Files / Produktbilder
  - Beim Bild-Import werden Dateien hochgeladen und als Referenz am Produkt gespeichert.

So bleibt der Shop sicher: Das Theme enthält keine Geheimnisse. Alles, was „sensibel“ ist (Token, Schreibrechte), passiert nur auf dem Server.

---

## 5) Ablauf: vom Klick bis zur Konfiguration

1. PDP lädt das Snippet `wpd-launcher-button.liquid` und das Script `wpd-launcher.js`.
2. Das Snippet setzt u. a. `data-image-variant` auf die Bild-URL aus `product.metafields['custom']['wd-picture']`.
3. Klick auf „Konfigurator öffnen“ → Launcher startet die Designer-Oberfläche.
4. Der Designer liest Startparameter (Shop, Produkt-ID, Bild-URL) und ruft bei Bedarf:
   - Materialliste: `/api/materials?group=...&vendor=...` (mit strengen Filtern + Debug-Zählern)
   - Geschwister/Designvarianten: `/api/siblings...`
   - Upload/PDF: `/upload`, `/config`, `/config/:id/pdf`
5. Kund:in trifft Auswahl (Material/Maße/Motiv) → Vorschau/Preis.
6. Optional wird eine Konfiguration gespeichert und als PDF erzeugt.

---

## 6) Voraussetzungen und Rechte

- Shopify Admin API Token (serverseitig gespeichert)
  - Typische Scopes:
    - Lesen: `read_products`, `read_files`
    - Schreiben (nur falls nötig, z. B. Bild-Import): `write_products`, `write_files`
- Theme-Integration
  - Der Launcher-Button ist als Snippet/Block eingebunden.
  - In den Theme-Einstellungen kann die Backend-URL (falls vorgesehen) gesetzt sein.
- Produktdaten
  - Das Produkt hat `custom.wd-picture` gesetzt (Bild-ID). Ohne dieses Bild wirkt der Designer „blind“.
  - Für Material-Buttons: `custom.artikelgruppierung` und `custom.material` befüllt.

---

## 7) Einrichtung – einfache Checkliste

- [ ] Backend-URL ist erreichbar (z. B. `https://app.wirzapp.ch/healthz` gibt 200 OK).
- [ ] Admin-Token liegt auf dem Backend-Server unter dem korrekten Shop-Namen vor.
- [ ] Theme ist mit GitHub verbunden; Deployment aus dem Repo ist aktiv.
- [ ] Snippet `wpd-launcher-button.liquid` ist auf der PDP eingebunden.
- [ ] Produkt hat `custom.wd-picture` (file_reference) gesetzt.
- [ ] Materialdaten vorhanden: `custom.artikelgruppierung`, `custom.material` (optional Vendor).
- [ ] Test im Theme-Editor: Material-Buttons/Debug-Overlay sichtbar; Designer öffnet sich.

---

## 8) Häufige Fragen & typische Fehlerbilder

- Der Button ist da, aber der Designer öffnet nicht
  - Prüfen, ob `wpd-launcher.js` geladen wird (Netzwerk/Console im Browser).
  - Backend-URL in den Settings korrekt?
- Es erscheint kein Startbild im Designer
  - Produkt-Metafeld `custom.wd-picture` fehlt oder verweist auf eine ungültige Datei-ID.
  - Lösung: Bild-Import-Tool nutzen oder das Metafeld manuell korrekt setzen.
- Materialvarianten werden nicht angezeigt oder sind lückenhaft
  - `custom.artikelgruppierung` stimmt nicht mit der PDP überein oder Vendor-Filter ist zu streng.
  - Im Theme-Editor wird eine gelbe Debugbox angezeigt (Zähler/Fallback-Hinweise). Dort die Werte vergleichen.
- „Geschwister“/Designvarianten fehlen
  - Gruppen-Metafeld (z. B. `custom.designname`) ist uneinheitlich oder fehlt.
- Sicherheit: Liegen irgendwo API-Keys im Theme?
  - Nein. Tokens liegen ausschließlich auf dem Backend-Server.

---

## 9) Betrieb, Updates & Deployments (Kurzfassung)

- Backend deployen (Linux/PM2)
  - Per Script wird der Code auf den Server kopiert, PM2 neu geladen und Health geprüft.
- Theme synchronisieren
  - Lokale Dateien werden in das Theme-Repo gespiegelt und per GitHub-Push ausgerollt.
- Dokumente/PDFs
  - Markdown-Dateien im Ordner `docs/` können per Skript in PDFs umgewandelt werden.

Für den Alltag reichen in der Regel zwei Aktionen: „Backend deployen“ (bei Server-Änderungen) und „Theme syncen/pushen“ (bei Snippet/Asset-Änderungen).

---

## 10) Datenschutz & Performance – in kurzen Worten

- Keine Geheimnisse im Theme (Storefront). Alles Sensible bleibt auf dem Server.
- Zugriff auf Shopify erfolgt serverseitig; CORS ist für die Widgets geöffnet.
- Der Materialien-Endpunkt ist hart limitiert (z. B. max. 8 Einträge) und dedupliziert.
- Uploads werden auf dem Server geprüft und nur als Referenz gespeichert.

---

## 11) Glossar (einfach erklärt)

- Metafeld: Zusatzfeld am Produkt (z. B. „Artikelgruppe“ oder „Material“), das man im Admin pflegen kann.
- file_reference: Interne Bild-ID, aus der das Theme automatisch eine URL generiert.
- Vendor: Hersteller/Marke eines Produkts in Shopify.
- PDP: Produktdetailseite (die einzelne Produktseite im Shop).
- Launcher: Kleines Skript, das den Designer öffnet.

---

## 12) Wo finde ich was? (Dateien im Projekt)

- Theme-Snippet: `theme-snippets/wpd-launcher-button.liquid` (Button + Datenübergabe)
- Launcher-Asset: `backend/public/wpd-launcher.js` (im Theme als `assets/wpd-launcher.js`)
- Materialien-UI: `backend/public/wpd-materials.js`
- Server: `backend/index.js` (+ Services)
- Doku: `docs/` (diese Datei + weitere Anleitungen)

Fertig! Mit diesen Punkten sollte eine Person ohne Vorwissen die Funktionsweise und die wichtigsten Abhängigkeiten verstehen und typische Probleme erkennen können.

---

## 13) Preis- und Mengenberechnung – Unterschied „wd-calc=bahnen“ vs. „wd-calc=m2“

Der Designer kann Flächen, Druckmasse und Preise in unterschiedlichen Modi berechnen. Welcher Modus aktiv ist, wird per URL-Parameter `wd-calc` gesteuert:

- `wd-calc=bahnen`
- `wd-calc=m2`
- kein Parameter (Standard)

Zusätzlich wichtig:
- Wandmass (Eingabe): Breite und Höhe in Zentimetern
- Optional: `bahnenbreite` (in cm), nur im Modus „bahnen“ sinnvoll
- Optional: `price` (Preis pro Quadratmeter), sonst kommt der m²‑Preis aus der Produktvariante

### 13.1 Modus „bahnen“ (streifenweise)

Ziel: Ermitteln, wie viele Bahnen (Streifen) benötigt werden und wie gross das Druckmass sein muss, damit die Wand inklusive Toleranz abgedeckt ist.

Eingaben: Wandbreite `W` (cm), Wandhöhe `H` (cm), Bahnenbreite `B` (cm)

Wichtig: Woher kommt die Bahnenbreite?
- Der Designer liest sie aktuell aus dem URL‑Parameter `bahnenbreite` (in cm).
- Das Theme/snippet übergibt diesen Parameter derzeit nicht automatisch. Wenn „Bahnenmodus“ produktabhängig genutzt werden soll, gibt es zwei einfache Wege:
  1) Produkt‑Metafeld anlegen, z. B. `custom.bahnenbreite_cm` (Zahl), und den Launcher so erweitern, dass er `&bahnenbreite=<Wert>` an die Designer‑URL anhängt.
  2) Festen Wert in der Theme‑Sektion/Block‑Einstellung pflegen (z. B. 50 cm) und im Launcher an die URL anhängen.

Technischer Hinweis: In der Designer‑App wird `bahnenbreite` so gelesen und geprüft:
```
// vereinfacht aus server-snapshots/designer/main.js
const p = new URLSearchParams(location.search);
const mode = (p.get('wd-calc')||'').trim().toLowerCase(); // 'bahnen' | 'm2' | ''
const bahnenbreite = (() => {
  const v = p.get('bahnenbreite');
  if (!v) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
})();
```

Schritte (vereinfacht):
1) Anzahl Bahnen: `r = ceil(W / B)`
2) Vorläufige Druckbreite: `A = r * B`
3) Sicherheitszuschlag: Wenn `A < W + 10`, dann zusätzliche Bahn addieren:
  - `r = r + 1`
  - `A = r * B`
4) Druckhöhe: `I = H + 10` (10 cm Toleranz nach oben/unten)
5) Fläche in m²: `areaM2 = (A/100) * (I/100)`

Ausgabe im System:
- `calc.mode = "bahnen"`
- `calc.strips = r` (Anzahl Bahnen)
- `calc.addedExtraStrip = true/false` (ob die Extrabahn aus Schritt 3 hinzugefügt wurde)
- `print.widthCm = A`, `print.heightCm = I`, `areaM2` wie oben

Preisberechnung:
- m²‑Preis (CHF) kommt aus der aktiven Variante oder dem URL‑Parameter `price`.
- Gesamtpreis = `Preis_pro_m2 * areaM2` (auf 2 Nachkommastellen gerundet).

Beispiel:
- Wand: 320 × 240 cm, Bahnenbreite 50 cm
- `r = ceil(320/50) = 7`, `A = 7*50 = 350`
- Prüfung: `350 < 320 + 10`? → `350 < 330` ist falsch → keine Extrabahn
- `I = 240 + 10 = 250`
- `areaM2 = (350/100)*(250/100) = 3.5 * 2.5 = 8.75 m²`

### 13.2 Modus „m2“ (reine Fläche mit Toleranz)

Ziel: Reine Flächenberechnung mit Toleranz in Breite und Höhe.

Eingaben: Wandbreite `W` (cm), Wandhöhe `H` (cm)

Schritte:
1) Druckbreite: `A = W + 10`
2) Druckhöhe: `I = H + 10`
3) Fläche: `areaM2 = (A/100) * (I/100)`

Ausgabe im System:
- `calc.mode = "m2"`
- `print.widthCm = A`, `print.heightCm = I`, `areaM2` wie oben

Preisberechnung:
- Gesamtpreis = `Preis_pro_m2 * areaM2` (auf 2 Nachkommastellen).

Beispiel:
- Wand: 320 × 240 cm → `A = 330`, `I = 250`
- `areaM2 = (3.3)*(2.5) = 8.25 m²`

### 13.3 Standard (kein `wd-calc`)

Wenn kein Modus gesetzt ist, interpretiert der Designer die Eingabe als direktes Druckmass ohne automatische Toleranzen:

- `print.widthCm = W`
- `print.heightCm = H`
- `areaM2 = (W/100) * (H/100)`

Preisberechnung:
- Gesamtpreis = `Preis_pro_m2 * areaM2`.

### 13.4 Ausgabe in Warenkorb/PDF

Bei „In den Warenkorb“ werden u. a. folgende Eigenschaften übergeben (als Warenkorb‑Notizen/Eigenschaften):
- Wandmass (B × H) und Druckmass (B × H)
- Fläche in m² (3 Nachkommastellen)
- Preis/m² und Gesamtpreis (CHF)
- Im Modus „bahnen“ zusätzlich: Bahnenbreite, Anzahl Bahnen

Hinweis: Die hier genannten Toleranzen (10 cm) sind im Designer hinterlegt und dienen als Sicherheitszuschlag. Anpassungen wären möglich, müssten aber konsistent server‑ und clientseitig umgesetzt werden.
