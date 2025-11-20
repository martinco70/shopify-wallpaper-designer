param(
  [string]$ThemeRepo = 'C:/Users/Public/xtra-theme-shopify'
)

$ErrorActionPreference = 'Stop'

if(-not (Test-Path $ThemeRepo)) { throw "Theme repo not found at $ThemeRepo" }

function Update-ProductSectionFile {
  param([string]$path)
  Write-Host ("Updating section: " + $path) -ForegroundColor Cyan
  $raw = Get-Content -Raw -Path $path -Encoding UTF8

  # 1) Inject block rendering into block switch
  $insertedCase = $false
  if ($raw -match "\{\%\\s*case\\s+block\.type\\s*\%\}(?s).*?\{\%\\s*endcase\\s*\%\}") {
    if ($raw -notmatch "when \'wpd_materials\'") {
      $raw = [System.Text.RegularExpressions.Regex]::Replace(
        $raw,
        "(\{\%\\s*case\\s+block\.type\\s*\%\})(?s)(.*?)(\{\%\\s*endcase\\s*\%\})",
        { param($m)
          $head = $m.Groups[1].Value
          $mid = $m.Groups[2].Value
          $tail = $m.Groups[3].Value
          $insertion = "`n  {% when 'wpd_materials' %}`n    {% render 'product-material-options', materials_title: block.settings.materials_title, materials_sort: block.settings.materials_sort %}`n"
          return $head + $mid + $insertion + $tail
        })
      $insertedCase = $true
    }
  } else {
    # Fallback: look for a for-loop over blocks and inject an if-block before endfor
    $patternFor = "\{\%\s*for\s+block\s+in\s+section\.blocks\s*\%\}(?s).*?\{\%\s*endfor\s*\%\}"
    if ($raw -match $patternFor) {
      if ($raw -notmatch "render \'product-material-options\'" -and $raw -notmatch "block\.type\s*==\s*\'wpd_materials\'") {
        $raw = [System.Text.RegularExpressions.Regex]::Replace(
          $raw,
          $patternFor,
          { param($m)
            $block = $m.Groups[0].Value
            $insertion = "\n  {% if block.type == 'wpd_materials' %}\n    {% render 'product-material-options', materials_title: block.settings.materials_title, materials_sort: block.settings.materials_sort %}\n  {% endif %}\n"
            return $block -replace "\{\%\s*endfor\s*\%\}", ($insertion + "{% endfor %}")
          })
        $insertedCase = $true
        Write-Host "Injected block render via for-loop fallback." -ForegroundColor Yellow
      }
    } else {
      Write-Warning "No '{% case %}' or for-loop over section.blocks found. Skipping render injection."
    }
  }

  # 2) Update schema to add block definition
  $schemaRe = [regex]"\{\%\s*schema\s*\%\}(?s)(.*?)\{\%\s*endschema\s*\%\}"
  $schemaMatch = $schemaRe.Match($raw)
  if(-not $schemaMatch.Success){ throw "Schema block not found in $path" }
  $schemaJson = $schemaMatch.Groups[1].Value.Trim()
  $obj = $schemaJson | ConvertFrom-Json
  if(-not $obj.blocks){ $obj | Add-Member -NotePropertyName blocks -NotePropertyValue @() }
  $has = $false
  foreach($b in $obj.blocks){ if($b.type -eq 'wpd_materials'){ $has=$true; break } }
  if(-not $has){
    $newBlock = @{ type = 'wpd_materials'; name = 'Materialvarianten (WPD)'; settings = @(
      @{ type='text'; id='materials_title'; label='Titel für Materialvarianten'; default='Weitere Materialvarianten dieses Designs:' },
      @{ type='text'; id='materials_sort'; label='Bevorzugte Sortierreihenfolge (Komma-getrennt)'; default='Vlies,Vinyl,Textil,Papier' }
    ) }
    $obj.blocks = @($obj.blocks + $newBlock)
  }
  $newSchema = ($obj | ConvertTo-Json -Depth 50)
  $raw = $schemaRe.Replace($raw, "{% schema %}`n" + $newSchema + "`n{% endschema %}")

  # Backup and write
  $backup = "$path.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  Copy-Item -Path $path -Destination $backup -Force
  Set-Content -Path $path -Value $raw -Encoding UTF8
  Write-Host "Updated: $path" -ForegroundColor Green
}

# Try common product section filenames
$sectionsDir = Join-Path $ThemeRepo 'sections'
$candidates = @()
if(Test-Path (Join-Path $sectionsDir 'main-product.liquid')){ $candidates += (Join-Path $sectionsDir 'main-product.liquid') }
$candidates += Get-ChildItem -Path $sectionsDir -Filter '*product*.liquid' -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
$candidates = $candidates | Select-Object -Unique
if(-not $candidates -or $candidates.Count -eq 0){ throw "No product section files found in $sectionsDir" }

$updated = @()
foreach($f in $candidates){
  try{ Update-ProductSectionFile -path $f; $updated += $f } catch { Write-Warning $_.Exception.Message }
}

if($updated.Count -gt 0){
  Write-Host "Git commit/push…" -ForegroundColor Yellow
  try { git -C $ThemeRepo config commit.gpgsign false } catch {}
  try { if(-not (git -C $ThemeRepo config --get user.name)){ git -C $ThemeRepo config user.name 'wpd-deploy' } } catch {}
  try { if(-not (git -C $ThemeRepo config --get user.email)){ git -C $ThemeRepo config user.email 'deploy@example.com' } } catch {}
  git -C $ThemeRepo add $updated
  git -C $ThemeRepo commit -m "feat(product): add WPD materials block and rendering"
  git -C $ThemeRepo push origin main
}

Write-Host "Done." -ForegroundColor Green
