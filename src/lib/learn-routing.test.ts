import { describe, it, expect } from "vitest";
import { learnRedirect } from "./learn-routing";

describe("learnRedirect", () => {
  it("keeps a learner inside /learn", () => {
    expect(learnRedirect("/learn", "learner")).toBeNull();
    expect(learnRedirect("/learn/graphic-design", "learner")).toBeNull();
    expect(learnRedirect("/learn/graphic-design/certificate", "learner")).toBeNull();
  });

  it("sends a learner away from every department page", () => {
    for (const path of [
      "/dashboard",
      "/coc",
      "/academy",
      "/secretary/roster",
      "/attendance",
      "/welfare",
      "/admin",
      "/subunits",
      "/training",
      "/profile",
    ]) {
      expect(learnRedirect(path, "learner"), path).toBe("/learn");
    }
  });

  it("does not mistake a path that merely starts with the letters for /learn", () => {
    expect(learnRedirect("/learners", "learner")).toBe("/learn");
    expect(learnRedirect("/learning-hack", "learner")).toBe("/learn");
  });

  it("sends a member to the same page in their own academy", () => {
    expect(learnRedirect("/learn", "member")).toBe("/academy");
    expect(learnRedirect("/learn/graphic-design", "member")).toBe("/academy/graphic-design");
    expect(learnRedirect("/learn/graphic-design/certificate", "member")).toBe(
      "/academy/graphic-design/certificate"
    );
    expect(learnRedirect("/learn/signup", "member")).toBe("/academy");
  });

  it("leaves members on their own pages alone", () => {
    expect(learnRedirect("/dashboard", "member")).toBeNull();
    expect(learnRedirect("/academy/graphic-design", "member")).toBeNull();
  });

  it("changes nothing for an account that is neither", () => {
    expect(learnRedirect("/dashboard", "neither")).toBeNull();
    expect(learnRedirect("/learn", "neither")).toBeNull();
  });
});
