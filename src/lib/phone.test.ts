import { describe, it, expect } from "vitest";
import { normalizePhone, phoneKey, buildWhatsAppLink } from "./phone";

describe("normalizePhone", () => {
  it("converts a local trunk number to international digits", () => {
    // The old code just stripped non-digits, producing wa.me/08031234567,
    // which WhatsApp rejects (CRS-3).
    expect(normalizePhone("08031234567")).toBe("2348031234567");
  });

  it("keeps an already-international number", () => {
    expect(normalizePhone("+234 803 123 4567")).toBe("2348031234567");
    expect(normalizePhone("2348031234567")).toBe("2348031234567");
  });

  it("treats a leading 00 as +", () => {
    expect(normalizePhone("002348031234567")).toBe("2348031234567");
  });

  it("strips spaces, dashes and brackets", () => {
    expect(normalizePhone("(0803) 123-4567")).toBe("2348031234567");
  });

  it("adds the country code to a bare subscriber number", () => {
    expect(normalizePhone("8031234567")).toBe("2348031234567");
  });

  it("honours a different country code", () => {
    expect(normalizePhone("07700900123", "44")).toBe("447700900123");
  });

  it("returns null for blanks and junk", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("n/a")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
  });
});

describe("phoneKey", () => {
  it("matches the same number written in different forms", () => {
    const a = phoneKey("08031234567");
    const b = phoneKey("+2348031234567");
    const c = phoneKey("234 803 123 4567");
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("does not match different numbers", () => {
    expect(phoneKey("08031234567")).not.toBe(phoneKey("08031234568"));
  });

  it("returns null when there aren't enough digits", () => {
    expect(phoneKey("12")).toBeNull();
    expect(phoneKey("")).toBeNull();
  });
});

describe("buildWhatsAppLink", () => {
  it("builds a wa.me link with an encoded message", () => {
    const link = buildWhatsAppLink("08031234567", "Hello there & welcome");
    expect(link).toBe("https://wa.me/2348031234567?text=Hello%20there%20%26%20welcome");
  });

  it("returns null rather than a dead link for an unusable number", () => {
    expect(buildWhatsAppLink("n/a", "hi")).toBeNull();
    expect(buildWhatsAppLink("", "hi")).toBeNull();
  });
});
