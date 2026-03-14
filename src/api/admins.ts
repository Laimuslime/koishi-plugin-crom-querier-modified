import { BACKEND_URL, BROWSER_HEADERS } from "./client";

export async function getAdmins() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/admins`, { headers: BROWSER_HEADERS });
    const text = await res.text();
    const data = JSON.parse(text);
    return (data && Array.isArray(data.admins)) ? data.admins.map(String) : [];
  } catch (e) {
    return [];
  }
}