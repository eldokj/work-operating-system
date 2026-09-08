import { z } from "zod";

// Phase 2C — docs/architecture/17-phase2c-project-workspace-architecture-report.md.

export const projectKindSchema = z.enum(["PROJECT", "EVENT"]);

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  kind: projectKindSchema.default("PROJECT"),
  startDate: z.coerce.date().nullable().optional(),
  targetDate: z.coerce.date().nullable().optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(["ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"]).optional(),
  kind: projectKindSchema.optional(),
  startDate: z.coerce.date().nullable().optional(),
  targetDate: z.coerce.date().nullable().optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const addProjectMemberSchema = z.object({
  userId: z.string().uuid(),
});
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;

export const addProjectTeamSchema = z.object({
  teamId: z.string().uuid(),
});
export type AddProjectTeamInput = z.infer<typeof addProjectTeamSchema>;

export const createProjectDateSchema = z.object({
  title: z.string().min(1).max(200),
  date: z.coerce.date(),
  notes: z.string().max(2000).nullable().optional(),
});
export type CreateProjectDateInput = z.infer<typeof createProjectDateSchema>;

export const updateProjectDateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  date: z.coerce.date().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type UpdateProjectDateInput = z.infer<typeof updateProjectDateSchema>;
