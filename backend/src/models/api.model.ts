import { GrainStock } from './stock.model';

export interface StockListResponse {
  stocks: GrainStock[];
  total: number;
}

export interface ErrorResponse {
  statusCode: number;
  message: string;
  error?: string;
  details?: unknown;
  timestamp: string;
  path?: string;
}

export interface ApiResponse<T = void> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

export interface AuthTokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}
