import { BROWSER_HEADERS } from "./client";

export async function userRank(user: string) {
  try {
    const rankRes = await fetch(`https://wikit.unitreaty.org/wikidot/rank?user=${user}`, { headers: BROWSER_HEADERS });
    const rankText = await rankRes.text();
    const cleanText = rankText.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
    return cleanText.trim().split("\n").filter(line => line.trim() !== "");
  } catch (e) {
    return ["排名信息获取失败。"];
  }
}