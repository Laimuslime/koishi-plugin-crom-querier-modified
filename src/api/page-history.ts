import { BROWSER_HEADERS } from "./client";

export async function pageHistory(wikiName: string, pageUrl: string) {
  const apiUrl = `https://wikit.unitreaty.org/wikidot/pagehistory?wiki=${wikiName}&page=${encodeURIComponent(pageUrl)}`;
  const res = await fetch(apiUrl, { headers: BROWSER_HEADERS });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: "error", rawText: text }; }
}