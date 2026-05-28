/**
 * Cursor-based pagination for search results.
 */

export interface PaginationParams {
  offset: number;
  limit: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface Cursor {
  offset: number;
  limit: number;
}

/**
 * Default pagination settings.
 */
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/**
 * Parse pagination parameters from query options.
 */
export function parsePagination(
  options?: { offset?: number; limit?: number } | null
): PaginationParams {
  if (!options) {
    return { offset: 0, limit: DEFAULT_LIMIT };
  }

  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(options.limit) || DEFAULT_LIMIT)
  );

  return { offset, limit };
}

/**
 * Create a cursor string for pagination state.
 */
export function encodeCursor(offset: number, limit: number): string {
  const data = JSON.stringify({ offset, limit });
  return Buffer.from(data).toString("base64");
}

/**
 * Decode a cursor string to pagination params.
 */
export function decodeCursor(cursor: string): PaginationParams | null {
  try {
    const data = Buffer.from(cursor, "base64").toString("utf8");
    const parsed = JSON.parse(data);

    if (typeof parsed.offset !== "number" || typeof parsed.limit !== "number") {
      return null;
    }

    return parsePagination({ offset: parsed.offset, limit: parsed.limit });
  } catch {
    return null;
  }
}

/**
 * Apply pagination to an array of items.
 */
export function paginate<T>(
  items: T[],
  params: PaginationParams
): PaginatedResult<T> {
  const { offset, limit } = params;
  const total = items.length;

  // Clamp offset to array bounds
  const safeOffset = Math.min(offset, total);
  const startIndex = safeOffset;

  // Slice the array
  const paginatedItems = items.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < total;

  return {
    items: paginatedItems,
    total,
    offset: safeOffset,
    limit,
    hasMore,
  };
}

/**
 * Create a paginated response with cursor.
 */
export function createPaginatedResponse<T>(
  items: T[],
  params: PaginationParams,
  baseUrl: string
): PaginatedResult<T> & { nextCursor: string | null; prevCursor: string | null } {
  const result = paginate(items, params);

  // Encode cursors
  const nextCursor =
    result.hasMore
      ? encodeCursor(params.offset + params.limit, params.limit)
      : null;

  const prevCursor =
    params.offset > 0
      ? encodeCursor(Math.max(0, params.offset - params.limit), params.limit)
      : null;

  return {
    ...result,
    nextCursor,
    prevCursor,
  };
}

/**
 * Merge pagination params with request options.
 */
export function mergePaginationOptions(
  defaults: PaginationParams,
  options?: { offset?: number; limit?: number } | null
): PaginationParams {
  const parsed = parsePagination(options);
  return {
    offset: options?.offset !== undefined ? parsed.offset : defaults.offset,
    limit: options?.limit !== undefined ? parsed.limit : defaults.limit,
  };
}