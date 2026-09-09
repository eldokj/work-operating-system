import { z } from "zod";

export const taskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

// Single schema used by BOTH the Quick Task form and the Advanced Task form (doc 08) —
// Quick Task just leaves the advanced fields undefined. This is also the exact schema
// an AI-parsed draft will be validated against in Phase 2 (doc 07 §7.4) — one contract,
// three producers.
export const createTaskSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  parentTaskId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(10_000).nullable().optional(),
  priority: taskPrioritySchema.default("MEDIUM"),
  startDate: z.coerce.date().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  estimatedDurationMinutes: z.number().int().positive().nullable().optional(),
  checklist: z.array(z.string().min(1).max(500)).max(100).optional(),
  // Optional immediate assignment at creation time (organization workspace only —
  // enforced server-side, not by this schema, per doc 13 #11 personal-workspace rule).
  assignTo: z
    .object({
      type: z.enum(["USER", "TEAM"]),
      id: z.string().uuid(),
    })
    .nullable()
    .optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(10_000).nullable().optional(),
  priority: taskPrioritySchema.optional(),
  startDate: z.coerce.date().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  estimatedDurationMinutes: z.number().int().positive().nullable().optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const taskListFilterSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  status: z
    .enum([
      "DRAFT",
      "UNASSIGNED",
      "ASSIGNED",
      "IN_PROGRESS",
      "SUBMITTED",
      "UNDER_REVIEW",
      "CHANGES_REQUESTED",
      "COMPLETED",
      "CANCELLED",
    ])
    .optional(),
  view: z
    .enum(["MY_TASKS", "TEAM_INCOMING", "TEAM_TASKS", "PENDING_MY_ACKNOWLEDGEMENT", "ALL"])
    .default("ALL"),
  overdueOnly: z.coerce.boolean().optional(),
});
export type TaskListFilter = z.infer<typeof taskListFilterSchema>;

export const addChecklistItemSchema = z.object({
  label: z.string().min(1).max(500),
});
export type AddChecklistItemInput = z.infer<typeof addChecklistItemSchema>;

export const updateChecklistItemSchema = z.object({
  label: z.string().min(1).max(500).optional(),
  isDone: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});
export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>;

export const addCommentSchema = z.object({
  body: z.string().min(1).max(10_000),
});
export type AddCommentInput = z.infer<typeof addCommentSchema>;

export const addProgressUpdateSchema = z.object({
  percentage: z.number().int().min(0).max(100).nullable().optional(),
  note: z.string().max(5000).nullable().optional(),
});
export type AddProgressUpdateInput = z.infer<typeof addProgressUpdateSchema>;

export const reviewDecisionSchema = z.object({
  decision: z.enum(["APPROVED", "CHANGES_REQUESTED"]),
  notes: z.string().max(5000).nullable().optional(),
});
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;

// Phase 8 — docs/architecture/28-phase8-task-dependencies-architecture-report.md §6.
export const dependencyTypeSchema = z.enum(["BLOCKS", "RELATES_TO"]);

export const addTaskDependencySchema = z.object({
  dependsOnTaskId: z.string().uuid(),
  type: dependencyTypeSchema.default("BLOCKS"),
});
export type AddTaskDependencyInput = z.infer<typeof addTaskDependencySchema>;
