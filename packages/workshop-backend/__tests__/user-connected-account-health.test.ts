import { describe, expect, it } from "vitest";
import { summarizeConnectedAccountHealth } from "../src/user.js";

describe("summarizeConnectedAccountHealth", () => {
  it("counts readable accounts and derives reconnect-required health", () => {
    expect(summarizeConnectedAccountHealth([
      {},
      { credentialsExpired: true },
      { credentialExpiresAt: new Date(Date.now() - 1) },
    ])).toEqual({
      total: 3,
      valid: 1,
      reconnectRequired: 2,
    });
  });

  it("returns a zero health snapshot when no records are readable", () => {
    expect(summarizeConnectedAccountHealth([])).toEqual({
      total: 0,
      valid: 0,
      reconnectRequired: 0,
    });
  });
});
