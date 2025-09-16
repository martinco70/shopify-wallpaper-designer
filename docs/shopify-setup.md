# Shopify app setup

1) App credentials
- In Shopify Partners, create (or open) your app.
- Copy API key and API secret into backend/.env (or server env):
  - SHOPIFY_API_KEY=...
  - SHOPIFY_API_SECRET=...
  - SHOPIFY_SCOPES=read_products (adjust later as needed)

2) App URLs
- App URL: https://app.wirzapp.ch/app
- Allowed redirection URL(s): https://app.wirzapp.ch/auth/callback

3) Install the app
- Visit: https://app.wirzapp.ch/app?shop=<your-shop>.myshopify.com
- Click "Jetzt installieren" to start OAuth.

4) Test
- Open "Shopify Health prüfen". You should see ok: true with your shop domain.

Notes
- If upload previews fail for PDFs/EPS, ensure ImageMagick and Ghostscript are installed and that backend/im-policy/policy.xml is used via MAGICK_CONFIGURE_PATH.
- PM2 manages the process as wallpaper-backend.
