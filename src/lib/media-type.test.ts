import { describe, it, expect } from "vitest";
import { contentTypeForUpload, extensionOf } from "./media-type";
import { ACCEPTED_TEACHING_AUDIO, ACCEPTED_TEACHING_VIDEO } from "./constants";

describe("extensionOf", () => {
  it("reads the last extension, lowercased", () => {
    expect(extensionOf("Essence_of_media.M4A")).toBe(".m4a");
    expect(extensionOf("part 1.final.mp3")).toBe(".mp3");
  });
  it("returns empty when there is no extension", () => {
    expect(extensionOf("teaching")).toBe("");
  });
});

describe("contentTypeForUpload", () => {
  it("labels .m4a as MP4 audio, not MP3", () => {
    // The bug: an empty file.type fell back to audio/mpeg, so an AAC/MP4
    // container was served as an MP3 and stalled at 0:00.
    expect(contentTypeForUpload("teaching.m4a", "audio", "")).toBe("audio/mp4");
    expect(contentTypeForUpload("teaching.m4a", "audio", "audio/x-m4a")).toBe("audio/mp4");
  });

  it("ignores a browser type that disagrees with the extension", () => {
    expect(contentTypeForUpload("part1.mp3", "audio", "application/octet-stream")).toBe(
      "audio/mpeg"
    );
  });

  it("covers every accepted audio extension", () => {
    for (const ext of ACCEPTED_TEACHING_AUDIO) {
      const type = contentTypeForUpload(`teaching${ext}`, "audio");
      expect(type.startsWith("audio/"), `${ext} → ${type}`).toBe(true);
    }
  });

  it("covers every accepted video extension", () => {
    for (const ext of ACCEPTED_TEACHING_VIDEO) {
      const type = contentTypeForUpload(`teaching${ext}`, "video");
      expect(type.startsWith("video/"), `${ext} → ${type}`).toBe(true);
    }
  });

  it("falls back to the browser's type when the extension is unknown", () => {
    expect(contentTypeForUpload("teaching.xyz", "audio", "audio/flac")).toBe("audio/flac");
  });

  it("never invents a specific type it isn't sure of", () => {
    // octet-stream makes a player sniff the container; a wrong specific type
    // makes it trust us and fail.
    expect(contentTypeForUpload("teaching.xyz", "audio", "")).toBe("application/octet-stream");
    expect(contentTypeForUpload("teaching", "video", "text/plain")).toBe(
      "application/octet-stream"
    );
  });
});
