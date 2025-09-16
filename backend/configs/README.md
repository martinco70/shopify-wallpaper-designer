# Laufzeit-Konfigurationen (Configs)

Dieser Ordner enthält zur Laufzeit erzeugte Konfigurations-Daten (JSON) für den Wallpaper-Designer.

Warum sind die Dateien nicht im Git-Repository?
- Sie stellen mutable State dar (Benutzer- / Session-spezifisch)
- Änderungen würden Commits aufblähen
- Datenschutz / potenziell sensible Projektinformationen

Falls du für Tests einen initialen Beispieldatensatz brauchst, kannst du manuell eine JSON-Datei anlegen:
```json
{
  "id": "example-id",
  "code": "ABC123",
  "wall": {"widthCm": 250, "heightCm": 200},
  "print": {"widthCm": 240, "heightCm": 190},
  "createdAt": "2025-09-12T12:10:00.000Z"
}
```
Diese README bleibt versioniert, während die eigentlichen JSON-Dateien durch `.gitignore` ignoriert werden.
