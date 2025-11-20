<#
.SYNOPSIS
  Synchronize Shopify Metaobjects of type `design_group` from products grouped by metafield custom.artikelgruppierung.

.DESCRIPTION
  - Reads all products (or from a CSV) and groups by group_code in metafield custom.artikelgruppierung.
  - Ensures a metaobject exists for each group_code with a `products` reference list ordered by handle.
  - Requires Admin API access token with read/write_metaobjects and read_products scopes.

.PARAMETER Shop
  Shop domain like mystore.myshopify.com

.PARAMETER Token
  Admin API access token

.PARAMETER ApiVersion
  Shopify API version (default 2024-07)

.PARAMETER FromCSV
  Optional CSV path containing columns: handle, id, group_code

#>
param(
  [Parameter(Mandatory=$true)][string]$Shop,
  [string]$Token,
  [string]$TokenFile,
  [string]$ApiVersion = '2024-07',
  [string]$FromCSV
)

$base = "https://$Shop/admin/api/$ApiVersion"

# Resolve token: prefer explicit -Token, then -TokenFile, then auto-detect backend/tokens/<shop>.json
function Normalize-Shop([string]$s){
  if(-not $s){ return '' }
  $t = $s.ToLower().Trim()
  $t = $t -replace '^https?://',''
  $t = $t -replace '/.*$',''
  $t = $t -replace '\.myshopify\.com$',''
  return $t
}

if(-not $Token){
  $shopName = Normalize-Shop $Shop
  $tf = $TokenFile
  if(-not $tf){
    try{
      $tf = Join-Path $PSScriptRoot '..' | Join-Path -ChildPath '..' | Join-Path -ChildPath ("backend/tokens/{0}.json" -f $shopName) | Resolve-Path -ErrorAction SilentlyContinue
    }catch{}
  }
  if($tf -and (Test-Path $tf)){
    try{
      $raw = Get-Content -Raw -Path $tf | ConvertFrom-Json
      $Token = $raw.access_token
    }catch{ Write-Error "Failed to read token from file: $tf"; exit 3 }
  }
}

if(-not $Token){ Write-Error "Missing -Token (and no token file found). Use -Token or -TokenFile."; exit 2 }
function Invoke-AdminGQL($Query, $Variables){
  $body = @{ query = $Query; variables = $Variables } | ConvertTo-Json -Depth 10
  $resp = Invoke-RestMethod -Uri "$base/graphql.json" -Method Post -Headers @{ 'X-Shopify-Access-Token' = $Token; 'Content-Type'='application/json' } -Body $body
  return $resp
}

$Q_PRODUCTS = @'
query Products($cursor:String){
  products(first:250, after:$cursor){
    edges{ cursor node{ id handle title metafield(namespace:"custom", key:"artikelgruppierung"){ value } } }
    pageInfo{ hasNextPage endCursor }
  }
}
'@

$Q_DEF = @'
query Def {
  metaobjectDefinitionByType(type:"design_group"){ id type name fieldDefinitions{ key name type required } }
}
'@

$M_DEF_CREATE = @'
mutation CreateDef {
  metaobjectDefinitionCreate(definition:{
    name:"Design Group",
    type:"design_group",
    fieldDefinitions:[{ name:"Products", key:"products", type:"json" }]
  }){
    metaobjectDefinition{ id type }
    userErrors{ field message }
  }
}
'@

$Q_MO = @'
query GetMO($handle:String!){
  metaobject(handle:{type:"design_group", handle:$handle}){ id handle field(key:"products"){ references(first:1){ edges{ node{ ... on Product { id } } } } } }
}
'@

$M_UPSERT = @'
mutation UpsertMO($handle:String!, $val:String!){
  metaobjectUpsert(handle:$handle, metaobject:{ type:"design_group", fields:[{ key:"products", value:$val }] }){
    metaobject{ id handle }
    userErrors{ field message }
  }
}
'@

Write-Host "Collecting products…" -ForegroundColor Cyan
$items = @()
if ($FromCSV) {
  $csv = Import-Csv -Path $FromCSV
  foreach($r in $csv){ $items += [pscustomobject]@{ id=$r.id; handle=$r.handle; group= $r.group_code } }
} else {
  $cursor=$null
  do{
    $resp = Invoke-AdminGQL $Q_PRODUCTS @{ cursor = $cursor }
    $edges = $resp.data.products.edges
    foreach($e in $edges){
      $n = $e.node
      $grp = if($n.metafield){ $n.metafield.value } else { $null }
      if([string]::IsNullOrWhiteSpace($grp)){ continue }
      $items += [pscustomobject]@{ id=$n.id; handle=$n.handle; group=$grp }
    }
    $cursor = $resp.data.products.pageInfo.endCursor
    $more = $resp.data.products.pageInfo.hasNextPage
  } while($more)
}

if($items.Count -eq 0){ Write-Warning "No products with group metafield found."; exit 0 }

Write-Host "Grouping ${($items.Count)} products…" -ForegroundColor Cyan
$byGroup = $items | Group-Object group

# Ensure metaobject definition exists
Write-Host "Ensuring metaobject definition 'design_group' exists…" -ForegroundColor Cyan
$def = Invoke-AdminGQL $Q_DEF @{}
if(-not $def.data.metaobjectDefinitionByType){
  $cd = Invoke-AdminGQL $M_DEF_CREATE @{}
  if($cd.errors){ Write-Warning ($cd.errors | ConvertTo-Json -Depth 6) }
  $cde = $cd.data.metaobjectDefinitionCreate.userErrors
  if($cde -and $cde.Count){ Write-Warning ("Def UserErrors: " + ($cde | ConvertTo-Json -Depth 6)) } else { Write-Host "Definition created" -ForegroundColor Green }
} else {
  Write-Host "Definition exists" -ForegroundColor Green
}

function To-Handle([string]$s){
  if([string]::IsNullOrWhiteSpace($s)){ return $s }
  $t = $s.ToLowerInvariant()
  $t = $t -replace "[^a-z0-9]+","-"
  $t = $t.Trim('-')
  return $t
}

foreach($g in $byGroup){
  $handle = To-Handle($g.Name)
  $refs = $g.Group | Sort-Object handle | ForEach-Object { $_.id }
  $json = ($refs | ConvertTo-Json -Depth 5)
  Write-Host "Upserting design_group '$handle' with ${($refs.Count)} product ids" -ForegroundColor Yellow
  $up = Invoke-AdminGQL $M_UPSERT @{ handle = $handle; val = $json }
  if($up.errors){ Write-Warning ($up.errors | ConvertTo-Json -Depth 6) }
  $ue = $up.data.metaobjectUpsert.userErrors
  if($ue -and $ue.Count){ Write-Warning ("UserErrors: " + ($ue | ConvertTo-Json -Depth 6)) } else { Write-Host "OK" -ForegroundColor Green }
}

Write-Host "Done." -ForegroundColor Green
