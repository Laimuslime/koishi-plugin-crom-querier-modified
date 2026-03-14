import { BACKEND_URL, BROWSER_HEADERS } from "./client";

export async function getBlacklist() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/blacklist`, { headers: BROWSER_HEADERS });
    const text = await res.text();
    const data = JSON.parse(text);
    return data || { qqs: [], wikidots: [] };
  } catch (e) {
    return { qqs: [], wikidots: [] };
  }
}