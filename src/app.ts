import crypto from "node:crypto";
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
import {
  LicenseRepository,
  type LicenseRow,
  type LicenseStore,
} from "./licenseRepository.js";

interface BuildOptions {
  config: AppConfig;
  db?: SqliteDatabase;
  repository?: LicenseStore;
  fetchImpl?: FetchLike;
  logger?: boolean;
}

function licenseStatus(license: LicenseRow): string {
  if (license.blocked === 1) return "blocked";
  if (
    license.status === "active" &&
    license.expires_at !== null &&
    new Date(license.expires_at).getTime() <= Date.now()
  ) {
    return "expired";
  }
  return license.status;
}

function licenseFailure(license: LicenseRow | undefined): 404 | 403 | null {
  if (!license) return 404;
  return licenseStatus(license) === "active" ? null : 403;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1));
  }
  return cookies;
}

function sessionValue(config: AppConfig): string | null {
  if (!config.adminUsername || !config.adminPassword) return null;
  return crypto
    .createHmac("sha256", config.adminPassword)
    .update(config.adminUsername)
    .digest("hex");
}

function isAdmin(request: { headers: { cookie?: string } }, config: AppConfig): boolean {
  const expected = sessionValue(config);
  const actual = parseCookies(request.headers.cookie).admin_session;
  if (!expected || !actual || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function parseForm(body: unknown): URLSearchParams {
  return new URLSearchParams(typeof body === "string" ? body : "");
}

export function buildApp(options: BuildOptions) {
  const app = Fastify({
    logger: options.logger ? { level: options.config.logLevel } : false,
  });
  const repository = options.repository ?? new LicenseRepository(options.db!);

  app.addContentTypeParser(
    "text/plain",
    { parseAs: "string" },
    (_request, body, done) => done(null, body),
  );
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => done(null, body),
  );

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/admin/login", async (_request, reply) =>
    reply.type("text/html").send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Admin login</title>
<style>body{font-family:system-ui;margin:2rem;max-width:42rem}label,input,button{display:block;margin:.5rem 0}input{padding:.5rem;width:100%;box-sizing:border-box}button{padding:.5rem .8rem}</style></head>
<body><h1>Admin</h1><form method="post" action="/admin/login">
<label>Username<input name="username" autocomplete="username"></label>
<label>Password<input name="password" type="password" autocomplete="current-password"></label>
<button>Log in</button></form></body></html>`),
  );

  app.post("/admin/login", async (request, reply) => {
    const form = parseForm(request.body);
    const ok =
      options.config.adminUsername &&
      options.config.adminPassword &&
      form.get("username") === options.config.adminUsername &&
      form.get("password") === options.config.adminPassword;
    if (!ok) return reply.code(401).type("text/plain").send("Unauthorized");
    const secure = options.config.publicSiteUrl.startsWith("https://");
    return reply
      .header(
        "set-cookie",
        `admin_session=${sessionValue(options.config)}; HttpOnly; SameSite=Lax; Path=/${secure ? "; Secure" : ""}`,
      )
      .redirect("/admin");
  });

  app.post("/admin/logout", async (_request, reply) =>
    reply
      .header(
        "set-cookie",
        "admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      )
      .redirect("/admin/login"),
  );

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/admin") || request.url.startsWith("/admin/login")) return;
    if (!isAdmin(request, options.config)) return reply.redirect("/admin/login");
  });

  app.get("/admin", async (_request, reply) => {
    const licenses = await repository.listLicenses();
    const rows = licenses
      .map(
        (license) => `<tr>
<td>${escapeHtml(license.key)}</td>
<td>${escapeHtml(licenseStatus(license))}</td>
<td>${license.expires_at ? escapeHtml(license.expires_at) : "never"}</td>
<td>${escapeHtml(license.created_at)}</td>
<td><form method="post" action="/admin/licenses/${encodeURIComponent(license.key)}/${license.blocked ? "restore" : "revoke"}"><button>${license.blocked ? "Restore" : "Revoke"}</button></form></td>
</tr>`,
      )
      .join("");
    return reply.type("text/html").send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Licenses</title>
<style>body{font-family:system-ui;margin:2rem}table{border-collapse:collapse;width:100%;margin-top:1rem}td,th{border:1px solid #ddd;padding:.45rem;text-align:left}input,button{padding:.45rem;margin:.25rem}form{display:inline}section form{display:block}</style></head>
<body><form method="post" action="/admin/logout"><button>Log out</button></form>
<h1>Licenses</h1><section><form method="post" action="/admin/licenses">
<input name="key" placeholder="License key">
<input name="expires_at" placeholder="Expires at, ISO date or empty">
<button>Create</button></form></section>
<table><thead><tr><th>Key</th><th>Status</th><th>Expires</th><th>Created</th><th></th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`);
  });

  app.post("/admin/licenses", async (request, reply) => {
    const form = parseForm(request.body);
    const key = form.get("key")?.trim() || crypto.randomUUID();
    const expires = form.get("expires_at")?.trim();
    const expiresDate = expires ? new Date(expires) : null;
    if (expiresDate && Number.isNaN(expiresDate.getTime())) {
      return reply.code(400).type("text/plain").send("Invalid expires_at");
    }
    const expiresAt = expiresDate ? expiresDate.toISOString() : null;
    await repository.createLicense(key, expiresAt);
    return reply.redirect("/admin");
  });

  app.post("/admin/licenses/:key/revoke", async (request, reply) => {
    const { key } = request.params as { key: string };
    if (!(await repository.setBlocked(key, true))) return reply.code(404).send("Not found");
    return reply.redirect("/admin");
  });

  app.post("/admin/licenses/:key/restore", async (request, reply) => {
    const { key } = request.params as { key: string };
    if (!(await repository.setBlocked(key, false))) return reply.code(404).send("Not found");
    return reply.redirect("/admin");
  });

  app.post("/api/license/activate", async (request, reply) => {
    const body = request.body as { key?: unknown; deviceId?: unknown } | null;
    if (
      !body ||
      typeof body.key !== "string" ||
      body.key.trim() === "" ||
      typeof body.deviceId !== "string" ||
      !/^[a-fA-F0-9]{64}$/.test(body.deviceId)
    ) {
      await repository.audit("activate", null, null, "invalid_request");
      return reply.code(400).send({ error: "Invalid request" });
    }

    const key = body.key.trim();
    const failure = licenseFailure(await repository.getLicense(key));
    if (failure) {
      await repository.audit(
        "activate",
        key,
        body.deviceId,
        failure === 404 ? "not_found" : "forbidden",
      );
      return reply
        .code(failure)
        .send({ error: failure === 404 ? "License not found" : "License inactive" });
    }

    await repository.recordActivation(key, body.deviceId);
    await repository.audit("activate", key, body.deviceId, "success");
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
      const failure = licenseFailure(await repository.getLicense(identity.key));
      await repository.audit(
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
      await repository.audit("status", null, null, "invalid_request");
      return reply.code(400).send("Invalid request");
    }
  });

  app.post("/api/license/update", async (request, reply) => {
    try {
      const identity = parseIdentity(request.body);
      if (licenseFailure(await repository.getLicense(identity.key))) {
        return reply.code(403).send("Forbidden");
      }
      const update = await repository.getActiveUpdate();
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
      if (licenseFailure(await repository.getLicense(identity.key))) {
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
