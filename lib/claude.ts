import Anthropic from "@anthropic-ai/sdk";
import type { ChatTurn } from "./gemini";

// Fallback provider only — used when Gemini's free-tier quota or availability fails, so the
// app stays usable without waiting on Google's daily reset.
const MODEL_NAME = "claude-sonnet-5";
// Sized for the largest JSON response this app asks for (stock brief + sentiment + upside/
// downside scenarios + a bounded decision tree) — 1024 was fine for a plain chat reply but was
// never revisited when that schema grew, so it silently truncated mid-JSON on every fallback.
const MAX_TOKENS = 4096;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/** One-shot prompt, no conversation history. Mirrors askGemini's signature. */
export async function askClaude(prompt: string, systemInstruction?: string): Promise<string> {
  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: MODEL_NAME,
    max_tokens: MAX_TOKENS,
    thinking: { type: "disabled" }, // plain text output only — no need to pay for reasoning here
    system: systemInstruction,
    messages: [{ role: "user", content: prompt }],
  });
  return extractText(response.content);
}

/** Multi-turn chat. Mirrors chatWithGemini's signature. */
export async function chatWithClaude(
  history: ChatTurn[],
  message: string,
  systemInstruction?: string
): Promise<string> {
  const anthropic = getClient();
  const messages: Anthropic.Messages.MessageParam[] = [
    ...history.map((turn) => ({
      role: (turn.role === "model" ? "assistant" : "user") as "assistant" | "user",
      content: turn.text,
    })),
    { role: "user" as const, content: message },
  ];
  const response = await anthropic.messages.create({
    model: MODEL_NAME,
    max_tokens: MAX_TOKENS,
    thinking: { type: "disabled" },
    system: systemInstruction,
    messages,
  });
  return extractText(response.content);
}
