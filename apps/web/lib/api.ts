import { NextRequest, NextResponse } from "next/server";
import { z, type ZodType } from "zod";
import { ErrorCodes, fail, ok } from "@ai-task-manager/shared";
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "@ai-task-manager/domain";
import { getSessionUserId } from "./session";

// The shared authorization pipeline every route handler goes through — doc 07 §7.3:
// authenticate -> (handler runs: resolve context -> authorize -> validate -> call
// service -> audit) -> map errors to the shared ApiResponse envelope (doc 07 §7.1).
// Authorization itself is never re-implemented per-route; it always happens inside the
// domain service methods the handler calls (PermissionService.assertCan / assertOrgMember).

type RouteParams = Record<string, string>;
type RouteContext = { params: Promise<RouteParams> };

function mapErrorToResponse(error: unknown): NextResponse {
  if (error instanceof UnauthenticatedError) {
    return NextResponse.json(fail(ErrorCodes.UNAUTHENTICATED, error.message), { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json(fail(ErrorCodes.FORBIDDEN, error.message), { status: 403 });
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json(fail(ErrorCodes.NOT_FOUND, error.message), { status: 404 });
  }
  if (error instanceof ValidationError) {
    return NextResponse.json(fail(ErrorCodes.VALIDATION_ERROR, error.message, error.details), { status: 400 });
  }
  if (error instanceof ConflictError) {
    return NextResponse.json(fail(ErrorCodes.CONFLICT, error.message), { status: 409 });
  }
  if (error instanceof DomainError) {
    return NextResponse.json(fail(ErrorCodes.INTERNAL_ERROR, error.message), { status: 500 });
  }
  // Unknown/unexpected errors: never leak internals to the client.
  console.error("Unhandled API error:", error);
  return NextResponse.json(fail(ErrorCodes.INTERNAL_ERROR, "An unexpected error occurred"), { status: 500 });
}

// `S extends ZodType` (inferring the whole schema, not just its output) rather than a
// `ZodSchema<T>` parameter — the latter collapses a schema's Input and Output generics to
// the same T, which silently produces the wrong (pre-default) type for any schema using
// `.default(...)` (e.g. createTaskSchema's `priority`), making a required field look
// optional to every caller.
export async function parseJsonBody<S extends ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError("Request validation failed", result.error.flatten());
  }
  return result.data as z.infer<S>;
}

export function parseQuery<S extends ZodType>(req: NextRequest, schema: S): z.infer<S> {
  const searchParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const result = schema.safeParse(searchParams);
  if (!result.success) {
    throw new ValidationError("Query validation failed", result.error.flatten());
  }
  return result.data as z.infer<S>;
}

type AuthedHandler<T> = (req: NextRequest, ctx: { userId: string; params: RouteParams }) => Promise<T>;

/**
 * Wraps a route handler that requires an authenticated session (the vast majority of the
 * API). `routeCtx` is typed as required (not optional/defaulted) because Next.js 15's
 * generated route type-checker validates each exported handler's second parameter against
 * an exact `RouteContext` shape per route — a default value makes the inferred type
 * `RouteContext | undefined`, which fails that check even though Next always calls the
 * handler with a context object (with empty `params` for routes with no dynamic segments).
 */
export function withAuth<T>(handler: AuthedHandler<T>) {
  return async (req: NextRequest, routeCtx: RouteContext) => {
    try {
      const userId = await getSessionUserId();
      if (!userId) {
        return NextResponse.json(fail(ErrorCodes.UNAUTHENTICATED, "Not signed in"), { status: 401 });
      }
      const params = routeCtx?.params ? await routeCtx.params : {};
      const result = await handler(req, { userId, params });
      return NextResponse.json(ok(result));
    } catch (error) {
      return mapErrorToResponse(error);
    }
  };
}

type AuthedRawHandler = (req: NextRequest, ctx: { userId: string; params: RouteParams }) => Promise<NextResponse>;

/**
 * Same auth pipeline as withAuth, but for the rare route that must return something other
 * than the JSON envelope — Phase 2B's secure file retrieval (binary body + Content-Type/
 * Content-Disposition headers, or a redirect to a signed URL) is the only current user.
 * The handler builds and returns the NextResponse itself; everything else (session check,
 * error mapping) is identical to withAuth.
 */
export function withAuthRaw(handler: AuthedRawHandler) {
  return async (req: NextRequest, routeCtx: RouteContext) => {
    try {
      const userId = await getSessionUserId();
      if (!userId) {
        return NextResponse.json(fail(ErrorCodes.UNAUTHENTICATED, "Not signed in"), { status: 401 });
      }
      const params = routeCtx?.params ? await routeCtx.params : {};
      return await handler(req, { userId, params });
    } catch (error) {
      return mapErrorToResponse(error);
    }
  };
}

type PublicHandler<T> = (req: NextRequest, ctx: { params: RouteParams }) => Promise<T>;

/** Wraps a route handler that must NOT require a session (signup, login). See withAuth's note on `routeCtx`. */
export function withPublic<T>(handler: PublicHandler<T>) {
  return async (req: NextRequest, routeCtx: RouteContext) => {
    try {
      const params = routeCtx?.params ? await routeCtx.params : {};
      const result = await handler(req, { params });
      return NextResponse.json(ok(result));
    } catch (error) {
      return mapErrorToResponse(error);
    }
  };
}
