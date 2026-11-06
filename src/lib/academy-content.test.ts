import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { videosFor, isDualLesson } from "./academy-content";
import type { AcademyVideos } from "./database.types";

const v = (id: string) => ({
  youtube_id: id,
  title: `Video ${id}`,
  url: `https://www.youtube.com/watch?v=${id}`,
});

describe("videosFor", () => {
  it("gives the device's own list when there is one", () => {
    const videos: AcademyVideos = { phone: [v("aaaaaaaaaaa")], laptop: [v("bbbbbbbbbbb")] };
    expect(videosFor(videos, "phone")[0].youtube_id).toBe("aaaaaaaaaaa");
    expect(videosFor(videos, "laptop")[0].youtube_id).toBe("bbbbbbbbbbb");
  });

  it("gives the shared list to both devices when a lesson has one", () => {
    // Most lessons are theory and the same video serves everybody. Returning
    // nothing for "phone" here would leave a blank player on a lesson that has
    // a perfectly good video.
    const videos: AcademyVideos = { any: [v("ccccccccccc")] };
    expect(videosFor(videos, "phone")[0].youtube_id).toBe("ccccccccccc");
    expect(videosFor(videos, "laptop")[0].youtube_id).toBe("ccccccccccc");
  });

  it("falls back to the other device rather than showing nothing", () => {
    const videos: AcademyVideos = { phone: [v("ddddddddddd")] };
    expect(videosFor(videos, "laptop")[0].youtube_id).toBe("ddddddddddd");
  });

  it("returns an empty list when a lesson genuinely has no video", () => {
    expect(videosFor({}, "phone")).toEqual([]);
    expect(videosFor({ phone: [] }, "phone")).toEqual([]);
  });

  it("keeps the backups after the main video", () => {
    // The order is the content's: first is the lesson's video, the rest are
    // there for when one is taken down.
    const videos: AcademyVideos = { any: [v("eeeeeeeeeee"), v("fffffffffff")] };
    expect(videosFor(videos, "phone").map((x) => x.youtube_id)).toEqual([
      "eeeeeeeeeee",
      "fffffffffff",
    ]);
  });
});

describe("isDualLesson", () => {
  it("is true only when both devices have their own videos", () => {
    expect(isDualLesson({ phone: [v("aaaaaaaaaaa")], laptop: [v("bbbbbbbbbbb")] })).toBe(true);
    expect(isDualLesson({ any: [v("ccccccccccc")] })).toBe(false);
    expect(isDualLesson({ phone: [v("ddddddddddd")] })).toBe(false);
    expect(isDualLesson({ phone: [], laptop: [v("eeeeeeeeeee")] })).toBe(false);
  });
});

/**
 * The course content is a data file, not code, so nothing else would notice if
 * it were edited into a shape the importer or the pages cannot handle. These
 * run against the file that actually ships.
 */
describe("the academy content that ships with the app", () => {
  const data = JSON.parse(readFileSync(join(process.cwd(), "src/data/academy.json"), "utf8"));
  const courses = data.courses as {
    slug: string;
    title: string;
    position: number;
    category: string;
    level: string;
    cover: string;
    tagline: string;
    description: string;
    dual: boolean;
    modules: {
      position: number;
      title: string;
      lessons: { position: number; title: string; practical?: boolean; videos: AcademyVideos }[];
      assignment: { kind: string; title: string; instructions: string; checklist?: string[] };
    }[];
  }[];

  it("has every course the department sent", () => {
    expect(courses).toHaveLength(22);
    expect(new Set(courses.map((c) => c.slug)).size).toBe(22);
  });

  it("ships the cover image every course points at", () => {
    for (const c of courses) {
      expect(c.cover, `${c.slug} cover path`).toMatch(/^\/academy\/covers\/.+\.webp$/);
      expect(existsSync(join(process.cwd(), "public", c.cover)), `${c.slug} cover file`).toBe(
        true
      );
    }
  });

  it("numbers modules and lessons from 1 with no gaps", () => {
    // The importer matches on position, so a gap or a repeat would make it
    // update the wrong row and silently move somebody's progress.
    for (const c of courses) {
      expect(c.modules.map((m) => m.position), c.slug).toEqual(
        c.modules.map((_, i) => i + 1)
      );
      for (const m of c.modules) {
        expect(m.lessons.map((l) => l.position), `${c.slug} m${m.position}`).toEqual(
          m.lessons.map((_, i) => i + 1)
        );
      }
    }
  });

  it("gives every lesson at least one playable video", () => {
    for (const c of courses) {
      for (const m of c.modules) {
        for (const l of m.lessons) {
          const all = Object.values(l.videos ?? {}).flat();
          expect(all.length, `${c.slug} ${l.title}`).toBeGreaterThan(0);
          for (const video of all) {
            expect(video.youtube_id, `${c.slug} ${l.title}`).toMatch(/^[A-Za-z0-9_-]{11}$/);
            expect(video.url).toContain(video.youtube_id);
            expect(video.title.trim().length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("only uses assignment kinds the database enum accepts", () => {
    for (const c of courses) {
      for (const m of c.modules) {
        expect(["self_check", "link"], `${c.slug} m${m.position}`).toContain(
          m.assignment.kind
        );
        expect(m.assignment.instructions.trim().length).toBeGreaterThan(0);
        if (m.assignment.kind === "self_check") {
          // A self-check with no checklist is a box the member can never tick.
          expect(m.assignment.checklist?.length ?? 0).toBeGreaterThan(0);
        }
      }
    }
  });

  it("has no string left cut off by the page it was printed on", () => {
    // The content was rebuilt from a PDF whose long lines were truncated at the
    // margin. A value that ends mid-sentence means a repair was missed.
    for (const c of courses) {
      for (const field of ["tagline", "description"] as const) {
        expect(c[field].trim(), `${c.slug} ${field}`).toMatch(/[.!?]$/);
      }
      for (const m of c.modules) {
        expect(m.assignment.instructions.trim(), `${c.slug} m${m.position}`).toMatch(/[.!?]$/);
      }
    }
  });

  it("does not let the `dual` flag decide whether there is a device toggle", () => {
    // `dual` is about equipment, not videos: Cinematography is dual because
    // you can shoot it on a phone or a camera, yet every one of its lessons
    // has a single video for everybody. Three courses are like this, so a
    // toggle driven by the flag would do nothing on those pages.
    const flagged = courses.filter((c) => c.dual).map((c) => c.slug);
    const reallySplit = courses
      .filter((c) => c.modules.flatMap((m) => m.lessons).some((l) => isDualLesson(l.videos)))
      .map((c) => c.slug);

    expect(flagged).toContain("cinematography");
    expect(reallySplit).not.toContain("cinematography");
    // Every course whose lessons split must be reachable on both devices.
    for (const slug of reallySplit) {
      expect(flagged, `${slug} splits by device but is not marked dual`).toContain(slug);
    }
  });

  it("never leaves a device with no video on a lesson that splits", () => {
    for (const c of courses) {
      for (const m of c.modules) {
        for (const l of m.lessons) {
          expect(videosFor(l.videos, "phone").length, `${c.slug} ${l.title} on a phone`)
            .toBeGreaterThan(0);
          expect(videosFor(l.videos, "laptop").length, `${c.slug} ${l.title} on a laptop`)
            .toBeGreaterThan(0);
        }
      }
    }
  });
});
