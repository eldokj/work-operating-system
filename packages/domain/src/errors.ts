// Domain-level errors. The API layer (apps/web) maps these to HTTP status codes + the
// shared ApiResponse envelope (doc 07 §7.1) — the service layer itself knows nothing
// about HTTP.

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthenticatedError extends DomainError {}
export class ForbiddenError extends DomainError {}
export class NotFoundError extends DomainError {}
export class ValidationError extends DomainError {
  constructor(
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}
export class ConflictError extends DomainError {}
