import type { Article, AuthorRank, TitleQueryResponse, UserQueryResponse, UserRankQueryResponse } from "./types";

const apiList: string[] = [
  "https://wikit.unitreaty.org/apiv1/graphql",
  "https://wikittest.unitreaty.org/apiv1/graphql",
];

export const branchInfo: Record<string, { wiki: string }> = {
  /* 分部名称格式："站点简写": { wiki: "Wikit里的Wiki全名" }, 例如："ubmh": { wiki: "ubmh" } */
  "ubmh": { wiki: "ubmh" },
  "scp-cloud": { wiki: "scp-wiki-cloud" },
  "cloud": { wiki: "backroom-wiki-cn" },
  "scr": { wiki: "scr-wiki" },
  "dfc": { wiki: "deep-forest-club" },
  "rule": { wiki: "rule-wiki" },
  "as": { wiki: "asbackroom" },
  "lm": { wiki: "lostmedia" },
  "if": { wiki: "if-backrooms" },
  "rpc": { wiki: "rpc-wiki-cn" },
  "warma": { wiki: "warma-world" },
  "fr": { wiki: "backrooms-split-library" },
  "f": { wiki: "backrooms-f" },
};

function levenshtein(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, 
        matrix[i][j - 1] + 1, 
        matrix[i - 1][j - 1] + cost 
      );
    }
  }

  return matrix[a.length][b.length];
}

export async function wikitApiRequest(
  param: string,
  name: string,
  endpointIndex: number = 0,
  queryString: string,
): Promise<TitleQueryResponse | UserQueryResponse | UserRankQueryResponse> {
  if (endpointIndex >= apiList.length) {
    throw new Error("所有API端点均已尝试但均失败");
  }

  let variables: Record<string, any> = {};
  const branchLongName: string | null = branchInfo[name]?.wiki;

   if (queryString.includes("query titleQuery")) {
    variables = { query: param, anyBaseUrl: branchLongName ? [branchLongName] : null };
  } else if (queryString.includes("query userQuery")) {
    variables = { query: param, baseUrl: branchLongName };
  } else if (queryString.includes("query userRankQuery")) {
    variables = { baseUrl: branchLongName };
  } else if (queryString.includes("query userGlobalQuery")) {
    variables = { query: param };
  }

  try {
    const response: Response = await fetch(apiList[endpointIndex], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: queryString, variables }),
    });

    if (!response.ok) {
      throw new Error(`请求失败，状态码: ${response.status}`);
    }

    const { data, errors } = await response.json();

    if (errors && errors.length > 0) {
      return await wikitApiRequest(param, name, endpointIndex + 1, queryString);
    }

    if (queryString.includes("query titleQuery") && data.articles?.nodes?.length) {
      const articles: Article[] = data.articles.nodes;
      const lowerParam = param.toLowerCase();
      let bestArticle: Article | null = null;
      let minDistance = Infinity;
      for (const article of articles) {
         const distance = levenshtein(
           lowerParam,
           article.title.toLowerCase()
         );
         if (distance < minDistance) {
           minDistance = distance;
           bestArticle = article;
         }
      }
      if (bestArticle) {
        return {
          articles: { nodes: [bestArticle] }
        } as TitleQueryResponse;
      }
      return { articles: { nodes: [] } } as TitleQueryResponse;
    }

    return data;
  } catch (error) {
    if (endpointIndex < apiList.length - 1) {
      return await wikitApiRequest(param, name, endpointIndex + 1, queryString);
    }
    throw error;
  }
}