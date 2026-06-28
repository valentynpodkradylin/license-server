import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { buildApp } from "./app.js";
import { getConfig } from "./config.js";
import { openRepository } from "./repositoryFactory.js";

const interceptionDirectory = path.resolve(process.cwd(), ".local-proxy");
const pfxPath = path.join(interceptionDirectory, "plugin-license.pfx");
const passwordPath = path.join(interceptionDirectory, "cert-password.txt");
const config = getConfig();
const domain = new URL(config.publicSiteUrl).hostname;

if (!fs.existsSync(pfxPath) || !fs.existsSync(passwordPath)) {
  throw new Error(
    "HTTPS interception is not configured. Run setup-interception.ps1 as Administrator.",
  );
}

const store = await openRepository(config);
const app = buildApp({ config, repository: store.repository, logger: true });

const proxy = https.createServer(
  {
    pfx: fs.readFileSync(pfxPath),
    passphrase: fs.readFileSync(passwordPath, "utf8").trim(),
  },
  (request, response) => {
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: config.port,
        method: request.method,
        path: request.url,
        headers: {
          ...request.headers,
          host: `127.0.0.1:${config.port}`,
        },
      },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.headers,
        );
        upstreamResponse.pipe(response);
      },
    );

    upstream.on("error", (error) => {
      console.error("HTTPS proxy upstream error:", error);
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "application/json" });
      }
      response.end(JSON.stringify({ error: "Local server unavailable" }));
    });

    request.pipe(upstream);
  },
);

const shutdown = async () => {
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
  await app.close();
  store.close();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await app.listen({ host: config.host, port: config.port });
  proxy.listen(443, "127.0.0.1", () => {
    console.log(
      `Intercepting https://${domain} on 127.0.0.1:443 -> http://127.0.0.1:${config.port}`,
    );
  });
} catch (error) {
  console.error(error);
  await shutdown();
  process.exit(1);
}
