export const BACKEND_URL = "https://wikit.backroomswiki.top";

export const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
};

export const JSON_HEADERS = {
  ...BROWSER_HEADERS,
  "Content-Type": "application/json",
  "Accept": "application/json"
};

export const GRAPHQL_ENDPOINTS = [
  "https://wikit.unitreaty.org/apiv1/graphql",
  "https://wikittest.unitreaty.org/apiv1/graphql",
];

// 检测 API 是否可用的闭包
export const checkProxyStatus = (() => {
  let lastCheckTime: number = 0;
  let lastStatus: boolean = true; // 初始设为 true，防止刚启动时第一个请求被误杀并阻断

  return (proxyUrl: string): boolean => {
    const now: number = Date.now();
    if (now - lastCheckTime < 100000) {
      return lastStatus;
    }
    lastCheckTime = now;

    fetch(proxyUrl, { headers: BROWSER_HEADERS })
      .then((response: Response) => {
        // 放宽验证：API 返回 4xx 也说明网络和服务是畅通的
        lastStatus = response.ok || response.status < 500;
      })
      .catch(() => {
        lastStatus = false;
      });

    return lastStatus;
  };
})();