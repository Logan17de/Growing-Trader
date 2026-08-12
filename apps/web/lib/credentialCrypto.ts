import { createCipheriv, randomBytes } from "node:crypto";

function encryptionKey(): Buffer {
  const raw = process.env.BROKER_CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) throw new Error("BROKER_CREDENTIAL_ENCRYPTION_KEY is required");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("BROKER_CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return key;
}

export function encryptCredential(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([ciphertext, tag]);
  return `v1.${iv.toString("base64url")}.${packed.toString("base64url")}`;
}
