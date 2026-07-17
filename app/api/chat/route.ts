import { NextResponse } from "next/server";
import { chatWithGemini, GeminiUnavailableError, type ChatTurn } from "@/lib/gemini";
import { extractProfile } from "@/lib/profile-extraction";
import { createClient } from "@/lib/supabase/server";
import {
  validateMessage,
  redactSensitive,
  sanitizeHistory,
  detectDistressSignals,
  GuardrailError,
  RESEARCH_NOT_ADVICE_RULE,
  VULNERABLE_USER_CARE_RULE,
  ON_TOPIC_ONLY_RULE,
} from "@/lib/guardrails";

// Vercel's default serverless timeout (10s on Hobby) can be too tight once a Gemini reply,
// the follow-up extractProfile call, and a possible Claude fallback stack up. 60s is the
// Hobby-tier ceiling.
export const maxDuration = 60;

const ADVISOR_SYSTEM_INSTRUCTION = `
You are a friendly, consultative personal finance advisor, like a real advisor's first meeting.
Before giving budgeting, saving, or investing advice, ask about the user's income, expenses, debt,
goals, and risk tolerance. Ask one genuinely relevant follow-up question at a time rather than
dumping generic advice. Speak in plain English, never guarantee outcomes, and keep responses concise.

${ON_TOPIC_ONLY_RULE}

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
    await persistTurnAndExtractProfile(history, cleanedMessage, reply);
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

// Persistence and profile extraction are a nice-to-have side effect of an authenticated
// conversation, not something the user is waiting on — a Supabase hiccup here must never
// break the reply that already generated successfully, so failures are logged, not thrown.
async function persistTurnAndExtractProfile(history: ChatTurn[], message: string, reply: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from("conversations").insert([
      { user_id: user.id, role: "user", text: message },
      { user_id: user.id, role: "model", text: reply },
    ]);

    const conversationText = [...history, { role: "user", text: message }, { role: "model", text: reply }]
      .map((turn) => `${turn.role}: ${turn.text}`)
      .join("\n");
    const extracted = await extractProfile(conversationText);

    if (Object.keys(extracted).length > 0) {
      await supabase
        .from("profiles")
        .upsert({ id: user.id, ...extracted, updated_at: new Date().toISOString() });
    }
  } catch (err) {
    console.error("persistTurnAndExtractProfile error:", err);
  }
}
