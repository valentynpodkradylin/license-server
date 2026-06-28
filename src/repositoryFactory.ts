import type { AppConfig } from "./config.js";
import { openDatabase } from "./database.js";
import { LicenseRepository, type LicenseStore } from "./licenseRepository.js";
import { NeonLicenseRepository } from "./neonLicenseRepository.js";

export interface OpenRepository {
  repository: LicenseStore;
  close(): void;
}

export async function openRepository(config: AppConfig): Promise<OpenRepository> {
  if (config.databaseUrl) {
    const repository = new NeonLicenseRepository(config.databaseUrl);
    await repository.migrate();
    return { repository, close: () => undefined };
  }

  const db = openDatabase(config.databasePath);
  return {
    repository: new LicenseRepository(db),
    close: () => db.close(),
  };
}
