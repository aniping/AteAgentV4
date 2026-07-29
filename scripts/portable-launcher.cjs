"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("node:util");

function parsePortableLaunchOptions(args = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: "string", short: "p" },
      hostname: { type: "string", short: "H" },
    },
    strict: true,
  });

  const hostname = (values.hostname ?? env.PI_WEB_HOSTNAME ?? "0.0.0.0").trim();
  if (!hostname) throw new Error("hostname must not be empty");

  const rawPort = values.port ?? env.PORT ?? "30141";
  if (!/^\d+$/.test(rawPort)) throw new Error("port must be an integer between 1 and 65535");
  const port = Number(rawPort);
  if (port < 1 || port > 65535) throw new Error("port must be an integer between 1 and 65535");

  return { hostname, port };
}

function launch() {
  const { hostname, port } = parsePortableLaunchOptions();
  process.env.HOSTNAME = hostname;
  process.env.PI_WEB_HOSTNAME = hostname;
  process.env.PORT = String(port);

  console.log(`ATE Agent is starting on http://${hostname}:${port}`);
  if (hostname === "0.0.0.0") {
    console.log(`Other computers can open http://<this-computer-LAN-IP>:${port}`);
    console.warn("Only use this package on a trusted network; ATE Agent has no application-level authentication.");
  }

  const appRoot = path.join(__dirname, "app");
  process.chdir(appRoot);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(path.join(appRoot, "server.js"));
}

if (require.main === module) {
  try {
    launch();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = { parsePortableLaunchOptions };
