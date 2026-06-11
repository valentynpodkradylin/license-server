const EXPECTED_PLUGIN = "OHFlightBuilder";
const EXPECTED_VERSION = "1.12.0";

export interface LicenseIdentity {
  key: string;
  deviceId: string;
  plugin: string;
  version: string;
}

export function decodeLicenseIdentity(value: string): LicenseIdentity {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("Invalid Base64");
  }

  const decoded = Buffer.from(value, "base64").toString("utf8");
  if (Buffer.from(decoded, "utf8").toString("base64") !== value) {
    throw new Error("Invalid Base64");
  }

  const match = /^([^:]+):([^:]+):([^:@]+)@(.+)$/.exec(decoded);
  if (!match) {
    throw new Error("Invalid license identity");
  }

  const [, key, deviceId, plugin, version] = match;
  if (plugin !== EXPECTED_PLUGIN || version !== EXPECTED_VERSION) {
    throw new Error("Unsupported client");
  }
  return { key, deviceId, plugin, version };
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (version: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!match) throw new Error("Invalid semantic version");
    return match.slice(1).map(Number);
  };
  const left = parse(candidate);
  const right = parse(current);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

export const clientVersion = EXPECTED_VERSION;
