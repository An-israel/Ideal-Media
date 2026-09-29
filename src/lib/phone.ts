import { DEFAULT_COUNTRY_CODE } from "@/lib/constants";

/**
 * Normalises a phone number to bare international digits (no `+`), which is
 * what wa.me requires (AUDIT CRS-3).
 *
 * Numbers are entered and imported in every local shape — "0803 123 4567",
 * "+234 803 123 4567", "234-803-123-4567". `buildWhatsAppLink` previously just
 * stripped non-digits, so a locally-formatted number produced
 * `wa.me/08031234567`, which WhatsApp rejects. Since WhatsApp is the only
 * assignment-submission channel, that silently broke the core LMS loop.
 *
 * Returns null when there aren't enough digits to be a real number.
 */
export function normalizePhone(
  raw: string | null | undefined,
  countryCode: string = DEFAULT_COUNTRY_CODE
): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  const hadPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  // 00 is the other way of writing a leading +.
  const isInternational = hadPlus || digits.startsWith("00");
  if (digits.startsWith("00")) digits = digits.slice(2);

  // Shortest plausible subscriber number. Without this floor, "123" sailed
  // through the bare-subscriber branch below and came back as "234123".
  const MIN_SUBSCRIBER_DIGITS = 7;

  if (isInternational) {
    // Already international — trust it, but it still has to be long enough to
    // be a real number (country code + subscriber).
    return digits.length >= MIN_SUBSCRIBER_DIGITS + 1 ? digits : null;
  }

  // Local trunk form: a leading 0 stands in for the country code.
  if (digits.startsWith("0")) {
    const subscriber = digits.replace(/^0+/, "");
    return subscriber.length >= MIN_SUBSCRIBER_DIGITS ? `${countryCode}${subscriber}` : null;
  }

  // Already carries the country code.
  if (digits.startsWith(countryCode)) {
    const subscriber = digits.slice(countryCode.length);
    return subscriber.length >= MIN_SUBSCRIBER_DIGITS ? digits : null;
  }

  // A bare subscriber number (no trunk 0, no country code).
  if (digits.length <= 10) {
    return digits.length >= MIN_SUBSCRIBER_DIGITS ? `${countryCode}${digits}` : null;
  }

  return digits.length >= MIN_SUBSCRIBER_DIGITS + 1 ? digits : null;
}

/**
 * Comparison key for matching two numbers that may be written differently.
 * The last 9 digits are the subscriber part in the numbering plans we handle,
 * so "08031234567" and "+2348031234567" compare equal.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  const normalized = normalizePhone(raw);
  if (!normalized) return null;
  const key = normalized.slice(-9);
  return key.length >= 7 ? key : null;
}

/** Build a wa.me link with a prefilled, URL-encoded message. */
export function buildWhatsAppLink(whatsapp: string, message: string): string | null {
  const normalized = normalizePhone(whatsapp);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
