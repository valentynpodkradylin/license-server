import { buildApp } from "./app.js";
import { getConfig } from "./config.js";
import { openDatabase } from "./database.js";

const config = getConfig();
const db = openDatabase(config.databasePath);
const app = buildApp({ config, db, logger: true });

const shutdown = async () => {
  await app.close();
  db.close();
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
