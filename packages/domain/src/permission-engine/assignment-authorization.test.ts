import { describe, expect, it } from "vitest";
import {
  classifyAssignmentRelationship,
  permissionRequiredForAssignment,
} from "./assignment-authorization";
import { PERMISSIONS } from "@ai-task-manager/shared";

describe("classifyAssignmentRelationship", () => {
  it("classifies Eldo (Management, no origin team) assigning to Marketing Team as ORG_WIDE", () => {
    const rel = classifyAssignmentRelationship({
      actorTeamIds: [],
      actorDepartmentIds: [],
      targetTeamId: "team-marketing",
      targetDepartmentId: "dept-marketing",
      actorHasNoOriginTeam: true,
    });
    expect(rel).toBe("ORG_WIDE");
    expect(permissionRequiredForAssignment(rel)).toBe(PERMISSIONS.TASK_ASSIGN_ORG_WIDE);
  });

  it("classifies same-team assignment as SAME_TEAM", () => {
    const rel = classifyAssignmentRelationship({
      actorTeamIds: ["team-marketing"],
      actorDepartmentIds: ["dept-marketing"],
      targetTeamId: "team-marketing",
      targetDepartmentId: "dept-marketing",
      actorHasNoOriginTeam: false,
    });
    expect(rel).toBe("SAME_TEAM");
    expect(permissionRequiredForAssignment(rel)).toBe(PERMISSIONS.TASK_ASSIGN);
  });

  it("classifies a same-department, different-team assignment as CROSS_TEAM_SAME_DEPARTMENT", () => {
    const rel = classifyAssignmentRelationship({
      actorTeamIds: ["team-admissions"],
      actorDepartmentIds: ["dept-marketing"],
      targetTeamId: "team-marketing",
      targetDepartmentId: "dept-marketing",
      actorHasNoOriginTeam: false,
    });
    expect(rel).toBe("CROSS_TEAM_SAME_DEPARTMENT");
    expect(permissionRequiredForAssignment(rel)).toBe(PERMISSIONS.TASK_ASSIGN_CROSS_TEAM);
  });

  it("classifies Finance -> Marketing as CROSS_DEPARTMENT (Third Required Workflow)", () => {
    const rel = classifyAssignmentRelationship({
      actorTeamIds: ["team-finance"],
      actorDepartmentIds: ["dept-finance"],
      targetTeamId: "team-marketing",
      targetDepartmentId: "dept-marketing",
      actorHasNoOriginTeam: false,
    });
    expect(rel).toBe("CROSS_DEPARTMENT");
    expect(permissionRequiredForAssignment(rel)).toBe(PERMISSIONS.TASK_ASSIGN_CROSS_DEPARTMENT);
  });
});
