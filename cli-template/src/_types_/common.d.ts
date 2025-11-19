export interface ISearchParams {
  query: string; // Search query string
  limit?: number; // Maximum number of results (default: 20)
  threshold?: number; // Minimum similarity threshold (0-1)
}

export interface ISearchResultRow {
  similarity_score: number;
  word_similarity_score: number;
  final_score: number;
  similarity: number; // mapped from final_score

  [prop: string]: number | string;
}

export interface ISearchResultRow {
  similarity_score: number;
  word_similarity_score: number;
  final_score: number;

  [prop: string]: number | string;
}

export type ISearchResult = {
  similarity: number; // mapped from final_score
  [prop: string]: number | string | undefined;
}[]
