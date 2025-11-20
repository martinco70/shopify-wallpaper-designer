# Produkt: Material-Optionen als Block einsetzen

Wenn dein Produkt-Hauptabschnitt (z. B. `main-product`) **Custom Liquid**-Blöcke erlaubt, kannst du die Material-Buttons direkt als Block einfügen:

1. Öffne den Theme Editor auf einer Produktseite.
2. Wähle den Haupt-Produktabschnitt und füge einen **Custom Liquid**-Block hinzu.
3. Füge folgenden Code ein:

```liquid
{% render 'product-material-options' %}
```

Optional mit Einstellungen:

```liquid
{% render 'product-material-options', materials_title: 'Weitere Materialvarianten dieses Designs:', materials_sort: 'Vlies,Vinyl,Textil,Papier' %}
```

Debug-Ansicht im Editor (gelbe Box) siehst du standardmäßig als Overlay. Wenn du lieber nur die Inline-Box willst:

```liquid
{% render 'product-material-options', debug_ui: 'inline' %}
```

Hinweise:
- Das Snippet lädt automatisch das Script `assets/wpd-materials.js` (defer).
- Die Box wird standardmäßig erst ab 2 Treffern angezeigt. Über die neue Section "Material-Optionen" kannst du "Immer anzeigen" aktivieren; alternativ setze `min_items: 1` im Render-Aufruf.
