import { z } from "zod";

export const uuidSchema = z.string().uuid();

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const scopeTypeSchema = z.enum(["ORGANIZATION", "DEPARTMENT", "TEAM"]);
export type ScopeTypeInput = z.infer<typeof scopeTypeSchema>;
