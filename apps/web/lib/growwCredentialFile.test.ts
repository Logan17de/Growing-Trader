import assert from "node:assert/strict";
import test from "node:test";
import { parseGrowwCredentialFile } from "./growwCredentialFile.ts";

test("parses the expected quoted txt format", () => {
  assert.deepEqual(parseGrowwCredentialFile("GROWW_API_KEY='abcdefgh123'\nGROWW_API_SECRET='zyxwvuts987'\n"), {
    apiKey: "abcdefgh123",
    apiSecret: "zyxwvuts987",
  });
});

test("accepts comments, blank lines, export and double quotes", () => {
  assert.deepEqual(parseGrowwCredentialFile("# Groww\n\nexport GROWW_API_KEY=\"abcdefgh123\"\nGROWW_API_SECRET=zyxwvuts987\n"), {
    apiKey: "abcdefgh123",
    apiSecret: "zyxwvuts987",
  });
});

test("rejects missing or unsupported credential keys", () => {
  assert.throws(() => parseGrowwCredentialFile("GROWW_API_KEY='abcdefgh123'\n"), /must contain/);
  assert.throws(() => parseGrowwCredentialFile("GROWW_API_KEY='abcdefgh123'\nOTHER_SECRET='zyxwvuts987'\n"), /unsupported key/);
});

test("rejects duplicate and malformed values", () => {
  assert.throws(() => parseGrowwCredentialFile("GROWW_API_KEY='abcdefgh123'\nGROWW_API_KEY='abcdefgh456'\nGROWW_API_SECRET='zyxwvuts987'\n"), /duplicate key/);
  assert.throws(() => parseGrowwCredentialFile("GROWW_API_KEY='abcdefgh123\nGROWW_API_SECRET='zyxwvuts987'\n"), /unterminated/);
});
