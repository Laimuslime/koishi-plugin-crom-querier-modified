import { BACKEND_URL, JSON_HEADERS } from "./client";

export async function botBan(token: string, type: string, value: string) {
  const res = await fetch(`${BACKEND_URL}/api/bot-ban`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ token, type, value }),
  });
  const text = await res.text();
  return JSON.parse(text);
}