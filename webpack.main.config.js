const path = require('node:path');
const fs = require('node:fs');
const webpack = require('webpack');
const rules = require('./webpack.rules');

const runtimeIntegrityPath = path.resolve(__dirname, '.mcp-runtime', 'integrity.json');
const lectureIndexFiles = ['slides-index.json', 'syllabus-index.json'];
const isProductionBuild = ['package', 'make', 'publish'].some((command) =>
  process.argv.includes(command)
);

class LectureIndexAssetsPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('LectureIndexAssetsPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'LectureIndexAssetsPlugin',
          stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        () => {
          for (const fileName of lectureIndexFiles) {
            const sourcePath = path.resolve(__dirname, 'data', fileName);
            compilation.emitAsset(
              `data/${fileName}`,
              new webpack.sources.RawSource(fs.readFileSync(sourcePath))
            );
          }
        }
      );
    });
  }
}

module.exports = {
  entry: './src/main/index.ts',
  target: 'electron-main',
  mode: isProductionBuild ? 'production' : 'development',
  devtool: isProductionBuild ? false : 'source-map',
  module: { rules },
  plugins: [
    new LectureIndexAssetsPlugin(),
    new webpack.DefinePlugin({
      __MCP_RUNTIME_TREE_SHA256__: webpack.DefinePlugin.runtimeValue(
        () => {
          const integrity = JSON.parse(fs.readFileSync(runtimeIntegrityPath, 'utf8'));
          if (!/^[a-f0-9]{64}$/.test(integrity.treeSha256)) {
            throw new Error('Invalid generated MCP runtime integrity hash');
          }
          return JSON.stringify(integrity.treeSha256);
        },
        { fileDependencies: [runtimeIntegrityPath] }
      ),
    }),
  ],
  resolve: {
    extensions: ['.ts', '.js'],
  },
  output: {
    path: path.resolve(__dirname, '.webpack/main'),
    filename: 'index.js',
  },
};
