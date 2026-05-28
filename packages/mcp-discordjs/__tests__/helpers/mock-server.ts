/**
 * Mock HTTP server for testing.
 * Provides configurable responses for testing HTTP-dependent code.
 */

export interface MockResponse {
  status: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string | object;
  delay?: number;
}

export interface MockEndpoint {
  path: string;
  method?: string;
  response: MockResponse;
}

const DEFAULT_RESPONSE: MockResponse = {
  status: 200,
  body: "",
};

/**
 * Create a mock Response object for fetch testing.
 */
export function createMockResponse(options: Partial<MockResponse> = {}): Response {
  const response = { ...DEFAULT_RESPONSE, ...options };
  
  const body = response.body 
    ? (typeof response.body === "string" ? response.body : JSON.stringify(response.body))
    : "";

  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: response.statusText || "",
    headers: new Headers(response.headers || { "content-type": "application/json" }),
    body: {
      getReader: () => ({
        read: async () => ({
          done: true,
          value: new TextEncoder().encode(body),
        }),
      }),
    } as unknown as ReadableStream<Uint8Array>,
    json: async () => {
      if (typeof response.body === "object") {
        return response.body;
      }
      if (typeof response.body === "string") {
        try {
          return JSON.parse(response.body);
        } catch {
          return {};
        }
      }
      return {};
    },
    text: async () => body,
  } as unknown as Response;
}

/**
 * Create a mock fetch function with configurable endpoints.
 */
export function createMockFetch(endpoints: MockEndpoint[] = []): typeof fetch {
  return async function mockFetch(url: string | URL, options?: RequestInit): Promise<Response> {
    const urlStr = typeof url === "string" ? url : url.toString();
    
    // Parse URL to get pathname
    let pathname = "";
    try {
      const parsed = new URL(urlStr);
      pathname = parsed.pathname;
    } catch {
      // Use full URL as path if URL parsing fails
      pathname = urlStr;
    }

    // Find matching endpoint
    const endpoint = endpoints.find((e) => {
      const pathMatches = pathname === e.path || pathname.endsWith(e.path);
      const methodMatches = !e.method || e.method === options?.method;
      return pathMatches && methodMatches;
    });

    // Simulate delay if configured
    if (endpoint?.response.delay) {
      await new Promise((resolve) => setTimeout(resolve, endpoint.response.delay));
    }

    if (endpoint) {
      return createMockResponse(endpoint.response);
    }

    // Default 404 for unmatched requests
    return createMockResponse({ status: 404, statusText: "Not Found" });
  };
}

/**
 * Create a timeout mock response.
 */
export function createTimeoutResponse(): Response {
  return createMockResponse({
    status: 504,
    statusText: "Gateway Timeout",
  });
}

/**
 * Create a rate limit mock response.
 */
export function createRateLimitResponse(retryAfterMs = 60000): Response {
  return createMockResponse({
    status: 429,
    statusText: "Too Many Requests",
    headers: {
      "content-type": "application/json",
      "retry-after": String(Math.ceil(retryAfterMs / 1000)),
    },
    body: JSON.stringify({ error: "Rate limit exceeded" }),
  });
}

/**
 * Create a server error mock response.
 */
export function createServerErrorResponse(status = 500): Response {
  return createMockResponse({
    status,
    statusText: "Internal Server Error",
    body: JSON.stringify({ error: "Server error" }),
  });
}