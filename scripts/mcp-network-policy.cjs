"use strict";

// The bundled MCP browser is for MOOCs and its Google-hosted slides only.
// Blocking every other network destination also blocks localhost/private-network
// redirects and data exfiltration through attacker-controlled origins.
const ALLOWED_HTTPS_DOMAIN_SUFFIXES = Object.freeze([
  "iniad.org",
  "google.com",
  "googleapis.com",
  "googleusercontent.com",
  "gstatic.com",
  "ggpht.com",
]);

function isAllowedMcpBrowserUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (["about:", "blob:", "data:"].includes(parsed.protocol)) return true;
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "wss:") ||
    parsed.username ||
    parsed.password
  ) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  return ALLOWED_HTTPS_DOMAIN_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
  );
}

function installPlaywrightNetworkPolicy(playwright) {
  for (const browserName of ["chromium", "firefox", "webkit"]) {
    const browserType = playwright?.[browserName];
    if (!browserType || browserType.__iniadNetworkPolicyInstalled) continue;

    const originalLaunchPersistentContext =
      browserType.launchPersistentContext.bind(browserType);
    Object.defineProperty(browserType, "__iniadNetworkPolicyInstalled", {
      value: true,
      enumerable: false,
    });
    browserType.launchPersistentContext = async (userDataDir, options = {}) => {
      const context = await originalLaunchPersistentContext(userDataDir, {
        ...options,
        serviceWorkers: "block",
      });
      try {
        await context.route("**/*", (route) =>
          isAllowedMcpBrowserUrl(route.request().url())
            ? route.continue()
            : route.abort("blockedbyclient")
        );
        if (typeof context.routeWebSocket !== "function") {
          throw new Error("Playwright WebSocket routing is required by the MCP network policy");
        }
        await context.routeWebSocket("**/*", async (webSocket) => {
          if (isAllowedMcpBrowserUrl(webSocket.url())) {
            webSocket.connectToServer();
            return;
          }
          await webSocket.close({ code: 1008, reason: "Blocked by MCP network policy" });
        });
        return context;
      } catch (error) {
        await context.close().catch(() => undefined);
        throw error;
      }
    };
  }
}

module.exports = { isAllowedMcpBrowserUrl, installPlaywrightNetworkPolicy };
