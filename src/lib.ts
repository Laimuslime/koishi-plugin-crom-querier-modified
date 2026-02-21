import type { Article, AuthorRank, TitleQueryResponse, UserQueryResponse, UserRankQueryResponse } from "./types";

const apiList: string[] = [
  "https://wikit.unitreaty.org/apiv1/graphql",
];

export const branchInfo: Record<string, { wiki: string }> = {
  // br
  "ubmh": { wiki: "ubmh" },
  "scp-cloud": { wiki: "scp-wiki-cloud" },
  "cloud": { wiki: "backroom-wiki-cn" },
  "scr": { wiki: "scr-wiki" },
  "deep": { wiki: "deep-forest-club" },
  "rule": { wiki: "rule-wiki" },
  "as": { wiki: "asbackroom" },
  "lm": { wiki: "lostmedia" },
  "if": { wiki: "if-backrooms" },
  "rpc": { wiki: "rpc-wiki-cn" },
};

// export function getShortBranchName(fullUrl: string): string | null {
//   for (const branch in branchInfo) {
//     if (branchInfo[branch].url === fullUrl) {
//       return branch;
//     }
//   }
//   return null;
// }

export async function cromApiRequest(
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

  // Dynamically build variables based on the queryString
  if (queryString.includes("query titleQuery")) {
    variables = { query: param, anyBaseUrl: branchLongName ? [branchLongName] : null };
  } else if (queryString.includes("query userQuery")) {
    variables = { query: param, baseUrl: branchLongName };
  } else if (queryString.includes("query userRankQuery")) {
    variables = { baseUrl: branchLongName };
  }

  try {
    const response: Response = await fetch(apiList[endpointIndex], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: queryString,
        variables: variables,
      }),
    });

    if (!response.ok) {
      throw new Error(`请求失败，状态码: ${response.status}`);
    }

    const { data, errors } = await response.json();

    if (errors && errors.length > 0) {
      return await cromApiRequest(param, name, endpointIndex + 1, queryString);
    }

    return data;
  } catch (error) {
    if (endpointIndex < apiList.length - 1) {
      return await cromApiRequest(param, name, endpointIndex + 1, queryString);
    }
    throw error;
  }
}

// export function getBranchUrl(branch: string): string {
//   return branchInfo[branch]?.url || "";
// }
