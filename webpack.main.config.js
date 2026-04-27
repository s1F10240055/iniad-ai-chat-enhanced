const path = require('node:path');
const rules = require('./webpack.rules');

module.exports = {
  entry: './src/main/index.ts',
  target: 'electron-main',
  mode: 'development',
  devtool: 'source-map',
  module: { rules },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  output: {
    path: path.resolve(__dirname, '.webpack/main'),
    filename: 'index.js',
  },
};
