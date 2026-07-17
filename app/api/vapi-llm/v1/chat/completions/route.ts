import { NextResponse } from "next/server";
import { chatWithGemini, GeminiUnavailableError, type ChatTurn } from "@/lib/gemini";
import { redactSensitive, detectDistressSignals } from "@/lib/guardrails";

/**
 * OpenAI-compatible `/chat/completions` endpoint, pointed at by the Vapi Assistant's
 * `model.url` (CustomLLMModel). This exists purely because Vapi's native `fallbackModels`
 * field only works within the OpenAI provider — there is no built-in way to say "Google
 * primary, Anthropic fallback." Routing through our own chatWithGemini instead gets the
 * exact same fallback behavior already used everywhere else in this app, plus lets our
 * guardrails run server-side on every call turn instead of relying solely on the system prompt.
 *
 * Vapi replays the Assistant's configured `model.messages[0]` (system role) back on every
 * request, so the system prompt arriving here is exactly what we set at Assistant-creation
 * time — this route never invents or hardcodes it, just forwards it (plus dynamic notices).
 */

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | string;
  content: string;
}

interface OpenAIChatRequest {
  model?: string;
  messages?: OpenAIMessage[];
  stream?: boolean;
}

function isAuthorized(request: Request): boolean {
  const expected = process.env.VAPI_LLM_PROXY_SECRET;
  if (!expected) return false; // fail closed if misconfigured, same as the cron endpoint
  return request.headers.get("x-vapi-proxy-secret") === expected;
}

function toHistory(messages: OpenAIMessage[]): { history: ChatTurn[]; message: string; systemInstruction?: string } {
  let systemInstruction: string | undefined;
  const turns: ChatTurn[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      systemInstruction = m.content;
    } else if (m.role === "user") {
      turns.push({ role: "user", text: m.content });
    } else if (m.role === "assistant") {
      turns.push({ role: "model", text: m.content });
    }
    // Anything else (e.g. a "tool" role) is dropped — this call is conversational-only, no
    // function/tool-calling wired up, so nothing should ever produce that role here.
  }

  // The most recent user turn is "the message"; everything before it is history — mirrors how
  // the web chat splits `{ history, message }` in app/api/chat/route.ts.
  const lastUserIndex = turns.map((t) => t.role).lastIndexOf("user");
  if (lastUserIndex === -1) {
    return { history: turns, message: "", systemInstruction };
  }
  const message = turns[lastUserIndex].text;
  const history = [...turns.slice(0, lastUserIndex), ...turns.slice(lastUserIndex + 1)];
  return { history, message, systemInstruction };
}

// Chunked (not token-by-token) SSE — chatWithGemini returns a complete string, so this fakes an
// OpenAI streaming response by emitting the finished text in pieces. Vapi's TTS can start
// speaking the early chunks while later ones are still being written to the stream, so this
// still meaningfully helps perceived latency over sending it all as one delta.
function buildOpenAIStream(text: string, model: string): ReadableStream<Uint8Array> {
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();

  function chunk(delta: Record<string, string>, finishReason: string | null = null) {
    const payload = {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    };
    return `data: ${JSON.stringify(payload)}\n\n`;
  }

  const words = text.split(" ");
  const CHUNK_WORDS = 4;

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(chunk({ role: "assistant" })));
      for (let i = 0; i < words.length; i += CHUNK_WORDS) {
        const piece = words.slice(i, i + CHUNK_WORDS).join(" ") + (i + CHUNK_WORDS < words.length ? " " : "");
        controller.enqueue(encoder.encode(chunk({ content: piece })));
      }
      controller.enqueue(encoder.encode(chunk({}, "stop")));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

function nonStreamingResponse(text: string, model: string) {
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
  };
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: OpenAIChatRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const { history, message, systemInstruction } = toHistory(messages);
  const model = body.model ?? "vapi-llm-proxy";

  // Defensive only — Vapi should never call this without a user turn (the static firstMessage
  // is spoken directly, no LLM call), but degrade gracefully rather than calling chatWithGemini
  // with an empty string if it ever does.
  if (!message.trim()) {
    const fallback = "Sorry, could you say that again?";
    return body.stream
      ? new Response(buildOpenAIStream(fallback, model), { headers: { "Content-Type": "text/event-stream" } })
      : NextResponse.json(nonStreamingResponse(fallback, model));
  }

  // Same per-turn guardrail handling as the web chat route (6.5, 6.7) — this call bypasses
  // app/api/chat/route.ts entirely, so nothing here is inherited "for free."
  const { clean: cleanedMessage, hadPII } = redactSensitive(message);
  let finalSystemInstruction = systemInstruction ?? "";
  if (hadPII) {
    finalSystemInstruction +=
      "\n\nThe caller said something that sounded like sensitive data (an account or SSN " +
      "number) — it was redacted before reaching you. Gently let them know they don't need to " +
      "share that on this call.";
  }
  if (detectDistressSignals(cleanedMessage)) {
    finalSystemInstruction +=
      "\n\nThis message shows possible signs of financial or emotional distress. Respond with " +
      "extra care per the guidance above.";
  }

  try {
    const reply = await chatWithGemini(history, cleanedMessage, finalSystemInstruction);
    return body.stream
      ? new Response(buildOpenAIStream(reply, model), { headers: { "Content-Type": "text/event-stream" } })
      : NextResponse.json(nonStreamingResponse(reply, model));
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      const fallback = "I'm having trouble reaching my systems right now — let's try again in a moment.";
      return body.stream
        ? new Response(buildOpenAIStream(fallback, model), { headers: { "Content-Type": "text/event-stream" } })
        : NextResponse.json(nonStreamingResponse(fallback, model));
    }
    console.error("vapi-llm proxy error:", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
