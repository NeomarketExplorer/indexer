/**
 * Base API client for Polymarket APIs
 */

import { z } from 'zod';

export interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
  timeout?: number;
}

export interface AuthArgs {
  method: string;
  requestPath: string; // Path + query, e.g. "/trades?token_id=...&limit=..."
  body?: string;
}

export type AuthProvider =
  | ((args: AuthArgs) => Promise<Record<string, string>>)
  | ((args: AuthArgs) => Record<string, string>);

export interface ApiClientConfig {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  onError?: (error: ApiError) => void;
  auth?: AuthProvider;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public statusText: string,
    public url: string,
    public body?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;
  private onError?: (error: ApiError) => void;
  private auth?: AuthProvider;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.defaultHeaders = config.defaultHeaders ?? {};
    this.onError = config.onError;
    this.auth = config.auth;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    // Handle both absolute URLs and relative paths
    let urlString = `${this.baseUrl}${path}`;

    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        urlString += `?${queryString}`;
      }
    }

    return urlString;
  }

  async request<T>(
    path: string,
    options: RequestOptions = {},
    schema?: z.ZodType<T>
  ): Promise<T> {
    const { params, timeout = 30000, ...fetchOptions } = options;
    const url = this.buildUrl(path, params);
    const urlObj = new URL(url);
    const requestPath = `${urlObj.pathname}${urlObj.search}`;
    const method = (fetchOptions.method ?? 'GET').toUpperCase();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const authHeaders = this.auth
        ? await this.auth({
            method,
            requestPath,
            body: typeof fetchOptions.body === 'string' ? fetchOptions.body : undefined,
          })
        : undefined;

      const response = await fetch(url, {
        ...fetchOptions,
        headers: {
          'Content-Type': 'application/json',
          ...this.defaultHeaders,
          ...(authHeaders ?? {}),
          ...fetchOptions.headers,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.text().catch(() => null);
        const error = new ApiError(
          `API request failed: ${response.statusText}`,
          response.status,
          response.statusText,
          url,
          body
        );
        this.onError?.(error);
        throw error;
      }

      const data = await response.json();

      if (schema) {
        return schema.parse(data);
      }

      return data as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof ApiError) {
        throw error;
      }

      if (error instanceof z.ZodError) {
        throw new Error(`API response validation failed: ${error.message}`);
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }

      throw error;
    }
  }

  async get<T>(
    path: string,
    options?: Omit<RequestOptions, 'method' | 'body'>,
    schema?: z.ZodType<T>
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' }, schema);
  }

  async post<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
    schema?: z.ZodType<T>
  ): Promise<T> {
    return this.request<T>(
      path,
      { ...options, method: 'POST', body: body ? JSON.stringify(body) : undefined },
      schema
    );
  }

  async put<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
    schema?: z.ZodType<T>
  ): Promise<T> {
    return this.request<T>(
      path,
      { ...options, method: 'PUT', body: body ? JSON.stringify(body) : undefined },
      schema
    );
  }

  async delete<T>(
    path: string,
    options?: Omit<RequestOptions, 'method' | 'body'>,
    schema?: z.ZodType<T>
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' }, schema);
  }
}

/**
 * Create an API client with configuration
 */
export function createApiClient(config: ApiClientConfig): ApiClient {
  return new ApiClient(config);
}
