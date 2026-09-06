import { z } from "zod";

// Assigning a task always names exactly one target: a user OR a team (doc 06).
export const createAssignmentSchema = z.object({
  assigneeType: z.enum(["USER", "TEAM"]),
  assigneeUserId: z.string().uuid().nullable().optional(),
  assigneeTeamId: z.string().uuid().nullable().optional(),
}).refine(
  (v) =>
    (v.assigneeType === "USER" && !!v.assigneeUserId && !v.assigneeTeamId) ||
    (v.assigneeType === "TEAM" && !!v.assigneeTeamId && !v.assigneeUserId),
  { message: "assigneeUserId XOR assigneeTeamId must be set matching assigneeType" }
);
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;

export const declineAssignmentSchema = z.object({
  reason: z.string().min(1, "A decline reason is required").max(2000),
});
export type DeclineAssignmentInput = z.infer<typeof declineAssignmentSchema>;

// Team Head (or anyone holding task.reassign_internal for that team) distributing an
// accepted team assignment to one individual member (doc 06 §6.3).
export const reassignInternalSchema = z.object({
  assigneeUserId: z.string().uuid(),
});
export type ReassignInternalInput = z.infer<typeof reassignInternalSchema>;

// Mid-flight reassignment to a different individual/team (doc 05 §5.4).
export const reassignSchema = createAssignmentSchema;
export type ReassignInput = CreateAssignmentInput;
