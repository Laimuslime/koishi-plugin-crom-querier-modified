// For titleQuery
export interface Article {
  title: string;
  url: string;
  author: string;
  rating: number;
}

export interface PageInfo {
  total: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}

export interface TitleQueryResponse {
  articles: {
    nodes: Article[];
    pageInfo: PageInfo;
  };
}

// For userQuery and userRankQuery
export interface AuthorRank {
  rank: number;
  name: string;
  value: number; // Represents total score
}

export interface UserQueryResponse {
  authorWikiRank: AuthorRank;
}

export interface UserRankQueryResponse {
  authorRanking: AuthorRank[];
}
