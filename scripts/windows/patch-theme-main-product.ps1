param(
  [Parameter(Mandatory=$true)][string]$FilePath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $FilePath)) { throw "File not found: $FilePath" }

$content = Get-Content -Raw -Path $FilePath
$changed = $false

# 1) Render-Case einfügen: {%- when 'variant_guard' -%} vor {%- when 'wpd_launcher' -%}
if ($content -notmatch "when 'variant_guard'") {
  $anchor = "{%- when 'wpd_launcher' -%}"
  if ($content -match [regex]::Escape($anchor)) {
    $replacement = @"
{%- when 'variant_guard' -%}
  {% render 'variant-guard' %}
$anchor
"@
    $content = [regex]::Replace($content, [regex]::Escape($anchor), [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $replacement }, 1)
    $changed = $true
  }
}

# 2) Schema-Block ergänzen: neuen Block "variant_guard" in blocks[] einfügen, falls noch nicht vorhanden
if ($content -notmatch '"type"\s*:\s*"variant_guard"') {
  $blocksPattern = '(?s)"blocks"\s*:\s*\[(.*?)\]'
  $rx = [regex]::new($blocksPattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  $m = $rx.Match($content)
  if ($m.Success) {
    $inner = $m.Groups[1].Value
    $insert = @"
,
    {
      ""type"": ""variant_guard"",
      ""name"": ""Varianten-Filter"",
      ""limit"": 1,
      ""settings"": []
    }
"@
    # Falls blocks leer sind, führendes Komma entfernen
    $newInner = if ([string]::IsNullOrWhiteSpace($inner)) { $insert.TrimStart(',') } else { $inner + $insert }

    # Ersetze nur den Inhalt der Klammern [...] (Gruppe 1)
    $start = $m.Groups[1].Index
    $len = $m.Groups[1].Length
    $content = $content.Substring(0, $start) + $newInner + $content.Substring($start + $len)
    $changed = $true
  }
}

if ($changed) {
  Set-Content -Path $FilePath -Value $content -Encoding UTF8
  Write-Host "Patched: $FilePath" -ForegroundColor Green
} else {
  Write-Host "No changes needed: $FilePath" -ForegroundColor Yellow
}