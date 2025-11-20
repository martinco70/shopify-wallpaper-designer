param(
    [Parameter(Mandatory=$true)]
    [string]$FilePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $FilePath)) {
    throw "File not found: $FilePath"
}

$text = Get-Content -LiteralPath $FilePath -Raw

# Extract schema JSON
$m = [regex]::Match($text, '(?s)\{\%\s*schema\s*\%\}(.*?)\{\%\s*endschema\s*\%\}')
if (-not $m.Success) {
    throw 'Schema block not found'
}
$schemaStart = $m.Index
$schemaLen = $m.Length
$schemaInner = $m.Groups[1].Value.Trim()

# Try to parse JSON; if failed, attempt to repair common trailing comma issues
$parsed = $null
try {
    $parsed = $schemaInner | ConvertFrom-Json -ErrorAction Stop
}
catch {
    # try remove trailing commas in arrays/objects
    $repaired = $schemaInner -replace ',\s*([\]\}])','$1'
    try {
        $parsed = $repaired | ConvertFrom-Json -ErrorAction Stop
        $schemaInner = $repaired
    }
    catch {
        throw "Schema JSON invalid and could not be auto-repaired: $($_.Exception.Message)"
    }
}

# Ensure blocks exists and contains variant_guard
if (-not $parsed.blocks) {
    # Create blocks if missing
    $parsed | Add-Member -NotePropertyName blocks -NotePropertyValue @()
}

$hasVariantGuard = $false
foreach($b in $parsed.blocks){ if($b.type -eq 'variant_guard'){ $hasVariantGuard = $true; break } }
if (-not $hasVariantGuard) {
    $newBlock = [pscustomobject]@{ type = 'variant_guard'; name = 'Varianten-Filter'; limit = 1; settings = @() }
    $parsed.blocks += $newBlock
}

# Re-serialize JSON with minimal formatting
$newJson = $parsed | ConvertTo-Json -Depth 100

# Replace schema block
$before = $text.Substring(0, $schemaStart)
$after = $text.Substring($schemaStart + $schemaLen)
$newText = $before + '{% schema %}' + "`r`n" + $newJson + "`r`n" + '{% endschema %}' + $after

# Ensure Liquid case for variant_guard render exists inside switch for blocks
if ($newText -notmatch "when 'variant_guard'") {
    # inject into the case block inside 'case block.type'
    $caseMatch = [regex]::Match($newText, '(?s)case\s+block\.type(.*?)(endcase)')
    if ($caseMatch.Success) {
        $caseBody = $caseMatch.Groups[1].Value
        $insertion = "`r`n      when 'variant_guard'`r`n        render 'variant-guard'`r`n"
        $newCaseBody = $caseBody + $insertion
        $newText = $newText.Substring(0,$caseMatch.Index) + 'case block.type' + $newCaseBody + 'endcase' + $newText.Substring($caseMatch.Index + $caseMatch.Length)
    } else {
        Write-Warning "Could not locate 'case block.type' to insert render; skipping Liquid insertion."
    }
}

Set-Content -LiteralPath $FilePath -Encoding UTF8 -NoNewline -Value $newText
Write-Output "Patched: $FilePath"
