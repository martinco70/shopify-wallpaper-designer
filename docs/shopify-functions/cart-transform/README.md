# Shopify Functions: Cart Transform (Fixpreis aus Line-Property)

Ziel: Den Zeilenpreis im Warenkorb/Checkout anhand einer Line-Item-Property `price_override_chf` (vom Designer gesetzt) überschreiben, bei Menge=1.

Hinweise:
- Diese Lösung setzt eine Shopify App (CLI) und eine Function-Extension vom Typ `cart_transform` voraus.
- Währung: CHF. Bei anderen Währungen anpassen.
- Die Function greift nur, wenn die Property vorhanden und gültig ist.

## Quickstart (CLI)

1) Shopify CLI installieren und in dein Partner-/Shop-Konto einloggen.
2) In ein App-Verzeichnis wechseln (oder Neues erzeugen):

```bash
shopify app init my-app
cd my-app
```

3) Function generieren:

```bash
shopify app generate function --type=cart_transform --name=wpd-fixed-price --language=javascript
```

4) Inhalte der generierten Function mit dem untenstehenden `index.js` ersetzen.

5) Lokal testen:

```bash
shopify app dev
```

6) Deploy in den Shop:

```bash
shopify app deploy
shopify app connect
```

7) Im Admin die Function „WPD Fixed Price“ im Shop aktivieren (Checkout > Funktionen/Erweiterungen).

## Beispiel: `extensions/wpd-fixed-price/src/index.js`

```js
// WPD Fixed Price (Cart Transform)
// Liest line.properties.price_override_chf und setzt daraus den Preis.
// Erwartung: Menge = 1; Währung CHF.

import {
  run,
  CartTransform,
  FunctionResult,
  InputQuery,
} from "@shopify/cart-transform";

run(({ cart }) => {
  const operations = [];

  for (const line of cart.lines) {
    const props = Object.fromEntries((line.merchandise?.customAttributes || []).map(a => [a.key, a.value]));
    // Fallback: properties aus line.attributes (je nach Wrapper)
    for (const a of (line.attributes || [])) {
      if (!(a?.key in props)) props[a.key] = a.value;
    }

    const raw = props["price_override_chf"];
    if (!raw) continue;

    const parsed = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0) continue;

    // Menge=1 erwartet. Wenn >1, verteile auf Einzelpreis.
    const qty = Math.max(1, Number(line.quantity || 1));
    const perUnit = parsed / qty;

    operations.push(
      CartTransform.setLineItemPrice(line.id, {
        amount: perUnit.toFixed(2),
        currency: "CHF",
      })
    );
  }

  return new FunctionResult(operations);
});
```

## Mapping Designer → Function

- Der Designer sendet folgende Properties:
  - `price_override_chf`: Maschinenlesbarer Gesamtpreis in CHF (2 Nachkommastellen)
  - `Gesamtpreis (berechnet)`: Nur Anzeige (kann ignoriert werden)
  - `qty_mode = fixed_total`

> Hinweis: Falls du in Zukunft wieder mengenbasierte Skalierung (area_x100) nutzen willst, kann die Function stattdessen `area_m2` und `Preis/m²` auswerten.

## Troubleshooting

- Die Function wirkt nur im Checkout/Cart, wenn sie im Admin aktiviert ist.
- Prüfe die Währung in `setLineItemPrice`.
- Prüfe, ob dein Theme evtl. Preise lokal puffert (Drawer neu laden). Die Function wird serverseitig angewandt.
