/**
 * Zod validation middleware for MCP tool inputs.
 * Enforces input schemas at the server level.
 */

import { z, ZodError, ZodSchema } from "zod";
import { logger } from "./logger.js";

/**
 * Validation result with typed error information.
 */
export interface ValidationResult<T> {
  success: true;
  data: T;
}

export interface ValidationFailure {
  success: false;
  error: {
    code: string;
    message: string;
    details: Array<{
      path: string;
      message: string;
    }>;
  };
}

/**
 * Validate data against a Zod schema.
 * Returns typed result for error handling.
 */
export function validate<T>(schema: ZodSchema<T>, data: unknown): ValidationResult<T> | ValidationFailure {
  try {
    const parsed = schema.parse(data);
    return { success: true, data: parsed };
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.errors.map((err) => ({
        path: err.path.join("."),
        message: err.message,
      }));

      logger.warn({ errors: details }, "Validation failed");

      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Input validation failed",
          details,
        },
      };
    }

    // Unexpected error
    logger.error({ err: error }, "Unexpected validation error");
    return {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Validation internal error",
        details: [],
      },
    };
  }
}

/**
 * Create a validation middleware for MCP tool handler.
 * Wraps handler with input validation and proper error formatting.
 */
export function withValidation<T>(
  schema: ZodSchema<T>,
  handler: (data: T) => Promise<unknown>
) {
  return async (rawInput: unknown) => {
    const result = validate(schema, rawInput);

    if (!result.success) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                error: result.error.code,
                message: result.error.message,
                details: result.error.details,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    return handler(result.data);
  };
}

/**
 * Pre-built validation schemas for MCP tools.
 */
export const schemas = {
  search_docs: z.object({
    query: z.string().min(1, "Query cannot be empty").describe("Search query"),
    package: z
      .enum([
        "discord.js",
        "builders",
        "collection",
        "core",
        "rest",
        "voice",
        "ws",
        "structures",
        "util",
        "formatters",
        "brokers",
        "proxy",
      ])
      .optional()
      .describe("Package to search within"),
  }),

  get_class: z.object({
    className: z.string().min(1, "Class name cannot be empty").describe("Class name"),
    package: z
      .enum([
        "discord.js",
        "builders",
        "collection",
        "core",
        "rest",
        "voice",
        "ws",
        "structures",
        "util",
        "formatters",
        "brokers",
        "proxy",
      ])
      .optional()
      .describe("Package to search in"),
  }),

  get_method: z.object({
    className: z.string().min(1, "Class name cannot be empty").describe("Class name"),
    methodName: z.string().min(1, "Method name cannot be empty").describe("Method name"),
    package: z
      .enum([
        "discord.js",
        "builders",
        "collection",
        "core",
        "rest",
        "voice",
        "ws",
        "structures",
        "util",
        "formatters",
        "brokers",
        "proxy",
      ])
      .optional()
      .describe("Package to search in"),
  }),

  list_packages: z.object({}),

  // Pagination params (used internally)
  pagination: z
    .object({
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    })
    .optional(),
};

export type SearchDocsInput = z.infer<typeof schemas.search_docs>;
export type GetClassInput = z.infer<typeof schemas.get_class>;
export type GetMethodInput = z.infer<typeof schemas.get_method>;
export type ListPackagesInput = z.infer<typeof schemas.list_packages>;