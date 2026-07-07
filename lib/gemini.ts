import { GoogleGenAI, ApiError, ThinkingLevel, type Content } from "@google/genai";
import { assertNotDirectAdvice } from "./guardrails";
import { askClaude, chatWithClaude } from "./claude";

// One constant, one place to change if Google's free-tier lineup shifts.
// The plan's original "gemini-3-flash" doesn't exist as a model ID (verified against
// GET /v1beta/models) — only "gemini-3-flash-preview" and this, the newer stable release, do.
// Fallback order: gemini-3.5-flash -> gemini-2.5-flash -> gemini-3.1-flash-lite.
export const MODEL_NAME = "gemini-3.5-flash";

export class GeminiUnavailableError extends Error {}

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set.");
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

// 6.4 — free-tier 429s are the most likely real-world failure; back off before giving up.
const RETRY_DELAYS_MS = [1000, 2000, 4000];

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : undefined;
      if (status !== 429 || attempt >= RETRY_DELAYS_MS.length) {
        if (status === 429) {
          throw new GeminiUnavailableError(
            "The assistant is busy right now, please try again in a moment."
          );
        }
        throw err;
      }
      const jitter = Math.random() * 250;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt] + jitter));
    }
  }
}

// 6.1 — a real violation here means the system instruction itself failed; that's a signal
// worth seeing in server logs, not just silently patching over with the disclaimer.
function finalizeResponse(text: string): string {
  const { ok, cleaned } = assertNotDirectAdvice(text);
  if (!ok) {
    console.warn("assertNotDirectAdvice: model output violated the no-direct-advice rule");
  }
  return cleaned;
}

/**
 * One-shot prompt, no conversation history. Used for stock-brief synthesis and structured
 * JSON extraction (profile extraction, stock sentiment/scenarios).
 *
 * `skipGuardrailCheck` must be set for callers that parse the result as JSON: the 6.1
 * direct-advice scanner appends a disclaimer *string* on a violation, which would corrupt JSON
 * structure. Those callers are responsible for running assertNotDirectAdvice themselves on the
 * individual text fields *after* parsing, not on the raw envelope.
 */
export async function askGemini(
  prompt: string,
  systemInstruction?: string,
  thinkingLevel: ThinkingLevel = ThinkingLevel.HIGH, // quality matters more than latency here
  skipGuardrailCheck = false
): Promise<string> {
  try {
    const ai = getClient();
    const response = await withRetry(() =>
      ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: { systemInstruction, thinkingConfig: { thinkingLevel } },
      })
    );
    const text = response.text ?? "";
    return skipGuardrailCheck ? text : finalizeResponse(text);
  } catch (err) {
    console.warn("Gemini request failed, falling back to Claude:", err);
    try {
      const text = await askClaude(prompt, systemInstruction);
      return skipGuardrailCheck ? text : finalizeResponse(text);
    } catch (fallbackErr) {
      console.error("Claude fallback also failed:", fallbackErr);
      throw new GeminiUnavailableError("The assistant is busy right now, please try again in a moment.");
    }
  }
}

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

/** Multi-turn chat, used by the finance-advisor conversation. */
export async function chatWithGemini(
  history: ChatTurn[],
  message: string,
  systemInstruction?: string
): Promise<string> {
  try {
    const ai = getClient();
    const priorTurns: Content[] = history.map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.text }],
    }));
    const chat = ai.chats.create({
      model: MODEL_NAME,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, // latency matters for chat
      },
      history: priorTurns,
    });
    const response = await withRetry(() => chat.sendMessage({ message }));
    return finalizeResponse(response.text ?? "");
  } catch (err) {
    console.warn("Gemini request failed, falling back to Claude:", err);
    try {
      return finalizeResponse(await chatWithClaude(history, message, systemInstruction));
    } catch (fallbackErr) {
      console.error("Claude fallback also failed:", fallbackErr);
      throw new GeminiUnavailableError("The assistant is busy right now, please try again in a moment.");
    }
  }
}
