import { buildApp } from "./app.js";
import { getConfig } from "./config.js";
import { openRepository } from "./repositoryFactory.js";

const config = getConfig();
const store = await openRepository(config);
const app = buildApp({ config, repository: store.repository, logger: true });

const shutdown = async () => {
  await app.close();
  store.close();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await shutdown();
  process.exit(1);
}
