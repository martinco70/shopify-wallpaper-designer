param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify',
  [string]$FileRel = 'sections/main-product.liquid'
)

$ErrorActionPreference = 'Stop'
$file = Join-Path $ThemeRepo $FileRel
if(-not (Test-Path $file)) { throw "File not found: $file" }
$content = Get-Content -Raw -Path $file -Encoding UTF8

# Extract schema JSON
$schemaRx = '(?s)\{\%\s*schema\s*\%\}(.*?)\{\%\s*endschema\s*\%\}'
$sm = [regex]::Match($content, $schemaRx)
if(-not $sm.Success){ throw "Schema block not found in $FileRel" }
$schema = $sm.Groups[1].Value

$blockWithSettings = @'
{"type":"siblings_grid","name":"Weitere Farben","limit":1,
  "settings":[
    { "type": "text", "id": "title", "label": "Titel", "default": "Weitere Farben" },
    { "type": "text", "id": "ns", "label": "Metafeld Namespace", "default": "custom" },
    { "type": "text", "id": "key", "label": "Metafeld Schlüssel (group_code)", "default": "artikelgruppierung" },
    { "type": "text", "id": "sf_token", "label": "Storefront API Token (öffentlich)" },
    { "type": "range", "id": "initial", "label": "Initiale Anzahl", "min": 4, "max": 48, "step": 1, "default": 12 },
    { "type": "range", "id": "batch", "label": "Mehr-Laden Anzahl", "min": 4, "max": 48, "step": 1, "default": 12 },
    { "type": "range", "id": "cols_desktop", "label": "Spalten (Desktop)", "min": 2, "max": 6, "step": 1, "default": 4 },
    { "type": "range", "id": "cols_tablet", "label": "Spalten (Tablet)", "min": 2, "max": 6, "step": 1, "default": 3 },
    { "type": "range", "id": "cols_mobile", "label": "Spalten (Mobile)", "min": 1, "max": 4, "step": 1, "default": 2 },
    { "type": "checkbox", "id": "show_oos", "label": "Badge für Nicht verfügbar anzeigen", "default": true },
    { "type": "select", "id": "sort_mode", "label": "Sortierung", "default": "title", "options": [ { "value": "title", "label": "Titel (A-Z)" } ] },
    { "type": "textarea", "id": "css", "label": "Benutzerdefiniertes CSS" }
  ]
}
'@

$modified = $false

if($schema -notmatch '"type"\s*:\s*"siblings_grid"'){
  # Insert new block into blocks array
  $mBlocks = [regex]::Match($schema, '(?s)"blocks"\s*:\s*\[')
  if(-not $mBlocks.Success){ throw 'blocks array not found in schema' }
  $insertPos = $mBlocks.Index + $mBlocks.Length
  $after = $schema.Substring($insertPos)
  $needsComma = -not ([regex]::IsMatch($after, '^(\s|\r|\n)*\]'))
  $schema = $schema.Substring(0, $insertPos) + "`n  " + $blockWithSettings + ($(if($needsComma){","}else{""})) + $after
  $modified = $true
} else {
  # Ensure existing block has settings
  $mType = [regex]::Match($schema, '"type"\s*:\s*"siblings_grid"')
  $idx = $mType.Index
  $start = $schema.LastIndexOf('{', $idx)
  if($start -lt 0){ throw 'Could not locate siblings_grid object start' }
  $depth = 0; $i=$start; $end=-1
  while($i -lt $schema.Length){
    $ch = $schema[$i]
    if($ch -eq '{'){ $depth++ }
    elseif($ch -eq '}'){ $depth--; if($depth -eq 0){ $end = $i; break } }
    $i++
  }
  if($end -lt 0){ throw 'Could not locate siblings_grid object end' }
  $obj = $schema.Substring($start, $end - $start + 1)
  if($obj -notmatch '"settings"\s*:'){
    $obj2 = $obj.TrimEnd('}')
    if($obj2.Trim().EndsWith('{')){ $obj2 = $obj2 + '"settings":' + $blockWithSettings.Substring($blockWithSettings.IndexOf('"settings"')) }
    else { $obj2 = $obj2 + ',' + '"settings":' + $blockWithSettings.Substring($blockWithSettings.IndexOf('"settings"')) }
    $schema = $schema.Substring(0, $start) + $obj2 + $schema.Substring($end + 1)
    $modified = $true
  }
}

if($modified){
  $content = $content.Substring(0, $sm.Groups[1].Index) + $schema + $content.Substring($sm.Groups[1].Index + $sm.Groups[1].Length)
  Set-Content -Path $file -Value $content -Encoding UTF8
  git -C $ThemeRepo add $FileRel | Out-Null
  git -C $ThemeRepo commit -m "feat(pdp): add siblings_grid block settings to schema" | Out-Null
  git -C $ThemeRepo push origin main | Out-Null
  Write-Host "Schema updated with siblings_grid settings." -ForegroundColor Green
} else {
  Write-Host "siblings_grid settings already present." -ForegroundColor Yellow
}
