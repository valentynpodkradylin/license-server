import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { getConfig } from "../src/config.js";
import { openDatabase, type SqliteDatabase } from "../src/database.js";
import {
  decodeLikeCSharp,
  sha256Hex,
} from "../src/legacyLicenseCodec.js";
import { LicenseRepository } from "../src/licenseRepository.js";

const deviceA = "a".repeat(64);
const deviceB = "b".repeat(64);
const key = "LICENSE-KEY-1234567890AB";
const identity = (licenseKey = key, deviceId = deviceA, client = "OHFlightBuilder@1.12.0") =>
  Buffer.from(`${licenseKey}:${deviceId}:${client}`, "utf8").toString("base64");

let db: SqliteDatabase;
let repository: LicenseRepository;
let app: FastifyInstance;
let requestedUrl = "";

beforeEach(async () => {
  db = openDatabase(":memory:");
  repository = new LicenseRepository(db);
  repository.createLicense(key, null);
  app = buildApp({
    config: getConfig({
      databasePath: ":memory:",
      downloadsPath: process.cwd(),
      openMeteoUrl: "https://example.test/forecast",
      adminUsername: "admin",
      adminPassword: "secret",
      publicSiteUrl: "http://127.0.0.1:8080",
    }),
    db,
    fetchImpl: async (input) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          hourly: {
            time: [
              "2026-06-10T11:00",
              "2026-06-10T12:00",
              "2026-06-10T13:00",
            ],
            wind_speed_10m: [1, 2, 3],
            wind_direction_10m: [10, 20, 30],
            wind_speed_100m: [4, 5, 6],
            wind_direction_100m: [40, 50, 60],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

test("health reports that the server is ready", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/health",
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
});

test("admin requires login and accepts the configured credentials", async () => {
  const locked = await app.inject({ method: "GET", url: "/admin" });
  assert.equal(locked.statusCode, 302);
  assert.equal(locked.headers.location, "/admin/login");

  const rejected = await app.inject({
    method: "POST",
    url: "/admin/login",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ username: "admin" }).toString(),
  });
  assert.equal(rejected.statusCode, 401);

  const login = await app.inject({
    method: "POST",
    url: "/admin/login",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({
      username: "admin",
      password: "secret",
    }).toString(),
  });
  assert.equal(login.statusCode, 302);
  const cookie = login.headers["set-cookie"];
  assert.ok(cookie);

  const open = await app.inject({
    method: "GET",
    url: "/admin",
    headers: { cookie: Array.isArray(cookie) ? cookie[0] : cookie },
  });
  assert.equal(open.statusCode, 200);
  assert.match(open.body, /LICENSE-KEY-1234567890AB/);
});

test("admin creates perpetual and expiring licenses", async () => {
  const login = await app.inject({
    method: "POST",
    url: "/admin/login",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({
      username: "admin",
      password: "secret",
    }).toString(),
  });
  const cookie = login.headers["set-cookie"];
  const cookieHeader = Array.isArray(cookie) ? cookie[0] : cookie;
  assert.ok(cookieHeader);

  const forever = await app.inject({
    method: "POST",
    url: "/admin/licenses",
    headers: {
      cookie: cookieHeader,
      "content-type": "application/x-www-form-urlencoded",
    },
    payload: new URLSearchParams({ key: "FOREVER" }).toString(),
  });
  assert.equal(forever.statusCode, 302);
  assert.equal(repository.getLicense("FOREVER")?.expires_at, null);

  const expiring = await app.inject({
    method: "POST",
    url: "/admin/licenses",
    headers: {
      cookie: cookieHeader,
      "content-type": "application/x-www-form-urlencoded",
    },
    payload: new URLSearchParams({
      key: "EXPIRING",
      expires_at: "2027-01-01T00:00:00Z",
    }).toString(),
  });
  assert.equal(expiring.statusCode, 302);
  assert.equal(
    repository.getLicense("EXPIRING")?.expires_at,
    "2027-01-01T00:00:00.000Z",
  );
});

test("activation is compatible with the C# decoder and supports multiple devices", async () => {
  for (const deviceId of [deviceA, deviceB]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/license/activate",
      payload: { key, deviceId },
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] ?? "", /^text\/plain/);

    const [encrypted, integrity] = response.body.split(":");
    const decoded = decodeLikeCSharp(response.body, deviceId).substring(64);
    const fields = decoded.split(":");
    assert.equal(fields[1], key);
    assert.equal(fields[2], "000001");
    assert.equal(fields[3], "1");
    assert.equal(integrity, sha256Hex(`${key}0000011`));
    assert.equal(encrypted.length % 32, 0);
  }
});

test("activation returns 404, 403 for missing, blocked and expired keys", async () => {
  const missing = await app.inject({
    method: "POST",
    url: "/api/license/activate",
    payload: { key: "missing", deviceId: deviceA },
  });
  assert.equal(missing.statusCode, 404);

  repository.setBlocked(key, true);
  const blocked = await app.inject({
    method: "POST",
    url: "/api/license/activate",
    payload: { key, deviceId: deviceA },
  });
  assert.equal(blocked.statusCode, 403);

  repository.createLicense("expired", "2020-01-01T00:00:00.000Z");
  const expired = await app.inject({
    method: "POST",
    url: "/api/license/activate",
    payload: { key: "expired", deviceId: deviceA },
  });
  assert.equal(expired.statusCode, 403);
});

test("status validates Base64, plugin and version", async () => {
  const valid = await app.inject({
    method: "POST",
    url: "/api/license/status",
    headers: { "content-type": "text/plain" },
    payload: identity(),
  });
  assert.equal(valid.statusCode, 200);
  assert.equal(
    Buffer.from(valid.body, "base64").toString("utf8"),
    "status:000001:1",
  );

  for (const payload of [
    "not base64",
    identity(key, deviceA, "Wrong@1.12.0"),
    identity(key, deviceA, "OHFlightBuilder@9.0.0"),
  ]) {
    const invalid = await app.inject({
      method: "POST",
      url: "/api/license/status",
      headers: { "content-type": "text/plain" },
      payload,
    });
    assert.equal(invalid.statusCode, 400);
  }
});

test("update returns 204 without a newer update and 200 with one", async () => {
  const none = await app.inject({
    method: "POST",
    url: "/api/license/update",
    headers: { "content-type": "text/plain" },
    payload: identity(),
  });
  assert.equal(none.statusCode, 204);

  repository.setUpdate(
    "1.13.0",
    "Changes",
    "http://localhost:8080/downloads/OHFlightBuilder.zip",
  );
  const available = await app.inject({
    method: "POST",
    url: "/api/license/update",
    headers: { "content-type": "text/plain" },
    payload: identity(),
  });
  assert.equal(available.statusCode, 200);
  assert.equal(available.json().version, "1.13.0");
});

test("forecast selects altitude variables and nearest hour", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/forecast",
    headers: { "x-api-key": identity() },
    payload: {
      latitude: 50.4501,
      longitude: 30.5234,
      altitude: 100,
      date: "2026-06-10T12:29:00.00Z",
    },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { windDirection: 50, windSpeed: 5 });
  const url = new URL(requestedUrl);
  assert.equal(
    url.searchParams.get("hourly"),
    "wind_speed_100m,wind_direction_100m",
  );
  assert.equal(url.searchParams.get("timezone"), "GMT");
  assert.equal(url.searchParams.get("wind_speed_unit"), "ms");
});

test("forecast returns 503 when Open-Meteo is unavailable", async () => {
  await app.close();
  app = buildApp({
    config: getConfig({
      databasePath: ":memory:",
      downloadsPath: process.cwd(),
      openMeteoUrl: "https://example.test/forecast",
    }),
    db,
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/forecast",
    headers: { "x-api-key": identity() },
    payload: {
      latitude: 50,
      longitude: 30,
      altitude: 10,
      date: "2026-06-10T12:00:00.00Z",
    },
  });
  assert.equal(response.statusCode, 503);
});
