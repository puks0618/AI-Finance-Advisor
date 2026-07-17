// Vapi's phone number on this account is a free-tier number, which can only place domestic
// (US/Canada, NANP "+1") calls — confirmed via Vapi's call logs, endedReason
// "call.start.error-vapi-number-international". Kept in its own file (rather than lib/vapi.ts,
// which reads server-only secrets) so this pure check can be imported from client components too.
export function isDomesticNumber(phoneNumberE164: string): boolean {
  return /^\+1\d{10}$/.test(phoneNumberE164);
}
