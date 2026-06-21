import "server-only";

/**
 * Fetches a Google Sheet by its shareable link and returns it as a CSV buffer
 * (so the existing spreadsheet parser can read it). The sheet must be shared
 * as "Anyone with the link → Viewer" — otherwise Google returns a login page.
 */
export async function fetchSheetAsBuffer(url: string): Promise<Buffer> {
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) {
    throw new Error("That doesn't look like a Google Sheets link.");
  }
  const id = idMatch[1];
  const gidMatch = url.match(/[#&?]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : "0";
  const exportUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;

  let res: Response;
  try {
    res = await fetch(exportUrl, { redirect: "follow" });
  } catch {
    throw new Error("Couldn't reach Google Sheets. Check the link and try again.");
  }
  if (!res.ok) {
    throw new Error(
      "Couldn't open that sheet. In Google Sheets: Share → General access → 'Anyone with the link' (Viewer), then paste the link again."
    );
  }
  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    throw new Error(
      "That sheet isn't public yet. In Google Sheets: Share → General access → 'Anyone with the link' (Viewer), then paste the link again."
    );
  }
  return Buffer.from(text, "utf-8");
}
