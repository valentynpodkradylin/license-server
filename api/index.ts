import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import { openRepository } from "../src/repositoryFactory.js";

let appPromise: Promise<FastifyInstance> | undefined;

async function getApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = (async () => {
      const config = getConfig({ host: "0.0.0.0" });
      const store = await openRepository(config);
      const app = buildApp({ config, repository: store.repository, logger: true });
      await app.ready();
      return app;
    })();
  }
  return appPromise;
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const app = await getApp();
  app.server.emit("request", request, response);
}
