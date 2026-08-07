"use strict";

const fs = require("node:fs");
const path = require("node:path");

// The upstream MCP server currently reads these values from process.env when a
// login tool is called. Keep that API available inside this process, but hide
// the keys from environment enumeration so Playwright and any other descendant
// process cannot inherit the credentials.
const credentialValues = Object.freeze({
  INIAD_USERNAME: process.env.INIAD_USERNAME,
  INIAD_PASSWORD: process.env.INIAD_PASSWORD,
});
const inheritedEnvironment = process.env;
delete inheritedEnvironment.INIAD_USERNAME;
delete inheritedEnvironment.INIAD_PASSWORD;

process.env = new Proxy(inheritedEnvironment, {
  get(target, property) {
    if (property === "INIAD_USERNAME" || property === "INIAD_PASSWORD") {
      return credentialValues[property];
    }
    return target[property];
  },
  has(target, property) {
    if (property === "INIAD_USERNAME" || property === "INIAD_PASSWORD") {
      return credentialValues[property] !== undefined;
    }
    return property in target;
  },
  ownKeys(target) {
    return Reflect.ownKeys(target);
  },
});

const cliPath = process.argv[2];
if (!cliPath || !path.isAbsolute(cliPath)) {
  throw new Error("A trusted absolute MCP CLI path is required");
}

const resolvedCliPath = fs.realpathSync(cliPath);
if (!fs.statSync(resolvedCliPath).isFile()) {
  throw new Error("The MCP CLI path is not a file");
}

// Install request interception before the MCP CLI imports Playwright. This
// covers top-level redirects and every page subresource, not only tool input.
const { installPlaywrightNetworkPolicy } = require("./mcp-network-policy.cjs");
installPlaywrightNetworkPolicy(require("playwright"));

// Make Commander see the MCP CLI as argv[1], not this credential guard.
process.argv.splice(1, 1);
require(resolvedCliPath);
