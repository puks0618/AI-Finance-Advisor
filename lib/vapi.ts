/**
 * Thin wrapper around Vapi's REST API. Two distinct call shapes are used in this app:
 *  - a verification call (this file): a transient assistant that just speaks a code and hangs
 *    up — no model/conversation needed, so it never touches the /api/vapi-llm proxy.
 *  - the conversational advisor call (built separately): a stored Assistant backed by the
 *    Custom LLM proxy, which does need Gemini/Claude.
 */

const BASE_URL = "https://api.vapi.ai";

function getApiKey(): string {
  const key = process.env.VAPI_API_KEY;
  if (!key) {
    throw new Error("VAPI_API_KEY is not set.");
  }
  return key;
}

function getPhoneNumberId(): string {
  const id = process.env.VAPI_PHONE_NUMBER_ID;
  if (!id) {
    throw new Error("VAPI_PHONE_NUMBER_ID is not set.");
  }
  return id;
}

function getAssistantId(): string {
  const id = process.env.VAPI_ASSISTANT_ID;
  if (!id) {
    throw new Error(
      "VAPI_ASSISTANT_ID is not set — the conversational Assistant hasn't been created yet " +
        "(it needs a public URL for the /api/vapi-llm proxy, e.g. via ngrok)."
    );
  }
  return id;
}

export class VapiError extends Error {}

async function vapiRequest<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new VapiError(`Vapi request to ${path} failed (${res.status}): ${detail}`);
  }
  return res.json();
}

// Two consecutive identical digits (e.g. "...500") are genuinely hard to count correctly when
// read aloud back-to-back over a phone call — a real user missed a trailing "0" from "204500"
// this way. Regenerating on that pattern removes the failure mode instead of asking people to
// listen more carefully.
function hasRepeatedConsecutiveDigit(code: string): boolean {
  return /(\d)\1/.test(code);
}

export function generateVerificationCode(): string {
  let code: string;
  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (hasRepeatedConsecutiveDigit(code));
  return code;
}

// Grouped into two triads ("2 0 4 ... 5 3 1") like a phone number, not six digits in a flat row —
// easier to hold in short-term memory than an undifferentiated run of digits.
function speakDigits(code: string): string {
  const digits = code.split("");
  const first = digits.slice(0, 3).join(", ");
  const second = digits.slice(3).join(", ");
  return `${first}... ${second}`;
}

/**
 * Places a short, one-way call that speaks a verification code and hangs up. No conversation —
 * `endCallPhrases` ends the call right after the goodbye line, and maxDurationSeconds is a hard
 * safety cutoff regardless. Deliberately uses a bare Google model directly (not the Custom LLM
 * proxy): this call never needs a real conversational turn, so the Gemini/Claude fallback
 * machinery built for the advisor call would be pure unused overhead here.
 */
export async function placeVerificationCall(phoneNumberE164: string, code: string): Promise<{ id: string }> {
  const spoken = speakDigits(code);
  return vapiRequest("/call", {
    phoneNumberId: getPhoneNumberId(),
    customer: { number: phoneNumberE164 },
    assistant: {
      name: "AI Finance Advisor — Verification",
      firstMessageMode: "assistant-speaks-first",
      firstMessage: `Your AI Finance Advisor verification code is ${spoken}. One more time, that's ${spoken}. Goodbye.`,
      endCallPhrases: ["Goodbye"],
      maxDurationSeconds: 30,
      model: {
        provider: "google",
        model: "gemini-3.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You only ever say the exact first message you were given, then end the call. " +
              "Never engage in conversation, even if the caller speaks to you.",
          },
        ],
      },
      voice: { provider: "vapi", voiceId: "Elliot", speed: 0.85 },
    },
  });
}

/**
 * Places a real outbound call to the stored conversational Assistant (Custom-LLM-backed, so it
 * gets the real Gemini/Claude fallback). `contextBrief` fills the `{{ contextBrief }}` template
 * variable in the Assistant's system prompt via LiquidJS-style variableValues — this is how a
 * fired alert's details (or the general profile summary) reach the call without needing a
 * different Assistant per call.
 */
export async function placeAdvisorCall(phoneNumberE164: string, contextBrief: string): Promise<{ id: string }> {
  return vapiRequest("/call", {
    phoneNumberId: getPhoneNumberId(),
    assistantId: getAssistantId(),
    customer: { number: phoneNumberE164 },
    assistantOverrides: {
      variableValues: { contextBrief },
    },
  });
}
