import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(
  fs.readFileSync(path.join(root, "config.json"), "utf8"),
);
const upstream = new URL(config.upstreamUrl);
const proxyDirectory = path.join(root, ".local-proxy");
const pfxPath = path.join(proxyDirectory, "interceptor.pfx");
const passwordPath = path.join(proxyDirectory, "cert-password.txt");

if (upstream.protocol !== "https:") {
  throw new Error("upstreamUrl must use HTTPS");
}
if (upstream.hostname === config.interceptDomain) {
  throw new Error("interceptDomain and upstreamUrl must use different domains");
}
if (!fs.existsSync(pfxPath) || !fs.existsSync(passwordPath)) {
  throw new Error("Run setup-interception.ps1 as Administrator first");
}

const server = https.createServer(
  {
    pfx: fs.readFileSync(pfxPath),
    passphrase: fs.readFileSync(passwordPath, "utf8").trim(),
  },
  (request, response) => {
    if (!request.url?.startsWith("/")) {
      response.writeHead(400).end();
      return;
    }

    const target = new URL(request.url, upstream);
    const upstreamRequest = https.request(
      {
        hostname: upstream.hostname,
        port: upstream.port || 443,
        method: request.method,
        path: target.pathname + target.search,
        headers: { ...request.headers, host: upstream.host },
      },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.headers,
        );
        upstreamResponse.pipe(response);
      },
    );

    upstreamRequest.on("error", (error) => {
      console.error("Upstream error:", error.message);
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.pipe(upstreamRequest);
  },
);

server.listen(443, "127.0.0.1", () => {
  console.log(
    `Intercepting https://${config.interceptDomain} -> ${upstream.origin}`,
  );
  console.log("Keep this window open while using the plugin.");
});

process.on("SIGINT", () => server.close());
process.on("SIGTERM", () => server.close());
