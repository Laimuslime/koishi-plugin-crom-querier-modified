import { BROWSER_HEADERS } from "./client";

export async function memberAdminRequest(payload: Record<string, string>) {
  try {
    const res = await fetch("https://wikit.unitreaty.org/wikidot/member-admin", {
      method: "POST",
      headers: { 
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": BROWSER_HEADERS["User-Agent"]
      },
      body: new URLSearchParams(payload).toString()
    });
    const text = await res.text();
    
    let isSuccess = text.includes("success");
    let errorMessage = text;
    let extraInfo = "";

    try {
      let data = JSON.parse(text);
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch(e) {}
      }
      
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        if (data.status) isSuccess = (data.status === 'success' || data.status === 'ok');
        if (data.message) errorMessage = data.message;
        else if (data.error) errorMessage = data.error;
        if (data.CURRENT_TIMESTAMP) extraInfo += ` (戳:${data.CURRENT_TIMESTAMP})`;
      } else {
        throw new Error("Fallback");
      }
    } catch (err) {
      const cleanStr = text.replace(/\n|\r/g, ' '); 
      const extract = (k: string) => {
        const r = new RegExp(`['"]?${k}['"]?\\s*:\\s*(.*?)(?:,\\s*['"]?\\w+['"]?\\s*:|\\s*\\}$)`);
        const m = cleanStr.match(r);
        return m && m[1] ? m[1].replace(/^['"]+|['"]+$/g, '').trim() : null;
      };
      const sVal = extract("status");
      const mVal = extract("message") || extract("error");
      if (sVal) isSuccess = (sVal === "success" || sVal === "ok");
      if (mVal) errorMessage = mVal;
      const tVal = extract("CURRENT_TIMESTAMP");
      if (tVal) extraInfo += ` (戳:${tVal})`;
    }
    return { isSuccess, errorMessage: errorMessage + extraInfo };
  } catch (e: any) {
    return { isSuccess: false, errorMessage: `请求异常: ${e.message}` };
  }
}