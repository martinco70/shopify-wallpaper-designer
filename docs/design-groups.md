# Design-Gruppen (Weitere Farben auf der PDP)

Dieses Feature zeigt weitere Farb-Varianten als eigenständige Produkte in einem Grid auf der Produktseite. Grundlage ist ein Metaobject `design_group`, welches eine Liste von Produkt-Referenzen hält. Die Gruppenzuordnung erfolgt über das Metafeld `product.metafields.custom.artikelgruppierung` (z. B. gleicher Design-Code).

## Bestandteile
- Section: `theme-sections/product-siblings.liquid`
- Optionales Snippet: `theme-snippets/design-sibling-card.liquid`
- Sync Script (Admin API): `scripts/windows/sync-design-groups.ps1`

## Einrichtung
1) Storefront API Token anlegen (öffentlich) und in der Section-Einstellung eintragen.
2) Admin API Token mit Rechten für `read_products` und `write_metaobjects` erstellen.
3) Produkte mit dem Metafeld `custom.artikelgruppierung` befüllen (gleicher Wert gruppiert Produkte zusammen).
4) Sync-Skript ausführen, um Metaobjects zu erzeugen/aktualisieren:

```powershell
# Beispiel
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/sync-design-groups.ps1 -Shop yourstore.myshopify.com -Token <ADMIN_API_TOKEN>
```

5) Section "Weitere Farben (Design-Gruppe)" in der Produktseite hinzufügen (meist unterhalb der Varianten). Optional Titel anpassen.

## Verhalten
- Grid-only: Bild + Titel, Link zur Produktseite
- Out-of-Stock Produkte sind sichtbar
- Initiale Anzahl und Batch-Größe (Mehr laden) konfigurierbar
- Sortierung standardmäßig gemäß Reihenfolge der Metaobject-Referenzen
- Aktuelles Produkt wird ausgefiltert

## Fehlerbehebung
- Section zeigt nichts: Prüfen, ob `custom.artikelgruppierung` gesetzt ist und ein Metaobject mit gleichem Handle existiert.
- Token fehlt: In der Browser-Konsole erscheint Warnung `[siblings] missing Storefront token`.
- Reihenfolge: Passe die Referenzen-Reihenfolge im Metaobject an oder sortiere im Skript nach Wunsch.

## Hinweise
- Das Sync-Skript ist idempotent. Führe es erneut aus, wenn sich Gruppen geändert haben.
- Optional kannst du statt Admin-GQL auch REST nutzen; GQL ist hier kompakter.
