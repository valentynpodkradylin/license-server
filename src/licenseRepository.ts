import type { SqliteDatabase } from "./database.js";

type MaybePromise<T> = T | Promise<T>;

export interface LicenseRow {
  key: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  blocked: number;
}

export interface UpdateRow {
  version: string;
  notes: string;
  link: string;
  active: number;
}

export interface LicenseStore {
  getLicense(key: string): MaybePromise<LicenseRow | undefined>;
  listLicenses(): MaybePromise<LicenseRow[]>;
  createLicense(key: string, expiresAt: string | null): MaybePromise<void>;
  setBlocked(key: string, blocked: boolean): MaybePromise<boolean>;
  recordActivation(key: string, deviceId: string): MaybePromise<void>;
  audit(
    operation: string,
    key: string | null,
    deviceId: string | null,
    result: string,
  ): MaybePromise<void>;
  setUpdate(version: string, notes: string, link: string): MaybePromise<void>;
  getActiveUpdate(): MaybePromise<UpdateRow | undefined>;
}

export class LicenseRepository implements LicenseStore {
  constructor(private readonly db: SqliteDatabase) {}

  getLicense(key: string): LicenseRow | undefined {
    return this.db
      .prepare("SELECT * FROM licenses WHERE key = ?")
      .get(key) as LicenseRow | undefined;
  }

  listLicenses(): LicenseRow[] {
    return this.db
      .prepare("SELECT * FROM licenses ORDER BY created_at DESC")
      .all() as LicenseRow[];
  }

  createLicense(key: string, expiresAt: string | null): void {
    this.db
      .prepare(`
        INSERT INTO licenses (key, status, created_at, expires_at, blocked)
        VALUES (?, 'active', ?, ?, 0)
      `)
      .run(key, new Date().toISOString(), expiresAt);
  }

  setBlocked(key: string, blocked: boolean): boolean {
    const result = this.db
      .prepare("UPDATE licenses SET blocked = ?, status = ? WHERE key = ?")
      .run(blocked ? 1 : 0, blocked ? "revoked" : "active", key);
    return result.changes > 0;
  }

  recordActivation(key: string, deviceId: string): void {
    this.db
      .prepare(`
        INSERT INTO activations (license_key, device_id, activated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(license_key, device_id)
        DO UPDATE SET activated_at = excluded.activated_at
      `)
      .run(key, deviceId, new Date().toISOString());
  }

  audit(
    operation: string,
    key: string | null,
    deviceId: string | null,
    result: string,
  ): void {
    this.db
      .prepare(`
        INSERT INTO audit_log
          (operation, license_key, device_id, result, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(operation, key, deviceId, result, new Date().toISOString());
  }

  setUpdate(version: string, notes: string, link: string): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare("UPDATE updates SET active = 0").run();
      this.db
        .prepare(`
          INSERT INTO updates (version, notes, link, active, created_at)
          VALUES (?, ?, ?, 1, ?)
          ON CONFLICT(version) DO UPDATE SET
            notes = excluded.notes,
            link = excluded.link,
            active = 1
        `)
        .run(version, notes, link, new Date().toISOString());
    });
    transaction();
  }

  getActiveUpdate(): UpdateRow | undefined {
    return this.db
      .prepare(`
        SELECT version, notes, link, active
        FROM updates
        WHERE active = 1
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .get() as UpdateRow | undefined;
  }
}
