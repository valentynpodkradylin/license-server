import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import type { AppConfig } from "./config.js";
import type { SqliteDatabase } from "./database.js";
import { fetchForecast, type FetchLike } from "./forecast.js";
import { encodeLegacyLicense } from "./legacyLicenseCodec.js";
import {
  clientVersion,
  decodeLicenseIdentity,
  isNewerVersion,
} from "./licenseProtocol.js";
import { LicenseRepository, type LicenseRow } from "./licenseRepository.js";

interface BuildOptions {
  config: AppConfig;
  db: SqliteDatabase;
  fetchImpl?: FetchLike;
  logger?: boolean;
}

function licenseFailure(license: LicenseRow | undefined): 404 | 403 | null {
  if (!license) return 404;
  if (
    license.blocked === 1 ||
    license.status !== "active" ||
    (license.expires_at !== null &&
      new Date(license.expires_at).getTime() <= Date.now())
  ) {
    return 403;
  }
  return null;
}

export function buildApp(options: BuildOptions) {
  const app = Fastify({
    logger: options.logger ? { level: options.config.logLevel } : false,
  });
  const repository = new LicenseRepository(options.db);

  app.addContentTypeParser(
    "text/plain",
    { parseAs: "string" },
    (_request, body, done) => done(null, body),
  );

  app.get("/health", async () => ({ status: "ok" }));

  app.post("/api/license/activate", async (request, reply) => {
    const body = request.body as { key?: unknown; deviceId?: unknown } | null;
    if (
      !body ||
      typeof body.key !== "string" ||
      body.key.trim() === "" ||
      typeof body.deviceId !== "string" ||
      !/^[a-fA-F0-9]{64}$/.test(body.deviceId)
    ) {
      repository.audit("activate", null, null, "invalid_request");
      return reply.code(400).send({ error: "Invalid request" });
    }

    const key = body.key.trim();
    const failure = licenseFailure(repository.getLicense(key));
    if (failure) {
      repository.audit(
        "activate",
        key,
        body.deviceId,
        failure === 404 ? "not_found" : "forbidden",
      );
      return reply
        .code(failure)
        .send({ error: failure === 404 ? "License not found" : "License inactive" });
    }

    repository.recordActivation(key, body.deviceId);
    repository.audit("activate", key, body.deviceId, "success");
    return reply
      .type("text/plain")
      .send(encodeLegacyLicense(key, body.deviceId));
  });

  const parseIdentity = (value: unknown) => {
    if (typeof value !== "string") throw new Error("Invalid identity");
    return decodeLicenseIdentity(value.trim());
  };

  app.post("/api/license/status", async (request, reply) => {
    try {
      const identity = parseIdentity(request.body);
      const failure = licenseFailure(repository.getLicense(identity.key));
      repository.audit(
        "status",
        identity.key,
        identity.deviceId,
        failure ? "forbidden" : "success",
      );
      if (failure) return reply.code(403).send("Forbidden");
      return reply
        .type("text/plain")
        .send(Buffer.from("status:000001:1", "utf8").toString("base64"));
    } catch {
      repository.audit("status", null, null, "invalid_request");
      return reply.code(400).send("Invalid request");
    }
  });

  app.post("/api/license/update", async (request, reply) => {
    try {
      const identity = parseIdentity(request.body);
      if (licenseFailure(repository.getLicense(identity.key))) {
        return reply.code(403).send("Forbidden");
      }
      const update = repository.getActiveUpdate();
      if (!update || !isNewerVersion(update.version, clientVersion)) {
        return reply.code(204).send();
      }
      return {
        version: update.version,
        notes: update.notes,
        link: update.link,
      };
    } catch {
      return reply.code(400).send("Invalid request");
    }
  });

  app.get("/downloads/:filename", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    if (filename !== path.basename(filename)) return reply.code(404).send();
    const filePath = path.join(options.config.downloadsPath, filename);
    if (!fs.existsSync(filePath)) return reply.code(404).send();
    return reply.type("application/octet-stream").send(fs.createReadStream(filePath));
  });

  app.post("/api/forecast", async (request, reply) => {
    try {
      const identity = parseIdentity(request.headers["x-api-key"]);
      if (licenseFailure(repository.getLicense(identity.key))) {
        return reply.code(403).send({ error: "Forbidden" });
      }
      const body = request.body as Record<string, unknown> | null;
      if (
        !body ||
        typeof body.latitude !== "number" ||
        body.latitude < -90 ||
        body.latitude > 90 ||
        typeof body.longitude !== "number" ||
        body.longitude < -180 ||
        body.longitude > 180 ||
        (body.altitude !== 10 && body.altitude !== 100) ||
        typeof body.date !== "string"
      ) {
        return reply.code(400).send({ error: "Invalid request" });
      }
      return await fetchForecast(
        options.config.openMeteoUrl,
        {
          latitude: body.latitude,
          longitude: body.longitude,
          altitude: body.altitude,
          date: body.date,
        },
        options.fetchImpl,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("Base64") ||
          error.message.includes("identity") ||
          error.message.includes("client") ||
          error.message.includes("date"))
      ) {
        return reply.code(400).send({ error: "Invalid request" });
      }
      request.log.error(error);
      return reply.code(503).send({ error: "Forecast service unavailable" });
    }
  });

  return app;
}
