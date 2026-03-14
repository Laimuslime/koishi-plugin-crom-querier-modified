import { BACKEND_URL, BROWSER_HEADERS, JSON_HEADERS } from "./client";

export async function getReportChannel(source: string) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/report-channel?source=${source}`, { headers: BROWSER_HEADERS });
    const text = await res.text();
    const data = JSON.parse(text);
    return data.reportChannel || "";
  } catch (e) {
    return "";
  }
}

export async function setReportChannel(token: string, source: string, target: string) {
  const res = await fetch(`${BACKEND_URL}/api/report-channel`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ token, source, target }),
  });
  const text = await res.text();
  return JSON.parse(text);
}