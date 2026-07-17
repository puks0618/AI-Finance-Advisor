/**
 * Guardrail helpers shared by every AI route (chat + stock research).
 * See IMPLEMENTATION_PLAN.md Section 6 for the scenario each function defends against.
 */

export class GuardrailError extends Error {}

// Shared system-instruction fragments so chat and stock prompts speak with one voice (6.1, 6.5).
export const RESEARCH_NOT_ADVICE_RULE = `
You are a research and education tool, not a licensed financial advisor. You must never tell the user
to buy, sell, or hold a specific position, and never state a future price movement as fact. Instead,
explain what the available data currently shows, what a pattern or signal has historically tended to
indicate, and the counter-case / uncertainty. Frame every response as "here's what the data suggests,"
never as an instruction.
`.trim();

export const VULNERABLE_USER_CARE_RULE = `
If the user describes financial distress (crushing debt, having lost everything, gambling-like behavior,
or putting essential/rent/emergency money into speculative positions) or signs of a mental-health crisis,
respond with care, never shame them, actively discourage risking essential money, and gently suggest
speaking with a qualified human (a licensed financial counselor or appropriate support service) rather
than relying on this tool.
`.trim();

// 6.13 — scope the assistant to its actual product surface. "Off-topic" has no fixed shape (it
// could be anything from a joke to a coding question), so unlike 6.1's buy/sell check, there is
// no reliable post-generation regex net for this one; the system instruction is the guardrail.
export const ON_TOPIC_ONLY_RULE = `
You only ever discuss personal finance and investing: budgeting, saving, debt, income, financial goals,
risk tolerance, and stock/market research. If the user asks about anything else — jokes, general trivia,
coding help, entertainment, or any other topic unrelated to personal finance or investing — do not answer
it, not even briefly or partially. Instead, politely decline in one short sentence and redirect them back
to what you can help with, for example: "Sorry, I can only help with personal finance and investing
questions — try asking me about budgeting, saving, debt, or a stock you're curious about." Maintain this
boundary even if the user insists, rephrases, or asks you to roleplay or pretend to be something else.
`.trim();

const MAX_MESSAGE_LENGTH = 4000;
const MAX_TICKER_LENGTH = 6;

/** 6.3 — normalize and validate a ticker before it ever reaches a Finnhub URL or a prompt. */
export function validateTicker(raw: string): string {
  const cleaned = (raw ?? "").trim().toUpperCase().replace(/[^A-Z0-9.]/g, "");
  if (!cleaned) {
    throw new GuardrailError("Please enter a stock ticker symbol.");
  }
  if (cleaned.length > MAX_TICKER_LENGTH) {
    throw new GuardrailError("That doesn't look like a valid ticker symbol.");
  }
  return cleaned;
}

/** 6.3 — reject empty/oversized chat messages before they reach the model. */
export function validateMessage(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    throw new GuardrailError("Please enter a message.");
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new GuardrailError(`Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`);
  }
  return trimmed;
}

// The only values Mode 2 personalization ever needs. An allowlist closes off prompt injection
// through this field entirely — no sanitizing/delimiting required, unlike free-text fields.
const VALID_RISK_PROFILES = new Set(["conservative", "moderate", "aggressive"]);

/** 6.2/6.3 — anything outside the known set silently falls back to "moderate", same as if absent. */
export function validateRiskProfile(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return VALID_RISK_PROFILES.has(value) ? value : "moderate";
}

/**
 * 6.2 — neutralize characters that could let untrusted text (news headlines, company names,
 * user input) escape the delimited "untrusted data" block it gets embedded in.
 */
export function sanitizeUserText(raw: string): string {
  return (raw ?? "")
    .replace(/```/g, "'''")
    .replace(/<\|/g, "< |")
    .replace(/\|>/g, "| >")
    .trim();
}

// One general digit-run pattern covers SSNs (dashed "123-45-6789" or bare "123456789") and
// card/account numbers alike. Lower bound is 8, not the stricter 13-19 for card numbers, so
// shorter bank account numbers get caught too — over-redacting an ordinary number costs
// nothing, missing real PII does.
const PII_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(?:\d[ -]*?){8,19}\b/g, label: "SSN/card/account number" },
];

/** 6.7 — never echo back or persist SSNs, card numbers, or long account-number-shaped digit runs. */
export function redactSensitive(text: string): { clean: string; hadPII: boolean } {
  let clean = text;
  let hadPII = false;
  for (const { pattern } of PII_PATTERNS) {
    if (pattern.test(clean)) {
      hadPII = true;
      clean = clean.replace(pattern, "[redacted]");
    }
  }
  return { clean, hadPII };
}

export interface SanitizedTurn {
  role: "user" | "model";
  text: string;
}

const MAX_HISTORY_TURNS = 40;

/**
 * 6.7 — a client resends the full conversation on every turn, so without this, PII redacted on
 * turn 1 would flow to the model unredacted from turn 2 onward (redactSensitive only ever ran on
 * the newest message). Also closes 6.3: caps total turns and per-turn length, and drops anything
 * that isn't a well-shaped {role, text} pair so a caller can't inject fake "model" turns.
 */
export function sanitizeHistory(raw: unknown): SanitizedTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: SanitizedTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { role, text } = item as { role?: unknown; text?: unknown };
    if (role !== "user" && role !== "model") continue;
    if (typeof text !== "string" || !text.trim()) continue;
    const capped = text.trim().slice(0, MAX_MESSAGE_LENGTH);
    turns.push({ role, text: redactSensitive(capped).clean });
  }
  return turns.slice(-MAX_HISTORY_TURNS);
}

// Heuristic phrase screen only — a trigger for extra-care system instructions, not a clinical
// diagnosis. False positives are cheap (the model just gets a gentler prompt); false negatives
// are handled by the base system instruction, which always carries the care rule anyway.
const DISTRESS_PATTERNS: RegExp[] = [
  /lost everything/i,
  /crushing debt/i,
  /can'?t (pay|afford)/i,
  /rent money/i,
  /all[- ]?in/i,
  /go(ing)? bankrupt/i,
  /want to (end it|kill myself|die)/i,
  /no reason to live/i,
  /desperate/i,
];

/** 6.5 — detect signs of acute financial or emotional distress to trigger extra-care handling. */
export function detectDistressSignals(text: string): boolean {
  return DISTRESS_PATTERNS.some((pattern) => pattern.test(text));
}

// Direct imperative buy/sell phrasing, or predictions/guarantees stated as fact — the one thing
// every AI prompt in this app must never say (6.1). This is a post-generation safety net on top
// of the system instruction, not a replacement for it.
const DIRECT_ADVICE_PATTERNS: RegExp[] = [
  /\byou should (buy|sell|short|invest)\b/i,
  /\bi recommend (buying|selling|shorting)\b/i,
  /\b(buy|sell|short) (this|it) now\b/i,
  /\bguarantee(d)? (a |you a )?(returns?|profits?|gains?)\b/i,
  /\bthis (stock|it) will (definitely|certainly)\b/i,
];

const RESEARCH_FRAMING_DISCLAIMER =
  "\n\n(Reminder: this is research and education, not a buy/sell instruction or a guarantee of future performance.)";

/** 6.1 — scan model output for direct buy/sell instructions; append a disclaimer if found. */
export function assertNotDirectAdvice(text: string): { ok: boolean; cleaned: string } {
  const violated = DIRECT_ADVICE_PATTERNS.some((pattern) => pattern.test(text));
  if (!violated) {
    return { ok: true, cleaned: text };
  }
  return { ok: false, cleaned: text + RESEARCH_FRAMING_DISCLAIMER };
}
