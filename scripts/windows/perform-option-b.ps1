param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify',
  [string]$FileRel = 'sections/main-product.liquid'
)

$ErrorActionPreference = 'Stop'
$file = Join-Path $ThemeRepo $FileRel
if(-not (Test-Path $file)) { throw "File not found: $file" }
$content = Get-Content -Raw -Path $file -Encoding UTF8
$modified = $false

# Step 1: Remove any stray fallback renders and debug markers
$prev = $content
$content = [regex]::Replace($content, "(?m)^\s*<!--\s*siblings-debug-marker:.*$\r?\n?", "")
$content = [regex]::Replace($content, "(?m)^\s*\{\%\s*render\s+'product-siblings-inline'\s*\%\}\s*$\r?\n?", "")
if($content -ne $prev){ $modified = $true }

# Step 2: Insert block-aware render after the for-loop start
$loopRx = "(?im)^\s*\{\%\-?\s*for\s+block\s+in\s+section\.blocks\s*\-?\%\}"
$lm = [regex]::Match($content, $loopRx)
if($lm.Success){
  if($content -notmatch "(?m)\{\%\s*if\s+block\.type\s*==\s*'siblings_grid'\s*\%\}.*\{\%\s*render\s+'product-siblings-inline'\s*\%\}"){
    $lineStart = $content.LastIndexOf("`n", $lm.Index)
    if($lineStart -lt 0){ $lineStart = 0 } else { $lineStart += 1 }
    $lineEnd = $content.IndexOf("`n", $lm.Index)
    if($lineEnd -lt 0){ $lineEnd = $content.Length }
    $loopLine = $content.Substring($lineStart, $lineEnd - $lineStart)
    $indentMatch = [regex]::Match($loopLine, "^(\s*)")
    $indent = if($indentMatch.Success){ $indentMatch.Groups[1].Value } else { '' }
    $injection = "`n$indent  {% if block.type == 'siblings_grid' %}{% render 'product-siblings-inline' %}{% endif %}`n"
    $insertPos = $lineEnd + 1
    $content = $content.Substring(0, $insertPos) + $injection + $content.Substring($insertPos)
    $modified = $true
  }
}

# Step 3: Ensure schema JSON has the block with settings
$schemaRx = '(?s)\{\%\s*schema\s*\%\}(.*?)\{\%\s*endschema\s*\%\}'
$sm = [regex]::Match($content, $schemaRx)
if(-not $sm.Success){ throw "Schema block not found in $FileRel" }
$schemaJson = $sm.Groups[1].Value

function TryParseJson([string]$json, [ref]$obj){
  try{ $obj.Value = $json | ConvertFrom-Json -ErrorAction Stop; return $true } catch { return $false }
}

# Attempt parse; if fails, do light cleanup of trailing commas
$objRef = $null
if(-not (TryParseJson $schemaJson ([ref]$objRef))){
  $clean = $schemaJson -replace ',\s*\]', ']' -replace ',\s*\}', '}'
  if(-not (TryParseJson $clean ([ref]$objRef))){ throw "Schema JSON invalid; please resolve manually before proceeding." }
}
$obj = $objRef
if(-not $obj.blocks){ $obj | Add-Member -NotePropertyName 'blocks' -NotePropertyValue @() }

$hasBlock = $false
foreach($b in $obj.blocks){ if($b.type -eq 'siblings_grid'){ $hasBlock = $true; break } }
if(-not $hasBlock){
  $newBlock = [ordered]@{
    type = 'siblings_grid'
    name = 'Weitere Farben'
    limit = 1
    settings = @(
      @{ type='text'; id='title'; label='Titel'; default='Weitere Farben' },
      @{ type='text'; id='ns'; label='Metafeld Namespace'; default='custom' },
      @{ type='text'; id='key'; label='Metafeld Schlüssel (group_code)'; default='artikelgruppierung' },
      @{ type='text'; id='sf_token'; label='Storefront API Token (öffentlich)' },
      @{ type='range'; id='initial'; label='Initiale Anzahl'; min=4; max=48; step=1; default=12 },
      @{ type='range'; id='batch'; label='Mehr-Laden Anzahl'; min=4; max=48; step=1; default=12 },
      @{ type='range'; id='cols_desktop'; label='Spalten (Desktop)'; min=2; max=6; step=1; default=4 },
      @{ type='range'; id='cols_tablet'; label='Spalten (Tablet)'; min=2; max=6; step=1; default=3 },
      @{ type='range'; id='cols_mobile'; label='Spalten (Mobile)'; min=1; max=4; step=1; default=2 },
      @{ type='checkbox'; id='show_oos'; label='Badge für Nicht verfügbar anzeigen'; default=$true },
      @{ type='select'; id='sort_mode'; label='Sortierung'; default='title'; options = @(@{ value='title'; label='Titel (A-Z)' }) },
      @{ type='textarea'; id='css'; label='Benutzerdefiniertes CSS' }
    )
  }
  $obj.blocks = @($newBlock) + $obj.blocks
  $modified = $true
}

if($modified){
  $newSchema = $obj | ConvertTo-Json -Depth 100
  $newContent = $content.Substring(0, $sm.Groups[1].Index) + $newSchema + $content.Substring($sm.Groups[1].Index + $sm.Groups[1].Length)
  Set-Content -Path $file -Value $newContent -Encoding UTF8
  git -C $ThemeRepo add $FileRel | Out-Null
  git -C $ThemeRepo commit -m "feat(pdp): option B - add siblings_grid block + loop render; remove fallback" | Out-Null
  git -C $ThemeRepo push origin main | Out-Null
  Write-Host "Option B applied and pushed." -ForegroundColor Green
} else {
  Write-Host "Option B: no changes necessary." -ForegroundColor Yellow
}
