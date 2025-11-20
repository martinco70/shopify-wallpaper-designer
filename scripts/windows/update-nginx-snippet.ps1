param(
    [string]$RemoteHost = "app.wirzapp.ch",
    [string]$User = "root",
    [string]$KeyPath = "$env:USERPROFILE/.ssh/id_ed25519",
    [string]$SnippetLocalPath = "$PSScriptRoot/../nginx/wpd-code-pdf.conf",
    [string]$RemoteSnippetPath = "/etc/nginx/snippets/wpd-code-pdf.conf",
    [string]$SiteConfPath = "/etc/nginx/sites-available/app.wirzapp.ch"
)

$ErrorActionPreference = 'Stop'

$dest = "${User}@${RemoteHost}:$RemoteSnippetPath"
Write-Host "Uploading snippet: $SnippetLocalPath -> $dest"
scp -o BatchMode=yes -i $KeyPath $SnippetLocalPath $dest

Write-Host "Checking include presence in: $SiteConfPath"
$includeState = ssh -o BatchMode=yes -i $KeyPath "${User}@${RemoteHost}" "grep -q 'include /etc/nginx/snippets/wpd-code-pdf.conf;' $SiteConfPath && echo HAS_INCLUDE || echo NO_INCLUDE"
Write-Host "Include state: $includeState"

if ($includeState -match 'NO_INCLUDE') {
    Write-Host "Inserting include into HTTPS server (after 'listen 443')"
    $remoteCmd = @'
set -e
conf="/etc/nginx/sites-available/app.wirzapp.ch"
cp "$conf" "${conf}.bak-$(date +%Y%m%d%H%M%S)"
awk 'c==0 && /listen 443/ {print; print "    include /etc/nginx/snippets/wpd-code-pdf.conf;"; c=1; next}1' "$conf" > "${conf}.tmp"
mv "${conf}.tmp" "$conf"
'@
    ssh -o BatchMode=yes -i $KeyPath "${User}@${RemoteHost}" "$remoteCmd"
}

Write-Host "Testing Nginx config"
ssh -o BatchMode=yes -i $KeyPath "${User}@${RemoteHost}" "nginx -t"

Write-Host "Reloading Nginx"
ssh -o BatchMode=yes -i $KeyPath "${User}@${RemoteHost}" "systemctl reload nginx"

Write-Host "Quick verification: curl -I -k https://$RemoteHost/ULSF9D.pdf"
ssh -o BatchMode=yes -i $KeyPath "${User}@${RemoteHost}" "curl -I -k -s https://$RemoteHost/ULSF9D.pdf | head -n 15"

Write-Host "Done. If Include state was NO_INCLUDE, add 'include /etc/nginx/snippets/wpd-code-pdf.conf;' inside the HTTPS server block and rerun this script."
