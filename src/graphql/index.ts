const gql = (query: TemplateStringsArray, ...substitutions: unknown[]): string => String.raw(query, ...substitutions);

export const queries = {
  titleQuery: gql`
    query titleQuery($anyBaseUrl: [String], $query: String) {
      articles(wiki: $anyBaseUrl, titleKeyword: $query, page: 1, pageSize: 20) {
        nodes {
          title
          url
          author
          rating
        }
        pageInfo {
          total
          page
          pageSize
          hasNextPage
        }
      }
    }
  `,
 userQuery: `
    query userQuery($query: String!, $baseUrl: String!) {
      authorWikiRank(wiki: $baseUrl, name: $query, by: RATING) {
        rank
        name
        value
      }
      articles(author: $query, wiki: [$baseUrl]) {
        pageInfo {
          total
        }
      }
    }
  `,
  userGlobalQuery: `
    query userGlobalQuery($query: String!) {
      authorGlobalRank(name: $query, by: RATING) {
        rank
        name
        value
      }
      articles(author: $query) {
        pageInfo {
          total
        }
      }
    }
  `,
  userRankQuery: gql`
    query userRankQuery($baseUrl: String) {
      authorRanking(wiki: $baseUrl, by: RATING) {
        rank
        name
        value
      }
    }
  `,
};

