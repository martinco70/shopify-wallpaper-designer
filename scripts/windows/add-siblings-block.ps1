param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify',
  [string]$FileRel = 'sections/main-product.liquid'
)

$ErrorActionPreference = 'Stop'
$file = Join-Path $ThemeRepo $FileRel
if(-not (Test-Path $file)) { throw "File not found: $file" }
$content = Get-Content -Raw -Path $file -Encoding UTF8

$modified = $false

# 1) Insert Liquid case branch for the new block type if not present
if($content -notmatch "when\s+'siblings_grid'"){
  $caseRx = "(?im)^\s*\{\%\-?\s*case\s+block\.type\s*\-?\%\}"
  $m = [regex]::Match($content, $caseRx)
  if($m.Success){
    $lineStart = $content.LastIndexOf("`n", $m.Index)
    if($lineStart -lt 0){ $lineStart = 0 } else { $lineStart += 1 }
    $lineEnd = $content.IndexOf("`n", $m.Index)
    if($lineEnd -lt 0){ $lineEnd = $content.Length }
    $caseLine = $content.Substring($lineStart, $lineEnd - $lineStart)
    $indentMatch = [regex]::Match($caseLine, "^(\s*)")
    $indent = if($indentMatch.Success){ $indentMatch.Groups[1].Value } else { '' }
    $injection = "`n$indent  {% when 'siblings_grid' %}`n$indent    {% render 'product-siblings-inline' %}`n"
    $insertPos = $lineEnd + 1
    $content = $content.Substring(0, $insertPos) + $injection + $content.Substring($insertPos)
    $modified = $true
  } else {
    Write-Warning "Could not find '{% case block.type %}'. Attempting loop-based insertion."
    # Try to find a common loop over section.blocks
    $loopRx = "(?im)^\s*\{\%\-?\s*for\s+block\s+in\s+section\.blocks\s*\-?\%\}"
    $lm = [regex]::Match($content, $loopRx)
    if($lm.Success){
      $lineStart = $content.LastIndexOf("`n", $lm.Index)
      if($lineStart -lt 0){ $lineStart = 0 } else { $lineStart += 1 }
      $lineEnd = $content.IndexOf("`n", $lm.Index)
      if($lineEnd -lt 0){ $lineEnd = $content.Length }
      $loopLine = $content.Substring($lineStart, $lineEnd - $lineStart)
      $indentMatch = [regex]::Match($loopLine, "^(\s*)")
      $indent = if($indentMatch.Success){ $indentMatch.Groups[1].Value } else { '' }
      # Insert after the loop start a conditional render for our block type
      $injection = "`n$indent  {% if block.type == 'siblings_grid' %}{% render 'product-siblings-inline' %}{% endif %}`n"
      $insertPos = $lineEnd + 1
      $content = $content.Substring(0, $insertPos) + $injection + $content.Substring($insertPos)
      $modified = $true
    }
  }
}

# 2) Update schema to add the block definition if missing
$schemaRx = '(?s)\{\%\s*schema\s*\%\}(.*?)\{\%\s*endschema\s*\%\}'
$sm = [regex]::Match($content, $schemaRx)
if(-not $sm.Success){ throw "Schema block not found in $FileRel" }
$schema = $sm.Groups[1].Value
if($schema -notmatch '"type"\s*:\s*"siblings_grid"'){
  $blocksRx = '(?s)"blocks"\s*:\s*\['
  $bm = [regex]::Match($schema, $blocksRx)
  if($bm.Success){
    # Determine indentation for block entries
    $schemaStartIdx = $bm.Index
    $lineStart = $schema.LastIndexOf("`n", $schemaStartIdx)
    if($lineStart -lt 0){ $lineStart = 0 } else { $lineStart += 1 }
    $lineEnd = $schema.IndexOf("`n", $schemaStartIdx)
    if($lineEnd -lt 0){ $lineEnd = $schema.Length }
    $blocksLine = $schema.Substring($lineStart, $lineEnd - $lineStart)
    $indentMatch = [regex]::Match($blocksLine, "^(\s*)")
    $bIndent = if($indentMatch.Success){ $indentMatch.Groups[1].Value + '  ' } else { '  ' }
    # Decide comma depending on whether there are existing blocks
    $insertPos = $bm.Index + $bm.Length
    $after = $schema.Substring($insertPos)
    $afterTrim = ($after -replace '^[\s\r\n]+','')
    $needsComma = $true
    if($afterTrim.StartsWith(']')){ $needsComma = $false }
    $settings = (
      "`n${bIndent}  \"settings\": [" +
      "`n${bIndent}    { \"type\": \"text\", \"id\": \"title\", \"label\": \"Titel\", \"default\": \"Weitere Farben\" }," +
      "`n${bIndent}    { \"type\": \"text\", \"id\": \"ns\", \"label\": \"Metafeld Namespace\", \"default\": \"custom\" }," +
      "`n${bIndent}    { \"type\": \"text\", \"id\": \"key\", \"label\": \"Metafeld Schlüssel (group_code)\", \"default\": \"artikelgruppierung\" }," +
      "`n${bIndent}    { \"type\": \"text\", \"id\": \"sf_token\", \"label\": \"Storefront API Token (öffentlich)\" }," +
      "`n${bIndent}    { \"type\": \"range\", \"id\": \"initial\", \"label\": \"Initiale Anzahl\", \"min\": 4, \"max\": 48, \"step\": 1, \"default\": 12 }," +
      "`n${bIndent}    { \"type\": \"range\", \"id\": \"batch\", \"label\": \"Mehr-Laden Anzahl\", \"min\": 4, \"max\": 48, \"step\": 1, \"default\": 12 }," +
      "`n${bIndent}    { \"type\": \"range\", \"id\": \"cols_desktop\", \"label\": \"Spalten (Desktop)\", \"min\": 2, \"max\": 6, \"step\": 1, \"default\": 4 }," +
      "`n${bIndent}    { \"type\": \"range\", \"id\": \"cols_tablet\", \"label\": \"Spalten (Tablet)\", \"min\": 2, \"max\": 6, \"step\": 1, \"default\": 3 }," +
      "`n${bIndent}    { \"type\": \"range\", \"id\": \"cols_mobile\", \"label\": \"Spalten (Mobile)\", \"min\": 1, \"max\": 4, \"step\": 1, \"default\": 2 }," +
      "`n${bIndent}    { \"type\": \"checkbox\", \"id\": \"show_oos\", \"label\": \"Badge für Nicht verfügbar anzeigen\", \"default\": true }," +
      "`n${bIndent}    { \"type\": \"select\", \"id\": \"sort_mode\", \"label\": \"Sortierung\", \"default\": \"title\", \"options\": [ { \"value\": \"title\", \"label\": \"Titel (A→Z)\" } ] }," +
      "`n${bIndent}    { \"type\": \"textarea\", \"id\": \"css\", \"label\": \"Benutzerdefiniertes CSS\" }" +
      "`n${bIndent}  ]"
    )
    $blockJson = "`n${bIndent}{\"type\": \"siblings_grid\", \"name\": \"Weitere Farben\", \"limit\": 1, $settings }" + ($(if($needsComma){","}else{""}))
    # Insert right after the opening [
    $schemaNew = $schema.Substring(0, $insertPos) + $blockJson + $after
    # Replace schema in content
    $content = $content.Substring(0, $sm.Groups[1].Index) + $schemaNew + $content.Substring($sm.Groups[1].Index + $sm.Groups[1].Length)
    $modified = $true
  } else {
    Write-Warning '"blocks": [ not found in schema; cannot add block definition.'
  }
}

# 3) If we successfully added the block case and schema, remove any fallback inline render outside blocks
if($modified){
  $prev = $content
  $content = [regex]::Replace($content, "(?m)^\s*<!--\s*siblings-debug-marker:.*$\r?\n?", "")
  $content = [regex]::Replace($content, "(?m)^\s*\{\%\s*render\s+'product-siblings-inline'\s*\%\}\s*$\r?\n?", "")
  if($content -ne $prev){ $modified = $true }
}

if($modified){
  Set-Content -Path $file -Value $content -Encoding UTF8
  git -C $ThemeRepo add $FileRel | Out-Null
  git -C $ThemeRepo commit -m "feat(pdp): add 'siblings_grid' block (case+schema) and remove fallback render" | Out-Null
  git -C $ThemeRepo push origin main | Out-Null
  Write-Host "Block added and changes pushed." -ForegroundColor Green
} else {
  Write-Host "No changes needed (block already present)." -ForegroundColor Yellow
}
