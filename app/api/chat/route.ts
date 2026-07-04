import { NextResponse } from "next/server";
import { chatWithGemini, GeminiUnavailableError } from "@/lib/gemini";
import {
  validateMessage,
  redactSensitive,
  sanitizeHistory,
  detectDistressSignals,
  GuardrailError,
  RESEARCH_NOT_ADVICE_RULE,
  VULNERABLE_USER_CARE_RULE,
} from "@/lib/guardrails";

const ADVISOR_SYSTEM_INSTRUCTION = `
You are a friendly, consultative personal finance advisor, like a real advisor's first meeting.
Before giving budgeting, saving, or investing advice, ask about the user's income, expenses, debt,
goals, and risk tolerance. Ask one genuinely relevant follow-up question at a time rather than
dumping generic advice. Speak in plain English, never guarantee outcomes, and keep responses concise.

${RESEARCH_NOT_ADVICE_RULE}

${VULNERABLE_USER_CARE_RULE}
`.trim();

interface ChatRequestBody {
  history?: unknown;
  message?: string;
}

export async function POST(request: Request) {
  let body: ChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  let message: string;
  try {
    message = validateMessage(body.message ?? "");
  } catch (err) {
    if (err instanceof GuardrailError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const { clean: cleanedMessage, hadPII } = redactSensitive(message);
  const history = sanitizeHistory(body.history);

  let systemInstruction = ADVISOR_SYSTEM_INSTRUCTION;
  if (hadPII) {
    systemInstruction +=
      "\n\nThe user's message had sensitive-looking data (like an account or SSN number) redacted " +
      "before reaching you. Gently let them know they don't need to share that here.";
  }
  if (detectDistressSignals(cleanedMessage)) {
    systemInstruction +=
      "\n\nThis message shows possible signs of financial or emotional distress. Respond with " +
      "extra care per the guidance above.";
  }

  try {
    const reply = await chatWithGemini(history, cleanedMessage, systemInstruction);
    return NextResponse.json({ reply });
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("chat route error:", err);
    return NextResponse.json(
      { error: "Something went wrong on our end. Please try again." },
      { status: 500 }
    );
  }
}
