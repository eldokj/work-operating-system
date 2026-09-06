import bcrypt from "bcryptjs";
import type { Prisma, PrismaClient, User } from "@ai-task-manager/db";
import { ConflictError, UnauthenticatedError } from "../errors";

// AuthService interface boundary — see docs/architecture/14-phase1-implementation-deviations.md #1.
// Every consumer (API middleware, other services) depends on this shape, never on
// bcrypt/NextAuth specifics directly, so swapping to Supabase Auth later means
// implementing the same two methods (verifyCredentials / getUserById) against Supabase
// and rewiring one constructor call — no route handler changes.
export interface AuthenticatedIdentity {
  id: string;
  email: string;
  fullName: string;
}

const BCRYPT_ROUNDS = 12;

export class AuthService {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient) {}

  /**
   * Creates a user AND their personal workspace in one transaction — doc 01 §1.3:
   * "Created automatically for every user at signup."
   */
  async signup(input: { email: string; password: string; fullName: string }): Promise<User> {
    const existing = await this.db.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ConflictError("An account with this email already exists");
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    // Note: when `db` is already a transaction client (Prisma.TransactionClient), this
    // nested `$transaction` call is unavailable — signup is always invoked with the top-
    // level PrismaClient, so this is safe in practice within Phase 1's call graph.
    const client = this.db as PrismaClient;
    const user = await client.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          fullName: input.fullName,
          passwordHash,
        },
      });
      await tx.workspace.create({
        data: {
          type: "PERSONAL",
          ownerUserId: created.id,
          name: "Personal",
        },
      });
      return created;
    });

    return user;
  }

  async verifyCredentials(email: string, password: string): Promise<AuthenticatedIdentity> {
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user) throw new UnauthenticatedError("Invalid email or password");

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthenticatedError("Invalid email or password");

    return { id: user.id, email: user.email, fullName: user.fullName };
  }

  async getUserById(id: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { id } });
  }

  async getPersonalWorkspaceId(userId: string): Promise<string> {
    const ws = await this.db.workspace.findFirst({
      where: { type: "PERSONAL", ownerUserId: userId },
      select: { id: true },
    });
    if (!ws) throw new Error(`No personal workspace found for user ${userId} — this indicates a data integrity bug`);
    return ws.id;
  }
}
