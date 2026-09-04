import { mkdtempSync, mkdirSync, existsSync, utimesSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { __test__ } from "../../open-sse/utils/requestLogger.js";

describe("request logger safety", () => {
  it("redacts sensitive fields and token-shaped strings recursively", () => {
    const syntheticSecret = "sk_synthetic_1234567890abcdef";
    const sanitized = __test__.sanitizeDiagnostic({
      headers: {
        Authorization: `Bearer ${syntheticSecret}`,
        Cookie: "session=synthetic-cookie",
        "x-api-key": syntheticSecret,
        "content-type": "application/json",
      },
      body: {
        access_token: syntheticSecret,
        nested: { message: `diagnostic ${syntheticSecret}` },
      },
    });
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain(syntheticSecret);
    expect(sanitized.headers.Authorization).toBe("[REDACTED]");
    expect(sanitized.headers.Cookie).toBe("[REDACTED]");
    expect(sanitized.headers["content-type"]).toBe("application/json");
    expect(sanitized.body.access_token).toBe("[REDACTED]");
  });

  it("bounds retained log entries by deleting only the oldest entries", () => {
    const root = mkdtempSync(path.join(tmpdir(), "9router-log-retention-"));
    const names = ["old", "middle", "new"];
    names.forEach((name, index) => {
      const dir = path.join(root, name);
      mkdirSync(dir);
      writeFileSync(path.join(dir, "synthetic.json"), "{}");
      const timestamp = new Date(2026, 0, index + 1);
      utimesSync(dir, timestamp, timestamp);
    });

    const removed = __test__.enforceRetention(root, 2, fs, path);

    expect(removed).toEqual([path.join(root, "old")]);
    expect(existsSync(path.join(root, "old"))).toBe(false);
    expect(existsSync(path.join(root, "middle"))).toBe(true);
    expect(existsSync(path.join(root, "new"))).toBe(true);
  });

  it("uses conservative finite defaults", () => {
    expect(__test__.defaults.maxEntries).toBe(50);
    expect(__test__.defaults.maxFileBytes).toBe(256 * 1024);
  });

  it("keeps capped JSON valid without preserving an unsafe partial payload", () => {
    const bounded = __test__.boundedJson({ body: "x".repeat(10_000) }, 100);

    expect(JSON.parse(bounded)).toEqual({ truncated: true, originalBytes: 10016 });
    expect(Buffer.byteLength(bounded)).toBeLessThanOrEqual(100);

    const tiny = __test__.boundedJson({ body: "unsafe" }, 1);
    expect(() => JSON.parse(tiny)).not.toThrow();
    expect(Buffer.byteLength(tiny)).toBeLessThanOrEqual(1);
  });

  it("redacts credentials embedded in streaming JSON and URLs", () => {
    const input = '{"refresh_token":"synthetic-refresh-value"} https://example.test/?api_key=synthetic-key';
    const sanitized = __test__.sanitizeString(input);

    expect(sanitized).not.toContain("synthetic-refresh-value");
    expect(sanitized).not.toContain("synthetic-key");
    expect(sanitized).toContain("[REDACTED]");
  });
});
