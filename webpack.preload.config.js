const path = require("node:path");
const rules = require("./webpack.rules");

module.exports = {
  entry: "./src/preload/preload.ts",
  target: "web",
  mode: "development",
  devtool: "source-map",
  module: { rules },
  resolve: {
    extensions: [".ts", ".js"],
  },
  output: {
    path: path.resolve(__dirname, ".webpack/preload"),
    filename: "preload.js",
  },
};
