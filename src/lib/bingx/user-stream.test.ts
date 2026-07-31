import { describe, it, expect, vi, beforeEach } from "vitest";

const signedRequest = vi.fn();

vi.mock("./signed-request", () => ({
  signedRequest: (...args: unknown[]) => signedRequest(...args),
}));

const { createListenKey, extendListenKey, deleteListenKey } = await import("./user-stream");

beforeEach(() => {
  signedRequest.mockReset();
});

describe("createListenKey", () => {
  it("POSTs to the userDataStream endpoint and returns the listenKey string", async () => {
    signedRequest.mockResolvedValue({ listenKey: "abc123" });
    const key = await createListenKey("k", "s");
    expect(key).toBe("abc123");
    expect(signedRequest).toHaveBeenCalledWith("k", "s", "POST", "/openApi/user/auth/userDataStream");
  });
});

describe("extendListenKey", () => {
  it("PUTs the listenKey to extend its validity", async () => {
    signedRequest.mockResolvedValue({});
    await extendListenKey("k", "s", "abc123");
    expect(signedRequest).toHaveBeenCalledWith("k", "s", "PUT", "/openApi/user/auth/userDataStream", { listenKey: "abc123" });
  });
});

describe("deleteListenKey", () => {
  it("DELETEs the listenKey to release it", async () => {
    signedRequest.mockResolvedValue({});
    await deleteListenKey("k", "s", "abc123");
    expect(signedRequest).toHaveBeenCalledWith("k", "s", "DELETE", "/openApi/user/auth/userDataStream", { listenKey: "abc123" });
  });
});
