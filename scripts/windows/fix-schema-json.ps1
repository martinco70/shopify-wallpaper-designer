param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify',
  [string]$FileRel = 'sections/main-product.liquid'
)

$ErrorActionPreference = 'Stop'
$file = Join-Path $ThemeRepo $FileRel
if(-not (Test-Path $file)) { throw "File not found: $file" }
$content = Get-Content -Raw -Path $file -Encoding UTF8

$m = [regex]::Match($content, '(?s)\{\%\s*schema\s*\%\}(.*?)\{\%\s*endschema\s*\%\}')
if(-not $m.Success){ throw "Schema block not found in $FileRel" }
$prefix = $content.Substring(0, $m.Groups[1].Index)
$schemaJson = $m.Groups[1].Value
$suffix = $content.Substring($m.Groups[1].Index + $m.Groups[1].Length)

function TryParseJson([string]$json, [ref]$obj){
  try{ $obj.Value = $json | ConvertFrom-Json -ErrorAction Stop; return $true } catch { return $false }
}

# Clean common JSON issues (trailing commas before ] or })
$clean = $schemaJson -replace ',\s*\]', ']' -replace ',\s*\}', '}'

$objRef = $null
if(-not (TryParseJson $clean ([ref]$objRef))){
  # As a second attempt, compact whitespace
  $clean = ($clean -replace '\r','' -replace '\n',' ')
  $clean = $clean -replace ',\s*\]', ']' -replace ',\s*\}', '}'
  if(-not (TryParseJson $clean ([ref]$objRef))){ throw "Schema JSON still invalid after cleanup." }
}
$obj = $objRef

if(-not $obj.blocks){ $obj | Add-Member -NotePropertyName 'blocks' -NotePropertyValue @() }

# Ensure siblings_grid block with settings
$existing = @()
foreach($b in $obj.blocks){ if($b.type -eq 'siblings_grid'){ $existing += ,$b } }
if($existing.Count -eq 0){
  $block = [ordered]@{
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
  $obj.blocks = @($block) + $obj.blocks
} else {
  foreach($b in $existing){ if(-not $b.PSObject.Properties['settings']){ $b | Add-Member -NotePropertyName 'settings' -NotePropertyValue @() -Force } }
}

$newSchema = $obj | ConvertTo-Json -Depth 100

$newContent = $prefix + $newSchema + $suffix
Set-Content -Path $file -Value $newContent -Encoding UTF8
git -C $ThemeRepo add $FileRel | Out-Null
git -C $ThemeRepo commit -m "fix(schema): repair JSON and ensure siblings_grid settings" | Out-Null
git -C $ThemeRepo push origin main | Out-Null
Write-Host "Schema repaired and pushed." -ForegroundColor Green
