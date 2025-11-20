# Anleitung: Shopify Bild‑Import (einfach erklärt)

Diese Anleitung beschreibt, wie Sie viele Produktbilder auf einmal zu Shopify hochladen und – falls gewünscht – die Bilder automatisch als „WD Picture“ (Metafeld) für Varianten hinterlegen. Sie benötigen dafür nur eine Excel- oder CSV‑Datei.

Die Oberfläche zeigt während des Imports einen Fortschritt und erzeugt am Ende zwei Dateien:
- eine Ergebnisliste (zur Kontrolle)
- einen „Produkt‑Export“ mit der Bild‑Referenz‑ID für das Produkt‑Metafeld „custom.wd-picture“ (file_reference)

---

## 1) Was Sie vorbereiten müssen

- Eine Excel‑Datei (.xlsx) oder CSV‑Datei (.csv) mit mindestens zwei Informationen pro Zeile:
  - Produkt‑Kennung: am besten die Produkt‑ID (product_id) oder der Handle (z. B. "tapete‑abc"). Alternativ funktioniert auch eine Varianten‑SKU.
  - Bild‑URL: ein gültiger Link, der mit http(s) beginnt, z. B. https://…/bild.jpg

- Optional:
  - position: Bildposition im Produkt (Zahl > 0). Wenn leer, wird das Bild hinten angefügt.
  - wd-picture: Wird nicht mehr benötigt – das System setzt das WD‑Picture jetzt immer am Produkt. Es wird zusätzlich ein Produkt‑Export mit der Bild‑ID erstellt (siehe Schritt 5), z. B. für Nachkontrolle oder erneuten Import.

### Unterstützte Spaltennamen (flexibel)
Sie müssen nicht exakt die gleiche Schreibweise treffen – der Import erkennt gängige Varianten automatisch.

- Produkt‑ID: `product_id`, `Product ID`, `Produkt-ID`, `Produkt ID`
- Handle: `handle`, `product_handle`
- Varianten‑SKU: `variant_sku`, `Variant SKU`, `sku` (oder jede Spalte, die „sku“ im Namen trägt)
- Bild‑URL: `image_url`, `image url`, `url`, `link`, `href`, `bild-url`, `bild url`
- Position: `position`, `pos`
- WD Picture: `wd-picture`, `wd_picture`, `wd picture`

Tipp: Eine minimale Datei kann z. B. so aussehen (Excel oder CSV):

| handle       | image_url                               | wd-picture |
|--------------|------------------------------------------|------------|
| tapete-abc   | https://example.com/bilder/abc.jpg       | ja         |
| tapete-xyz   | https://example.com/bilder/xyz.png       |            |

---

## 2) Import starten

Sie bekommen von uns einen Link zu einer einfachen Upload‑Seite (oder wir führen den Import für Sie aus). Auf der Seite:

1. Datei auswählen (CSV/XLSX).
2. Ausgabeformat wählen (meist „JPEG“ – gut für Fotos; „PNG“ ist optional möglich). Die Bilder werden automatisch auf maximal 3000 px (lange Kante) verkleinert und in das gewählte Format konvertiert.
3. Import starten. Sie sehen eine Fortschrittsanzeige.

Hinweis für Teams: Der Import läuft über unsere gesicherte Server‑Schnittstelle. Für den Shop ist eine Admin‑Berechtigung „write_products“ hinterlegt – darum kümmern wir uns vorab für Sie.

---

## 3) Was passiert beim Import?

- Für jede Zeile wird das Bild heruntergeladen, konvertiert und als Produktbild in Shopify hochgeladen.
- Wenn eine Produkt‑ID in der Zeile steht, hat sie Vorrang. Sonst wird über Handle gesucht. Falls eine Varianten‑SKU vorhanden ist, hilft sie beim Zuordnen.
- Das System hinterlegt das Bild automatisch als „WD Picture“ (Produkt‑Metafeld `custom.wd-picture`) – als Datei‑Referenz (file_reference). Zusätzlich erzeugen wir einen Produkt‑Export mit der Bild‑Referenz‑ID für Kontrolle/Import (siehe Schritt 5).

---

## 4) Ergebnis prüfen

Nach dem Import erhalten Sie:

- Eine Ergebnisliste (als Tabelle auf der Seite und als Download „Ergebnis als CSV“). Sie sehen für jede Zeile u. a.:
  - ok / error: Hat der Upload geklappt?
  - src: Die endgültige Shopify‑Bild‑URL
  - image_id / position / resolved_via: Detailinfos zur Zuordnung
  - wd_picture_set / wd_picture_error: Ob das WD‑Picture am Produkt gesetzt werden konnte

– Ein „Produkt‑Export“ (Dateiname z. B. `wd-picture-product-export-<Zeitstempel>.xlsx` oder `.csv`). Diese Datei enthält u. a. die Spalten:
  - `handle`
  - `product id`
  - `product metafield:custom.wd-picture` (die Bild‑Referenz‑ID, z. B. `gid://shopify/File/...`)
  - `ref kind` (nur Info: `File` oder `MediaImage`)

Diese Datei dient zur Nachkontrolle oder optional zum Import in Shopify.

---

## 5) Optional: Produkt‑Metafeld per Import in Shopify aktualisieren (Produkt‑Export)

So verwenden Sie die Produkt‑Exportdatei aus Schritt 4, falls Sie in Shopify über den Produkt‑Import aktualisieren möchten:

1. Shopify Admin öffnen → Produkte → Importieren.
2. Die Export‑Datei hochladen (`.xlsx` oder `.csv`).
3. „Vorhandene Produkte aktualisieren/zusammenführen“ aktivieren (MERGE), damit nur das Produkt‑Metafeld ergänzt/aktualisiert wird.
4. Import starten und warten, bis Shopify fertig ist.
5. Kontrolle: Öffnen Sie ein Produkt und prüfen Sie das Metafeld `custom.wd-picture` – es verweist als Datei‑Referenz auf das Bild.

Hinweis:
- Das Produkt‑Metafeld `custom.wd-picture` ist vom Typ „file_reference“ (Datei/Medienreferenz) und wird direkt über die Admin‑API gesetzt. Den Produkt‑Export benötigen Sie nur für Nachkontrolle oder wenn Sie den Shopify‑Import zusätzlich nutzen möchten.

---

## 6) Häufige Fragen (FAQ)

- „Meine Datei hat andere Spaltennamen – geht das?“
  Ja. Der Import erkennt viele Varianten automatisch (siehe Liste oben). Im Zweifel bitte kurze Rückfrage an uns.

- „Ich habe nur den Produkt‑Link, keine ID/Handle.“
  In vielen Fällen kann der Handle aus dem Link erkannt werden (z. B. `…/products/tapete-abc`). Fügen Sie die URL in die Spalte `handle` ein – der Import bereinigt das automatisch.

- „Fehler: missing_admin_token oder fehlende Rechte.“
  Das bedeutet, dass der Shop‑Zugang (Admin‑Token) noch nicht freigeschaltet ist oder keine Schreibrechte (`write_products`) hat. Bitte kurz bei uns melden – wir richten das ein.

- „Wie groß dürfen die Bilder sein?“
  Beliebig – wir verkleinern serverseitig auf max. 3000 px Kantenlänge und konvertieren nach JPEG (Qualität 85) oder PNG, je nach Auswahl.

- „Kann ich die Reihenfolge der Bilder steuern?“
  Ja, mit der Spalte `position` (Zahl > 0). Sonst wird das neue Bild ans Ende angefügt.

- „Was mache ich mit der Ergebnisliste (CSV)?“
  Sie dient als Prüfprotokoll. Bei Fehlern sehen Sie eine klare Meldung je Zeile (inkl. Bild‑Referenz‑ID, falls gesetzt). Die Datei können Sie bei Bedarf an uns weiterleiten.

---

## 7) Mini‑Checkliste vor dem Start

- [ ] Spalten enthalten mindestens: Produkt‑ID oder Handle (oder Varianten‑SKU) und eine Bild‑URL
- [ ] Optional: `wd-picture = ja` in den Zeilen, für die ein WD‑Picture gesetzt werden soll
- [ ] Datei ist `.xlsx` oder `.csv`
- [ ] Sie haben (oder erhalten) den Link zur Upload‑Seite

---

## 8) Unterstützung

Wenn etwas unklar ist oder ein Import fehlschlägt: Einfach die Datei und eine kurze Beschreibung an uns schicken – wir prüfen die Zeilen und erledigen den Import für Sie.
