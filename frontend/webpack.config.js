const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

// Export a factory to access argv.mode ('production' when invoked with --mode production)
module.exports = (env, argv) => {
  const isProd = (argv && argv.mode) === 'production';
  return {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    // Strong cache-busting in production via contenthash in filename
    filename: isProd ? 'main.[contenthash].js' : 'main.js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-react', '@babel/preset-env'],
          },
        },
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/index.html',
      // Let the hashed filename handle cache-busting; avoid extra query strings
      hash: false,
      scriptLoading: 'defer',
    }),
  ],
  devServer: {
    static: path.join(__dirname, 'dist'),
    port: process.env.PORT ? Number(process.env.PORT) : 8080,
    open: true,
    host: 'localhost',
    proxy: [
      {
        context: ['/upload', '/uploads', '/config', '/price', '/variant', '/import'],
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    ],
  },
  mode: (argv && argv.mode) ? argv.mode : 'development',
  };
};
