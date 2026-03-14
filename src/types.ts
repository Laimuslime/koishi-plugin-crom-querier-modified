// For titleQuery
export interface Article {
  title: string;
  url: string;
  author: string;
  rating: number;
  comments: number;
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
  total: number;
  rank: number;
  name: string;
  value: number; // Represents total score
}

export interface UserQueryResponse {
  authorWikiRank?: AuthorRank;
  authorGlobalRank?: AuthorRank; 
  articles?: {
    pageInfo: {
      total: number;
    }
  };
  recent?: {
    nodes: {
      title: string;
      url: string;
      created_at: string;
    }[];
  };
}

export interface UserRankQueryResponse {
  authorRanking: AuthorRank[];
}