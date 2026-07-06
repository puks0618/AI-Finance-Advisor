import { ThinkingLevel } from "@google/genai";
import { askGemini } from "./gemini";

export interface ExtractedProfile {
  income?: number;
  expenses?: number;
  debt?: number;
  risk_tolerance?: "conservative" | "moderate" | "aggressive";
  goal?: string;
  preference?: string;
}

const EXTRACTION_INSTRUCTION = `
Given a personal-finance conversation, extract ONLY the fields the user has clearly and
explicitly stated so far. Never guess or infer a value that wasn't actually said.

Return strict JSON, nothing else, no markdown fences:
{"income": number|null, "expenses": number|null, "debt": number|null,
 "risk_tolerance": "conservative"|"moderate"|"aggressive"|null, "goal": string|null, "preference": string|null}

income/expenses/debt are monthly dollar amounts, numbers only (no currency symbols or commas).
Omit or null any field not clearly stated yet.
`.trim();

const VALID_RISK_TOLERANCES = new Set(["conservative", "moderate", "aggressive"]);

/**
 * Runs a second, lightweight Gemini call to turn the conversation so far into a structured
 * profile update. Failure here (a malformed or non-JSON response) degrades to "nothing new
 * learned this turn" rather than breaking the chat reply the user is actually waiting on.
 */
export async function extractProfile(conversationText: string): Promise<ExtractedProfile> {
  try {
    const raw = await askGemini(
      `Conversation so far:\n${conversationText}`,
      EXTRACTION_INSTRUCTION,
      ThinkingLevel.MINIMAL
    );
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    const result: ExtractedProfile = {};
    if (typeof parsed.income === "number") result.income = parsed.income;
    if (typeof parsed.expenses === "number") result.expenses = parsed.expenses;
    if (typeof parsed.debt === "number") result.debt = parsed.debt;
    if (VALID_RISK_TOLERANCES.has(parsed.risk_tolerance)) {
      result.risk_tolerance = parsed.risk_tolerance;
    }
    if (typeof parsed.goal === "string" && parsed.goal.trim()) {
      result.goal = parsed.goal.trim();
    }
    if (typeof parsed.preference === "string" && parsed.preference.trim()) {
      result.preference = parsed.preference.trim();
    }
    return result;
  } catch {
    return {};
  }
}
