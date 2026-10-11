import test from "node:test";
import assert from "node:assert/strict";
import { allowed, scanFile } from "./ai-boundary.mjs";

const v = (path, text) => scanFile(path, text).map((x) => x.rule);

test("importing a model SDK outside the gateway fails", () => {
  assert.deepEqual(v("src/lib/foo.ts", `import Anthropic from "@anthropic-ai/sdk";`), ["sdk-import"]);
  assert.deepEqual(v("src/lib/foo.ts", `import OpenAI from "openai";`), ["sdk-import"]);
  assert.deepEqual(v("src/lib/foo.ts", `const a = require("@anthropic-ai/sdk");`), ["sdk-import"]);
  assert.deepEqual(v("src/lib/foo.ts", `const m = await import("openai");`), ["sdk-import"]);
});
test("a type-only import of an SDK is fine", () => {
  assert.deepEqual(v("src/lib/foo.ts", `import type Anthropic from "@anthropic-ai/sdk";`), []);
});
test("the SDK client helpers are gateway-internal", () => {
  assert.deepEqual(v("src/lib/foo.ts", `import { getAnthropicClient } from "@/lib/ai/client";`), ["client-import"]);
  assert.deepEqual(v("src/lib/foo.ts", `import { getOpenAiClient } from "@/lib/ai/openai";`), ["client-import"]);
  assert.deepEqual(v("src/lib/ai/foo.ts", `import { x } from "./client";`), ["client-import"]);
  assert.deepEqual(v("src/lib/other/foo.ts", `import { x } from "./client";`), []);
});
test("the raw provider factories are gateway-internal; the fake and the types are not", () => {
  assert.deepEqual(v("src/lib/foo.ts", `import { getProvider } from "@/lib/ai/provider";`), ["provider-factory"]);
  assert.deepEqual(v("src/lib/foo.ts", `import { getProviderWithKey, type LlmProvider } from "@/lib/ai/provider";`), ["provider-factory"]);
  assert.deepEqual(v("src/lib/foo.ts", `import { createProvider } from "@/lib/ai/provider";`), ["provider-factory"]);
  assert.deepEqual(v("src/lib/foo.ts", `import { FakeProvider, type LlmProvider } from "@/lib/ai/provider";`), []);
});
test("a direct vendor URL or a vendor SDK call fails", () => {
  assert.deepEqual(v("src/lib/foo.ts", `fetch("https://api.anthropic.com/v1/messages")`), ["vendor-url"]);
  assert.deepEqual(v("src/lib/foo.ts", `fetch('https://api.openai.com/v1/chat/completions')`), ["vendor-url"]);
  assert.deepEqual(v("src/lib/foo.ts", `await client.messages.create({})`), ["sdk-call"]);
  assert.deepEqual(v("src/lib/foo.ts", `await openai.chat.completions.create({})`), ["sdk-call"]);
});
test("the gateway itself, the provider switch and the offline eval CLI are allowed", () => {
  assert.equal(allowed("src/lib/ai/gateway/wiring.ts"), true);
  assert.equal(allowed("src/lib/ai/provider.ts"), true);
  assert.equal(allowed("src/lib/ai/client.ts"), true);
  assert.equal(allowed("src/lib/agents/evals/cli.ts"), true);
  assert.equal(allowed("src/lib/agents/nudger.ts"), false);
  assert.equal(allowed("src/lib/intelligence/ask.ts"), false);
});
test("tests are not scanned", () => {
  assert.equal(allowed("src/lib/foo.test.ts"), true);
  assert.equal(allowed("scripts/ci/lib/ai-boundary.test.mjs"), true);
});
test("clean code is clean", () => assert.deepEqual(v("src/lib/foo.ts", `import { callModel } from "@/lib/ai/gateway";\nawait callModel({ purpose: "x" });`), []));
test("a line number is reported", () => assert.equal(scanFile("src/a.ts", `\n\nimport OpenAI from "openai";`)[0].line, 3));
