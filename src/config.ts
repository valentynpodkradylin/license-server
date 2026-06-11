import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv();

export interface AppConfig {
  host: string;
  port: number;
  databasePath: string;
  openMeteoUrl: string;
  logLevel: string;
  downloadsPath: string;
}

export function getConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const cwd = process.cwd();
  return {
    host: overrides.host ?? process.env.HOST ?? "127.0.0.1",
    port: overrides.port ?? Number(process.env.PORT ?? 8080),
    databasePath:
      overrides.databasePath ??
      path.resolve(cwd, process.env.DATABASE_PATH ?? "./data/licenses.sqlite"),
    openMeteoUrl:
      overrides.openMeteoUrl ??
      process.env.OPEN_METEO_URL ??
      "https://api.open-meteo.com/v1/forecast",
    logLevel: overrides.logLevel ?? process.env.LOG_LEVEL ?? "info",
    downloadsPath:
      overrides.downloadsPath ?? path.resolve(cwd, "downloads"),
  };
}
