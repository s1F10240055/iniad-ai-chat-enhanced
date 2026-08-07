const path = require("node:path");
const rules = require("./webpack.rules");
const isProductionBuild =
  process.env.NODE_ENV === "production" ||
  ["package", "make", "publish"].some((command) => process.argv.includes(command));

module.exports = {
  entry: "./src/renderer/renderer.tsx",
  target: "web",
  mode: isProductionBuild ? "production" : "development",
  devtool: isProductionBuild ? false : "source-map",
  module: { rules },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  output: {
    path: path.resolve(__dirname, ".webpack/renderer"),
    filename: "renderer.js",
  },
};
