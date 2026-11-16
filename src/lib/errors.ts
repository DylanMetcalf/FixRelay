export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID"
  | "SUBSCRIPTION"
  | "RATE_LIMITED";

/** The only error type whose message is safe to show to end users. */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const forbidden = (m = "You do not have permission to do that.") => new AppError("FORBIDDEN", m);
export const notFound = (m = "Not found.") => new AppError("NOT_FOUND", m);
export const conflict = (m: string) => new AppError("CONFLICT", m);
export const invalid = (m: string) => new AppError("INVALID", m);

/** Prisma unique-violation check (P2002). */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}
