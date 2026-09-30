/**
 * The MIME type to store an uploaded teaching under.
 *
 * Derived from the FILE EXTENSION, not from `file.type`. Browsers disagree
 * about what a `.m4a` is — Chrome on Windows often reports `audio/x-m4a`, and
 * sometimes an empty string — and the old code fell back to `audio/mpeg` when
 * it was empty. That labels an MP4/AAC container as an MP3, which is not a
 * cosmetic mistake: a player handed the wrong type can pick the wrong demuxer,
 * stall at 0:00 and never report a duration.
 *
 * When the extension isn't one we know, `application/octet-stream` is returned
 * rather than a confident guess — an unknown type makes a player sniff the
 * container, which is right, whereas a wrong type makes it trust us.
 */
const AUDIO: Record<string, string> = {
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

const VIDEO: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
};

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

export function contentTypeForUpload(
  filename: string,
  mediaType: "audio" | "video",
  browserType?: string
): string {
  const table = mediaType === "video" ? VIDEO : AUDIO;
  const known = table[extensionOf(filename)];
  if (known) return known;

  // No match on extension. The browser's own guess is better than nothing, but
  // only when it is actually a media type — Windows hands out things like
  // "application/octet-stream" and, for .m4a, occasionally "" .
  const fromBrowser = (browserType ?? "").trim().toLowerCase();
  if (fromBrowser.startsWith("audio/") || fromBrowser.startsWith("video/")) {
    return fromBrowser;
  }
  return "application/octet-stream";
}
