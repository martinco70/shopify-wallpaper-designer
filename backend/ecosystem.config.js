module.exports = {
  apps: [
    {
      name: 'wallpaper-backend',
      script: 'index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3001,
        // Ensure Express serves the deployed Designer bundle in production
        DESIGNER_STATIC_DIR: process.env.DESIGNER_STATIC_DIR || '/opt/wallpaper-app/public/designer',
        // Optional: SHOPIFY_SHOP, SHOPIFY_ACCESS_TOKEN, etc. werden aus Shell/.env übernommen
        // PDF_TOKEN_SECRET kann hier gesetzt werden oder außerhalb als Umgebungsvariable
      }
    }
  ]
};
