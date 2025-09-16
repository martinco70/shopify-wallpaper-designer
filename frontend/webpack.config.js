const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'main.js',
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
      hash: true, // append unique webpack hash to assets for cache-busting
    }),
  ],
  devServer: {
    static: path.join(__dirname, 'dist'),
  port: process.env.PORT ? Number(process.env.PORT) : 8080,
    open: true,
    host: 'localhost',
    proxy: [
      {
        context: ['/upload', '/uploads', '/config', '/price', '/variant'],
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false
      }
    ]
  },
  mode: 'development',
};
