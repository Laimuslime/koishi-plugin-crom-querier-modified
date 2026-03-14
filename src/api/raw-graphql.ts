import { JSON_HEADERS, GRAPHQL_ENDPOINTS } from "./client";

export async function rawGraphql(query: string, variables: any = {}) {
  for (const endpoint of GRAPHQL_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ query, variables })
      });
      if (res.ok) return await res.json();
    } catch (e) {
      continue;
    }
  }
  throw new Error("全部 GraphQL 节点访问失败");
}