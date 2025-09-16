# VPS setup (stable, low-cost) for Shopify Wallpaper Designer

This guide gets a small Ubuntu VPS production-ready for your app with a custom domain, HTTPS, large uploads, ImageMagick/Ghostscript, and solid security/basics.

Works on Ubuntu 22.04/24.04. Replace placeholders:
- USER = your linux username
- DOMAIN = your domain (e.g., example.ch)
- APP_HOST = app subdomain (e.g., app.example.ch)
- PUBLIC_IP = your server IPv4

## Baseline
- Provider: Hetzner CX22 (or similar) with 2–4 vCPU, 4–8 GB RAM, 80–160 GB disk. Add extra volume if you expect very large uploads.
- OS: Ubuntu LTS.
- App listens on 127.0.0.1:3001, Nginx terminates TLS on 443.
- Storage: keep uploads on a dedicated folder/volume; previews can be purged.

## 1) Create user, SSH hardening
```bash
# On your local machine
ssh-keygen -t ed25519 -C "you@example.com"
# copy public key to server (use provider console to set a temporary password or cloud-init)
ssh-copy-id USER@PUBLIC_IP

# On the server (first login as root or via provider console)
adduser USER
usermod -aG sudo USER
mkdir -p /home/USER/.ssh && chmod 700 /home/USER/.ssh
# paste your public key into:
nano /home/USER/.ssh/authorized_keys
chmod 600 /home/USER/.ssh/authorized_keys && chown -R USER:USER /home/USER/.ssh

# SSH daemon hardening
sudo nano /etc/ssh/sshd_config
# Ensure:
# PermitRootLogin no
# PasswordAuthentication no
# PubkeyAuthentication yes
sudo systemctl reload ssh
```

Windows quick notes:
- Keys are stored under: C:\Users\<YourUser>\.ssh\
- Public key file to share: id_ed25519.pub (never share id_ed25519)
- Show your public key in PowerShell:
    - `Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub"`
- If you don’t have a key yet, generate in PowerShell:
    - `ssh-keygen -t ed25519 -C "you@example.com"`
- If `ssh-copy-id` isn’t available on Windows, paste the .pub content into the provider’s “SSH Keys” UI or onto the server at `/home/USER/.ssh/authorized_keys`.

## 2) Firewall (UFW)
```bash
sudo apt update && sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

## 3) Nginx + TLS (Let's Encrypt)
```bash
sudo apt install -y nginx
sudo apt install -y certbot python3-certbot-nginx

# Nginx site
sudo tee /etc/nginx/sites-available/app.conf > /dev/null <<'CONF'
server {
    listen 80;
    server_name APP_HOST;

    # ACME + redirect to HTTPS once cert exists
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name APP_HOST;

    # SSL will be injected by certbot

    # Increase limits for large uploads and long previews
    client_max_body_size 100G;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    proxy_request_buffering off;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
CONF

sudo ln -s /etc/nginx/sites-available/app.conf /etc/nginx/sites-enabled/app.conf
sudo nginx -t && sudo systemctl reload nginx

# Obtain certificate
sudo certbot --nginx -d APP_HOST --non-interactive --agree-tos -m you@example.com
# Auto-renew
systemctl list-timers | grep certbot || sudo systemctl enable --now certbot.timer
```

## 4) Node.js + PM2 service
```bash
# Node LTS
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2

# App directory
sudo mkdir -p /opt/wallpaper-app && sudo chown -R USER:USER /opt/wallpaper-app
cd /opt/wallpaper-app
# Pull your code (git clone or SFTP) and install
# Example:
# git clone https://your-repo.git .
# npm ci --prefix backend
# npm ci --prefix frontend

# .env
cp backend/ENV_TO_FILL.txt backend/.env
nano backend/.env
# Set APP_URL=https://APP_HOST (and Shopify keys later)

# Start app
pm2 start backend/index.js --name wallpaper-backend --time
pm2 save
pm2 startup systemd
# Follow PM2 prompt to run the generated command, then:
sudo systemctl enable pm2-$(whoami)
```

## 5) ImageMagick & Ghostscript
```bash
sudo apt install -y imagemagick ghostscript
# Optional: verify delegates
magick -version | sed -n '/Delegates/,$p'
```

## 6) Storage and cleanup
```bash
# Ensure sufficient space for uploads
sudo mkdir -p /opt/wallpaper-app/uploads /opt/wallpaper-app/uploads/previews
sudo chown -R USER:USER /opt/wallpaper-app/uploads

# Logrotate for Nginx and PM2 logs is usually present; ensure retention is reasonable
sudo nano /etc/logrotate.d/nginx
sudo pm2 install pm2-logrotate && pm2 set pm2-logrotate:max_size 100M && pm2 set pm2-logrotate:retain 14 && pm2 save

# (Optional) Cron to purge old previews
crontab -e
# Add, e.g.: purge previews older than 7 days
# 15 3 * * * find /opt/wallpaper-app/uploads/previews -type f -mtime +7 -delete
```

## 7) Backups
- Minimum viable:
  - Provider snapshots: daily, keep 7–14 days.
  - Offsite: restic or rsync to object storage (Backblaze B2/S3). Backup:
    - /opt/wallpaper-app/uploads (originals)
    - backend/.env (secrets)
    - optional DB (if later added)
- Exclude previews cache; it can be regenerated.

Example with restic (B2/S3):
```bash
# Install restic
sudo apt install -y restic
# Export env vars for repo and credentials (use systemd timer instead of plain cron for secrets)
# Create a systemd service + timer that runs: restic backup /opt/wallpaper-app/uploads
```

## 8) Security hygiene
```bash
# Basic protections
sudo apt install -y fail2ban unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades

# Keep Node behind Nginx; ensure backend binds to 127.0.0.1 only
# In PM2 ecosystem or app, set HOST=127.0.0.1 and PORT=3001 (or use default binding)

# Extra: set ImageMagick policy to safe defaults (already in repo for PDF/EPS preview)
```

## 9) DNS records
- A @ -> PUBLIC_IP
- A APP_HOST -> PUBLIC_IP
- CNAME www -> @ (optional)
- If using Cloudflare: set proxy off (DNS-only) while issuing certs, then optionally enable orange proxy.

## 10) Shopify settings
- App URL: https://APP_HOST/app
- Redirect URLs: https://APP_HOST/auth/callback
- Embedded app: enabled; set CSP frame-ancestors to include https://*.myshopify.com

## 11) Monitoring (optional but useful)
- Uptime Kuma or healthchecks; alert on 4xx/5xx and disk < 15% free.
- pm2 monit for quick checks.

## 12) Placement groups?
- Not needed for a single VPS. Placement/anti-affinity only matters when you run multiple servers for HA. Start simple; add redundancy later if required.
