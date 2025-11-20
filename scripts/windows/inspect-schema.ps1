param(
    [Parameter(Mandatory=$true)]
    [string]$FilePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $FilePath)) {
    Write-Error "File not found: $FilePath"
}

$text = Get-Content -LiteralPath $FilePath -Raw -ErrorAction Stop
$m = [regex]::Match($text, '(?s)\{\%\s*schema\s*\%\}(.*?)\{\%\s*endschema\s*\%\}')
if (-not $m.Success) {
    Write-Output 'SCHEMA_NOT_FOUND'
    exit 2
}

$schema = $m.Groups[1].Value.Trim()

try {
    $null = $schema | ConvertFrom-Json -ErrorAction Stop
    Write-Output 'JSON_OK'
}
catch {
    Write-Output ('JSON_ERR: ' + $_.Exception.Message)
}

Write-Output '---BEGIN-SCHEMA---'
Write-Output $schema
Write-Output '---END-SCHEMA---'
