param(
  [Parameter(Mandatory=$true)][string]$RepoUrl,
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'

# Resolve project root (this script sits in scripts/windows)
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
if (-not (Test-Path $Root)) { throw "Project root not found from $PSScriptRoot" }

# Locate Git
$GIT = 'C:\\Program Files\\Git\\bin\\git.exe'
if (-not (Test-Path $GIT)) { $GIT = 'git' }

Set-Location $Root

# Initialize if needed
if (-not (Test-Path (Join-Path $Root '.git'))) {
  & $GIT init
  # Set default branch
  try { & $GIT symbolic-ref HEAD "refs/heads/$Branch" } catch { }
}

# Add all files and commit if needed
& $GIT add -A
$hasHead = (& $GIT rev-parse --verify HEAD 2>$null)
$pending = (& $GIT status --porcelain).Trim()
if (-not $hasHead) {
  & $GIT commit -m 'chore: initial commit'
} elseif ($pending) {
  & $GIT commit -m 'chore: sync current changes'
} else {
  Write-Host 'No changes to commit.' -ForegroundColor Yellow
}

# Configure remote
$existing = (& $GIT remote get-url origin 2>$null)
if (-not $existing) {
  & $GIT remote add origin $RepoUrl
} else {
  & $GIT remote set-url origin $RepoUrl
}

# Ensure branch exists
try { & $GIT checkout -B $Branch } catch { }

# Push
& $GIT push -u origin $Branch

Write-Host ("Pushed to " + $RepoUrl + " [" + $Branch + "] from " + $Root) -ForegroundColor Green
