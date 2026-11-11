import { describe, expect, it } from "vitest";
import {
  LocalModelManager,
  validateLocalChatRequest,
} from "../src/main/local-model-manager";

describe("local model install boundary", () => {
  it.each([false, "true", 1, null, undefined])(
    "requires a literal trust confirmation (%s is rejected)",
    async (confirmation) => {
      const manager = new LocalModelManager("C:\\OpenForge-test-data");
      await expect(manager.install(confirmation)).rejects.toThrow(/confirm.*trust/i);
      await expect(manager.start(confirmation)).rejects.toThrow(/review and confirm/i);
    },
  );

  it("discloses pinned sources, loopback binding, disabled server features, and both model licenses", () => {
    const plan = new LocalModelManager("C:\\OpenForge-test-data").previewInstall();
    const commands = plan.commands.join("\n");

    expect(commands).toContain("--version b12182");
    expect(commands).toContain("--host 127.0.0.1");
    expect(commands).toContain("--api-key <session-secret>");
    expect(commands).toContain("--no-agent");
    expect(commands).toContain("--no-ui-mcp-proxy");
    expect(commands).toContain("--no-webui");
    expect(commands).toContain("5a4c1107c2b626e722faf75bfe6066c08dd75035");
    expect(commands).toContain(
      "c40cbf1e9dbf9bd9cb54bcb0ab9b479ee4f878e1d897fc06309e2085aa80cef9",
    );
    expect(plan.commands.find((command) => command.startsWith("llama-server"))).not.toContain(
      "--model-url",
    );
    expect(plan.licenses.map((item) => item.license)).toEqual([
      "MIT",
      "Apache-2.0 (model card)",
      "OpenMDW-1.1",
    ]);
  });
});

describe("validateLocalChatRequest", () => {
  it("normalizes a bounded chat request and applies defaults", () => {
    expect(
      validateLocalChatRequest({
        messages: [
          { role: "system", content: "Answer clearly." },
          { role: "user", content: "Hello" },
        ],
      }),
    ).toEqual({
      messages: [
        { role: "system", content: "Answer clearly." },
        { role: "user", content: "Hello" },
      ],
      temperature: 0.7,
      maxTokens: 1_024,
    });
  });

  it.each([
    null,
    [],
    { messages: [], extra: true },
    { messages: [] },
    { messages: Array.from({ length: 49 }, () => ({ role: "user", content: "x" })) },
  ])("rejects an invalid request envelope %#", (request) => {
    expect(() => validateLocalChatRequest(request)).toThrow();
  });

  it.each([
    { role: "tool", content: "not allowed" },
    { role: "user", content: "" },
    { role: "user", content: "   " },
    { role: "user", content: "contains\0nul" },
    { role: "user", content: "x", extra: true },
    { role: "user", content: "x".repeat(12_001) },
  ])("rejects an invalid message %#", (message) => {
    expect(() => validateLocalChatRequest({ messages: [message] })).toThrow();
  });

  it("limits the total retained chat content", () => {
    expect(() =>
      validateLocalChatRequest({
        messages: Array.from({ length: 5 }, () => ({
          role: "user",
          content: "x".repeat(10_000),
        })),
      }),
    ).toThrow(/history is too large/i);
  });

  it.each([-0.01, 2.01, Number.NaN, Number.POSITIVE_INFINITY, "0.7"]) (
    "rejects invalid temperature %s",
    (temperature) => {
      expect(() =>
        validateLocalChatRequest({
          messages: [{ role: "user", content: "Hello" }],
          temperature,
        }),
      ).toThrow(/temperature/i);
    },
  );

  it.each([0, 4_097, 1.5, Number.NaN, "1024"]) (
    "rejects invalid maxTokens %s",
    (maxTokens) => {
      expect(() =>
        validateLocalChatRequest({
          messages: [{ role: "user", content: "Hello" }],
          maxTokens,
        }),
      ).toThrow(/maximum tokens/i);
    },
  );
});
