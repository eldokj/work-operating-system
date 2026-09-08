import { searchQuerySchema } from "@ai-task-manager/shared";
import { SearchService } from "@ai-task-manager/domain";
import { db } from "@/lib/db";
import { parseQuery, withAuth } from "@/lib/api";

// Phase 5 — docs/architecture/22-phase5-product-capability-and-roadmap-assessment.md §8.
// A "top N ranked results" response, not a paginated browse (no {items, nextCursor} here
// — see SearchService's own doc comment for why). Every result has already been
// individually re-authorized by SearchService — this route trusts that unconditionally,
// same as every other route trusts its service layer.
export const GET = withAuth(async (req, { userId }) => {
  const query = parseQuery(req, searchQuerySchema);
  const search = new SearchService(db);
  const items = await search.search(userId, query.q, query.limit);
  return { items };
});
