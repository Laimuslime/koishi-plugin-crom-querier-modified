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
  total: number;
  rank: number;
  name: string;
  value: number; // Represents total score
  // 把这里面之前加的 articles 删掉，因为不在这一层
}

export interface UserQueryResponse {
  authorWikiRank?: AuthorRank;
  authorGlobalRank?: AuthorRank; 
  articles?: {
    pageInfo: {
      total: number;
    }
  };
}

export interface UserRankQueryResponse {
  authorRanking: AuthorRank[];
}