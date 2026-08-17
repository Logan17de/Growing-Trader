export type GrowwCredentialPair = {
  apiKey: string;
  apiSecret: string;
};

const ALLOWED_KEYS = new Set(["GROWW_API_KEY", "GROWW_API_SECRET"]);
const MAX_CREDENTIAL_LENGTH = 16_384;

function unwrapValue(raw: string) {
  const value = raw.trim();
  if (!value) return "";

  const quote = value[0];
  if (quote === "'" || quote === '"') {
    if (value.length < 2 || value[value.length - 1] !== quote) {
      throw new Error("credential file contains an unterminated quoted value");
    }
    return value.slice(1, -1);
  }
  return value;
}

export function parseGrowwCredentialFile(text: string): GrowwCredentialPair {
  const values = new Map<string, string>();

  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) throw new Error("credential file contains an invalid line");

    const [, key, rawValue] = match;
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`credential file contains unsupported key: ${key}`);
    }
    if (values.has(key)) throw new Error(`credential file contains duplicate key: ${key}`);

    const value = unwrapValue(rawValue);
    if (value.length < 8) throw new Error(`${key} is missing or too short`);
    if (value.length > MAX_CREDENTIAL_LENGTH) throw new Error(`${key} exceeds the credential safety limit`);
    values.set(key, value);
  }

  const apiKey = values.get("GROWW_API_KEY") ?? "";
  const apiSecret = values.get("GROWW_API_SECRET") ?? "";
  if (!apiKey || !apiSecret) {
    throw new Error("credential file must contain GROWW_API_KEY and GROWW_API_SECRET");
  }

  return { apiKey, apiSecret };
}
