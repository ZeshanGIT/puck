import { describe, expect, test } from "bun:test";
import { normalizeWebhookAuthorization } from "./webhookAuth";

describe("normalizeWebhookAuthorization", () => {
  test("passes through a bare Bearer value", () => {
    expect(normalizeWebhookAuthorization("Bearer example-token")).toBe("Bearer example-token");
  });

  test("strips a full Authorization header line", () => {
    expect(normalizeWebhookAuthorization("Authorization: Bearer example-token")).toBe("Bearer example-token");
    expect(normalizeWebhookAuthorization("authorization: Bearer example-token")).toBe("Bearer example-token");
  });

  test("collapses newlines from a pasted line", () => {
    expect(normalizeWebhookAuthorization("Authorization: Bearer\nexample-token")).toBe("Bearer example-token");
  });

  test("does not add Bearer when only a header line prefix was removed", () => {
    expect(normalizeWebhookAuthorization("Authorization: custom-scheme value")).toBe("custom-scheme value");
  });
});
