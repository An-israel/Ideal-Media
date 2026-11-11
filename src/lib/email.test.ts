import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
const { isDeliverable, sendEmails, emailConfigured } = await import("./email");

describe("isDeliverable", () => {
  it("accepts a real address", () => {
    expect(isDeliverable("leader@example.com")).toBe(true);
    expect(isDeliverable("  Leader@Example.com ")).toBe(true);
  });

  it("refuses the placeholder given to members added without an email", () => {
    // These are made-up addresses on a domain that receives nothing. Sending to
    // them bounces, and enough bounces gets a sending domain blocked.
    expect(isDeliverable("nm-1234@no-email.ideal-media.app")).toBe(false);
  });

  it("refuses nothing, blanks and things that are not addresses", () => {
    expect(isDeliverable(null)).toBe(false);
    expect(isDeliverable("")).toBe(false);
    expect(isDeliverable("not an email")).toBe(false);
    expect(isDeliverable("a@b")).toBe(false);
  });
});

describe("sendEmails", () => {
  const original = { ...process.env };
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    process.env = { ...original };
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sends nothing, and says why, when email is not set up", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const r = await sendEmails([{ to: "a@example.com", subject: "s", text: "t" }]);

    expect(emailConfigured()).toBe(false);
    expect(r).toMatchObject({ configured: false, sent: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips undeliverable addresses and counts what was sent", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.EMAIL_FROM = "Ideal Media <noreply@example.com>";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const promise = sendEmails([
      { to: "a@example.com", subject: "s", text: "t" },
      { to: "nm-1@no-email.ideal-media.app", subject: "s", text: "t" },
      { to: "b@example.com", subject: "s", text: "t" },
    ]);
    await vi.runAllTimersAsync();
    const r = await promise;

    expect(r).toMatchObject({ configured: true, sent: 2, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.from).toBe("Ideal Media <noreply@example.com>");
    expect(body.to).toEqual(["a@example.com"]);
  });

  it("reports a failure instead of throwing", async () => {
    // The caller has already written the in-app notification; a provider
    // outage must not turn the whole reminder run into an error.
    process.env.RESEND_API_KEY = "test-key";
    process.env.EMAIL_FROM = "noreply@example.com";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "domain not verified" })
    );

    const promise = sendEmails([{ to: "a@example.com", subject: "s", text: "t" }]);
    await vi.runAllTimersAsync();
    const r = await promise;

    expect(r.sent).toBe(0);
    expect(r.failed).toBe(1);
    expect(r.note).toContain("domain not verified");
  });

  it("survives the network itself failing", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.EMAIL_FROM = "noreply@example.com";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const promise = sendEmails([{ to: "a@example.com", subject: "s", text: "t" }]);
    await vi.runAllTimersAsync();
    const r = await promise;

    expect(r).toMatchObject({ sent: 0, failed: 1 });
  });
});
