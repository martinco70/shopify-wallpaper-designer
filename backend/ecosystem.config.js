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
        // Optional: SHOPIFY_SHOP, SHOPIFY_ACCESS_TOKEN, etc. werden aus Shell/.env übernommen
        // PDF_TOKEN_SECRET kann hier gesetzt werden oder außerhalb als Umgebungsvariable
      }
    }
  ]
};
