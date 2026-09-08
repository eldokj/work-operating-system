import { z } from "zod";

// Phase 5 — docs/architecture/22-phase5-product-capability-and-roadmap-assessment.md §8.
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;
