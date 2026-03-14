import { BROWSER_HEADERS } from "./client";

export async function qqVerify(qq: string, token: string) {
  const res = await fetch("https://wikit.unitreaty.org/module/qq-verify", {
    method: "POST",
    headers: { 
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": BROWSER_HEADERS["User-Agent"]
    },
    body: new URLSearchParams({ qq, token }).toString(),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: "error", rawText: text }; }
}