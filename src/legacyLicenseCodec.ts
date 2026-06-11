import {
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";

const PREFIX_LENGTH = 64;
const SINGLE_BYTE_ASCII = /^[\x00-\x7f]{16}$/;

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function aesKey(deviceId: string): Buffer {
  return Buffer.from(sha256Hex(deviceId).slice(0, 32), "utf8");
}

function findCompatibleIv(key: Buffer, seed: string): {
  iv: Buffer;
  decodedPrefix: string;
} {
  const batchSize = 4096;
  const seedPrefix = createHash("sha256").update(seed).digest().subarray(0, 12);
  for (let offset = 0; offset < 2_000_000; offset += batchSize) {
    const candidates = Buffer.alloc(batchSize * 16);
    for (let index = 0; index < batchSize; index += 1) {
      seedPrefix.copy(candidates, index * 16);
      candidates.writeUInt32BE(offset + index, index * 16 + 12);
    }
    const decipher = createDecipheriv("aes-256-ecb", key, null);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([
      decipher.update(candidates),
      decipher.final(),
    ]);

    for (let candidateIndex = 0; candidateIndex < batchSize; candidateIndex += 1) {
      const start = candidateIndex * 16;
      const prefix = Buffer.allocUnsafe(16);
      for (let byteIndex = 0; byteIndex < 16; byteIndex += 1) {
        prefix[byteIndex] =
          decrypted[start + byteIndex] ^ candidates[start + byteIndex];
      }
      const decodedPrefix = prefix.toString("latin1");
      if (SINGLE_BYTE_ASCII.test(decodedPrefix)) {
        return {
          iv: Buffer.from(candidates.subarray(start, start + 16)),
          decodedPrefix,
        };
      }
    }
  }
  throw new Error("Unable to generate a compatible IV");
}

export function encodeLegacyLicense(
  licenseKey: string,
  deviceId: string,
): string {
  const key = aesKey(deviceId);
  const { iv } = findCompatibleIv(key, `${licenseKey}:${deviceId}`);
  const payload = `:${licenseKey}:000001:1`;
  const plaintextPrefix = "0".repeat(PREFIX_LENGTH - 16);
  let plaintext = plaintextPrefix + payload;
  const remainder = plaintext.length % 16;
  if (remainder !== 0) {
    plaintext += ":" + "0".repeat(15 - remainder);
  }

  const cipher = createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(false);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]);
  const integrity = sha256Hex(`${licenseKey}0000011`);
  return `${Buffer.concat([iv, ciphertext]).toString("hex")}:${integrity}`;
}

export function decodeLikeCSharp(value: string, deviceId: string): string {
  const [encrypted] = value.split(":");
  const bytes = Buffer.from(encrypted, "hex");
  const iv = bytes.subarray(0, 16);
  const decipher = createDecipheriv("aes-256-cbc", aesKey(deviceId), iv);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(bytes), decipher.final()]).toString(
    "utf8",
  );
}
