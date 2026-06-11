import { parseArgs } from "node:util";
import { getConfig } from "./config.js";
import { openDatabase } from "./database.js";
import { LicenseRepository } from "./licenseRepository.js";

const command = process.argv[2];
const { values } = parseArgs({
  args: process.argv.slice(3),
  options: {
    key: { type: "string" },
    expires: { type: "string" },
    version: { type: "string" },
    notes: { type: "string" },
    link: { type: "string" },
  },
  strict: true,
});

const db = openDatabase(getConfig().databasePath);
const repository = new LicenseRepository(db);

try {
  switch (command) {
    case "license:create": {
      if (!values.key) throw new Error("--key is required");
      const expiresAt = values.expires
        ? new Date(values.expires).toISOString()
        : null;
      repository.createLicense(values.key, expiresAt);
      console.log(`Created license ${values.key}`);
      break;
    }
    case "license:list":
      console.table(repository.listLicenses());
      break;
    case "license:revoke":
    case "license:restore": {
      if (!values.key) throw new Error("--key is required");
      const blocked = command === "license:revoke";
      if (!repository.setBlocked(values.key, blocked)) {
        throw new Error(`License ${values.key} was not found`);
      }
      console.log(`${blocked ? "Revoked" : "Restored"} license ${values.key}`);
      break;
    }
    case "update:set": {
      if (!values.version || !values.notes || !values.link) {
        throw new Error("--version, --notes and --link are required");
      }
      repository.setUpdate(values.version, values.notes, values.link);
      console.log(`Activated update ${values.version}`);
      break;
    }
    default:
      throw new Error(`Unknown command: ${command ?? "(missing)"}`);
  }
} finally {
  db.close();
}
