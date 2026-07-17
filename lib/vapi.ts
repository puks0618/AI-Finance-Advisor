/**
 * Thin wrapper around Vapi's REST API for placing the conversational advisor call — a stored
 * Assistant backed by the Custom LLM proxy, which needs Gemini/Claude.
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
