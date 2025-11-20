param(
  [Parameter(Mandatory=$true)][string]$Shop,
  [string]$Token,
  [string]$TokenFile
)

$ErrorActionPreference = 'Stop'
function Normalize-ShopName([string]$s){ if(-not $s){ return '' } $t=$s.ToLower().Trim(); $t=$t -replace '^https?://',''; $t=$t -replace '/.*$',''; $t=$t -replace '\.myshopify\.com$',''; return $t }
if(-not $Token){
  $shopName = Normalize-ShopName $Shop
  if(-not $TokenFile){ try{ $TokenFile = Join-Path $PSScriptRoot '..' | Join-Path -ChildPath '..' | Join-Path -ChildPath ("backend/tokens/{0}.json" -f $shopName) | Resolve-Path -ErrorAction SilentlyContinue }catch{} }
  if($TokenFile -and (Test-Path $TokenFile)){
    $raw = Get-Content -Raw -Path $TokenFile | ConvertFrom-Json
    $Token = $raw.access_token
  }
}
if(-not $Token){ throw 'Missing token' }

$base = "https://$Shop/admin/api/2024-07"
function Invoke-AdminGQL($Query, $Variables){
  $body = @{ query = $Query; variables = $Variables } | ConvertTo-Json -Depth 10
  return Invoke-RestMethod -Uri "$base/graphql.json" -Method Post -Headers @{ 'X-Shopify-Access-Token'=$Token; 'Content-Type'='application/json' } -Body $body
}

$Q_PRODUCTS = @'
query Products($cursor:String){
  products(first:250, after:$cursor){
    edges{ cursor node{ handle metafield(namespace:"custom", key:"artikelgruppierung"){ value } } }
    pageInfo{ hasNextPage endCursor }
  }
}
'@

Write-Host 'Collecting…' -ForegroundColor Cyan
$items=@(); $cursor=$null; do{
  $resp=Invoke-AdminGQL $Q_PRODUCTS @{ cursor=$cursor }
  $edges=$resp.data.products.edges
  foreach($e in $edges){
    $n=$e.node
    $grp = $null
    if($n.metafield){ $grp = $n.metafield.value }
    if([string]::IsNullOrWhiteSpace($grp)){ continue }
    $items+=[pscustomobject]@{ handle=$n.handle; group=$grp }
  }
  $cursor=$resp.data.products.pageInfo.endCursor
  $more=$resp.data.products.pageInfo.hasNextPage
} while($more)

$map=@{}; foreach($it in $items){ $k=($it.group.ToLower() -replace "[^a-z0-9]+","-").Trim('-'); if(-not $map.ContainsKey($k)){ $map[$k]=@() } $map[$k]+=$it.handle }

$out = $map | ConvertTo-Json -Depth 5
$dst = Join-Path $PSScriptRoot '..' | Join-Path -ChildPath '..' | Join-Path -ChildPath 'theme-assets/design-groups.json'
Set-Content -Path $dst -Value $out -Encoding UTF8
Write-Host "Wrote $dst" -ForegroundColor Green
