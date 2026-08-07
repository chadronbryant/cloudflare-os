import { describe, expect, it } from "vitest";
import {
  CONNECTED_ACCOUNT_HEALTH_MAX,
  UserDurableObject,
  summarizeConnectedAccountHealth,
  summarizeConnectedAccountVendorHealth,
} from "../src/user.js";

function makeUser(records: unknown[], listError?: Error, vendorIds = ["home", "other"]) {
  const user = Object.create(UserDurableObject.prototype) as UserDurableObject;
  let observedLimit: number | undefined;
  Object.assign(user, {
    storage: {
      connectedAccounts: {
        list(options: { limit?: number }) {
          observedLimit = options.limit;
          if (listError) throw listError;
          return records;
        },
      },
    },
    vendors: new Map(vendorIds.map(vendorId => [vendorId, {}])),
  });
  return { user, observedLimit: () => observedLimit };
}

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

  it("rejects over-limit and malformed persisted credential state", () => {
    expect(() => summarizeConnectedAccountHealth(
      Array.from({length: CONNECTED_ACCOUNT_HEALTH_MAX + 1}, () => ({})),
    )).toThrow("supported limit");
    expect(() => summarizeConnectedAccountHealth([
      { credentialExpiresAt: "not-a-date" } as unknown as { credentialExpiresAt: Date },
    ])).toThrow("expiry is malformed");
  });
});

describe("summarizeConnectedAccountVendorHealth", () => {
  it("counts only the requested vendor while retaining no account metadata", () => {
    expect(summarizeConnectedAccountVendorHealth("home", [
      {vendorId: "home"},
      {vendorId: "other", credentialsExpired: true},
      {vendorId: "home", credentialExpiresAt: new Date(Date.now() - 1)},
    ] as never)).toEqual({
      total: 2,
      valid: 1,
      reconnectRequired: 1,
    });
  });

  it("rejects over-limit and malformed persisted vendor state", () => {
    expect(() => summarizeConnectedAccountVendorHealth(
      "home", Array.from({length: CONNECTED_ACCOUNT_HEALTH_MAX + 1}, () => ({vendorId: "home"})) as never,
    )).toThrow("supported limit");
    expect(() => summarizeConnectedAccountVendorHealth("home", [{}] as never)).toThrow(
      "vendor state is malformed",
    );
  });
});

describe("UserDurableObject.getConnectedAccountHealth", () => {
  it("uses a bounded list and returns a unary aggregate", async () => {
    const { user, observedLimit } = makeUser([{}, { credentialsExpired: true }]);
    await expect(user.getConnectedAccountHealth()).resolves.toEqual({
      total: 2,
      valid: 1,
      reconnectRequired: 1,
    });
    expect(observedLimit()).toBe(CONNECTED_ACCOUNT_HEALTH_MAX + 1);
  });

  it("fails closed when storage cannot produce a complete health snapshot", async () => {
    const { user } = makeUser([], new Error("synthetic storage failure"));
    await expect(user.getConnectedAccountHealth()).rejects.toThrow(
      "Connected-account health unavailable",
    );
  });
});

describe("UserDurableObject.getConnectedAccountVendorHealth", () => {
  it("uses a bounded list and returns an aggregate for one configured vendor", async () => {
    const { user, observedLimit } = makeUser([
      {vendorId: "home"},
      {vendorId: "other", credentialsExpired: true},
      {vendorId: "home", credentialsExpired: true},
    ]);
    await expect(user.getConnectedAccountVendorHealth("home")).resolves.toEqual({
      total: 2,
      valid: 1,
      reconnectRequired: 1,
    });
    expect(observedLimit()).toBe(CONNECTED_ACCOUNT_HEALTH_MAX + 1);
  });

  it("fails closed for invalid vendor IDs and malformed storage", async () => {
    const { user: invalidVendor, observedLimit } = makeUser([]);
    await expect(invalidVendor.getConnectedAccountVendorHealth("missing")).rejects.toThrow(
      "Invalid connected-account vendor.",
    );
    await expect(invalidVendor.getConnectedAccountVendorHealth(null as never)).rejects.toThrow(
      "Invalid connected-account vendor.",
    );
    expect(observedLimit()).toBeUndefined();

    const { user: malformedStorage } = makeUser([{}]);
    await expect(malformedStorage.getConnectedAccountVendorHealth("home")).rejects.toThrow(
      "Connected-account vendor health unavailable",
    );
  });
});
