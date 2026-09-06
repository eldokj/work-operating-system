import { z } from "zod";

export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only"),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().email(),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const createDepartmentSchema = z.object({
  name: z.string().min(1).max(200),
  parentDepartmentId: z.string().uuid().nullable().optional(),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const createTeamSchema = z.object({
  name: z.string().min(1).max(200),
  departmentId: z.string().uuid().nullable().optional(),
});
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const addTeamMemberSchema = z.object({
  userId: z.string().uuid(),
  isHead: z.boolean().default(false),
});
export type AddTeamMemberInput = z.infer<typeof addTeamMemberSchema>;

export const setTeamHeadSchema = z.object({
  isHead: z.boolean(),
});
export type SetTeamHeadInput = z.infer<typeof setTeamHeadSchema>;

export const grantRoleSchema = z
  .object({
    userId: z.string().uuid(),
    roleId: z.string().uuid(),
    scopeType: z.enum(["ORGANIZATION", "DEPARTMENT", "TEAM"]),
    scopeId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.scopeType === "ORGANIZATION" || !!v.scopeId, {
    message: "scopeId is required when scopeType is DEPARTMENT or TEAM",
    path: ["scopeId"],
  });
export type GrantRoleInput = z.infer<typeof grantRoleSchema>;
