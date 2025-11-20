param(
  [Parameter(Mandatory=$true)][string]$FilePath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $FilePath)) { throw "File not found: $FilePath" }

$txt = Get-Content -Raw -Path $FilePath -Encoding UTF8

$startTag = '{% schema %}'
$endTag = '{% endschema %}'
$startIdx = $txt.IndexOf($startTag)
$endIdx = $txt.IndexOf($endTag)
if ($startIdx -lt 0 -or $endIdx -le $startIdx) { throw 'Schema tags not found in file.' }

$jsonStart = $startIdx + $startTag.Length
# Trim leading whitespace/newlines
$prefix = $txt.Substring(0, $jsonStart)
$suffix = $txt.Substring($endIdx)
$jsonRaw = $txt.Substring($jsonStart, $endIdx - $jsonStart)
$jsonStr = $jsonRaw.Trim()

try { $schema = $jsonStr | ConvertFrom-Json -ErrorAction Stop } catch { throw "Invalid JSON inside schema before fix: $($_.Exception.Message)" }

if (-not $schema.blocks) { $schema | Add-Member -NotePropertyName blocks -NotePropertyValue @() }

# Prüfen, ob variant_guard schon existiert
$hasGuard = $false
foreach ($b in $schema.blocks) { if ($b.type -eq 'variant_guard') { $hasGuard = $true; break } }
if (-not $hasGuard) {
  $newBlock = [PSCustomObject]@{ type = 'variant_guard'; name = 'Varianten-Filter'; limit = 1; settings = @() }
  # An das Ende der Blocks-Liste anhängen
  $schema.blocks += $newBlock
}

# JSON schön formatiert zurückschreiben (Tiefe hochsetzen)
$jsonOut = $schema | ConvertTo-Json -Depth 100

# Ersetze den Schemabereich im Originaltext
$newTxt = $prefix + "`r`n" + $jsonOut + "`r`n" + $suffix

Set-Content -Path $FilePath -Value $newTxt -Encoding UTF8
Write-Host "Schema repaired: $FilePath" -ForegroundColor Green