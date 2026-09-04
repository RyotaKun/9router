import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const baseUrl = process.argv[2] || "http://127.0.0.1:20129";
const model = process.argv[3] || "gh/gpt-5.6-luna";
const dbPath = join(process.env.APPDATA || "", "9router", "db", "data.sqlite");
const db = new DatabaseSync(dbPath, { readOnly: true });
const activeKey = db.prepare("SELECT key FROM apiKeys WHERE isActive = 1 ORDER BY createdAt ASC LIMIT 1").get()?.key;
db.close();

if (!activeKey) throw new Error("No active local API key is available for representative probes");

const headers = { "content-type": "application/json", authorization: `Bearer ${activeKey}` };

async function post(payload) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  return { response, elapsedMs: Math.round(performance.now() - started) };
}

const basePayload = {
  model,
  messages: [{ role: "user", content: "Reply with the single word OK." }],
  // GitHub's Responses endpoint rejects values below 16; use the smallest
  // value accepted by every representative provider path.
  max_tokens: 16,
};

const basic = await post({ ...basePayload, stream: false });
const basicBody = await basic.response.json().catch(() => ({}));
console.log(JSON.stringify({
  probe: "non-stream",
  ok: basic.response.ok && Array.isArray(basicBody.choices),
  status: basic.response.status,
  elapsedMs: basic.elapsedMs,
  choices: Array.isArray(basicBody.choices) ? basicBody.choices.length : 0,
}));

const tool = await post({
  model,
  messages: [{ role: "user", content: "Use the ping tool exactly once." }],
  max_tokens: 64,
  stream: false,
  tools: [{
    type: "function",
    function: {
      name: "ping",
      description: "Return a health ping",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  }],
  tool_choice: { type: "function", function: { name: "ping" } },
});
const toolBody = await tool.response.json().catch(() => ({}));
const toolCalls = toolBody.choices?.[0]?.message?.tool_calls;
console.log(JSON.stringify({
  probe: "tool-call",
  ok: tool.response.ok && Array.isArray(toolCalls) && toolCalls.length === 1,
  status: tool.response.status,
  elapsedMs: tool.elapsedMs,
  toolCalls: Array.isArray(toolCalls) ? toolCalls.length : 0,
}));

const stream = await post({ ...basePayload, stream: true });
const streamBody = await stream.response.text();
const dataLines = streamBody.split(/\r?\n/).filter((line) => line.startsWith("data:"));
const eventTypes = new Set();
const finishReasons = new Set();
for (const line of dataLines) {
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") continue;
  try {
    const event = JSON.parse(payload);
    if (event.type) eventTypes.add(event.type);
    for (const choice of event.choices || []) {
      if (choice.finish_reason) finishReasons.add(choice.finish_reason);
    }
  } catch {
    eventTypes.add("unparseable");
  }
}
const hasDataEvent = dataLines.length > 0;
const hasDoneEvent = streamBody.includes("[DONE]");
const hasTerminalEvent = hasDoneEvent || eventTypes.has("response.completed") || finishReasons.size > 0;
const streamOk = stream.response.ok && hasDataEvent && hasTerminalEvent && !eventTypes.has("unparseable");
console.log(JSON.stringify({
  probe: "stream",
  ok: streamOk,
  status: stream.response.status,
  elapsedMs: stream.elapsedMs,
  bytes: Buffer.byteLength(streamBody),
  contentType: stream.response.headers.get("content-type"),
  hasDataEvent,
  hasDoneEvent,
  hasTerminalEvent,
  eventTypes: [...eventTypes],
  finishReasons: [...finishReasons],
}));

if (!basic.response.ok || !tool.response.ok || !streamOk || !Array.isArray(toolCalls) || toolCalls.length !== 1) {
  process.exitCode = 1;
}
