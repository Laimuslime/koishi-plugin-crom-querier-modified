import { BROWSER_HEADERS } from "./client";

export async function bindQuery(queryType: "qq" | "id" | "all", queryValue: string = "") {
  const url = queryType === "all" 
    ? "https://wikit.unitreaty.org/module/bind-query?all=1" 
    : `https://wikit.unitreaty.org/module/bind-query?${queryType}=${queryValue}`;
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: "error", rawText: text }; }
}