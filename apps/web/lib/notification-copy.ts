// Renders a human-readable line for each NotificationType (packages/domain/src/services/notification.service.ts).
export function describeNotification(type: string, payload: Record<string, unknown>): string {
  // message.added / task.mentioned can originate from a project's own conversation as
  // well as a task's (Phase 2C, doc 17 §11) — payload carries projectTitle instead of
  // taskTitle in that case.
  const title =
    typeof payload.taskTitle === "string" ? payload.taskTitle : typeof payload.projectTitle === "string" ? payload.projectTitle : "a task";
  switch (type) {
    case "task.assigned":
      return `You were assigned: "${title}"`;
    case "task.assigned_to_team":
      return `Your team was assigned: "${title}"`;
    case "assignment.accepted":
      return `Your assignment was accepted: "${title}"`;
    case "assignment.declined":
      return `Your assignment was declined: "${title}"${payload.reason ? ` — ${payload.reason}` : ""}`;
    case "task.reassigned":
      return `A task was reassigned: "${title}"`;
    case "comment.added":
      return `New comment on "${title}"`;
    case "deadline.approaching":
      return `Deadline approaching: "${title}"`;
    case "task.overdue":
      return `Overdue: "${title}"`;
    case "review.requested":
      return `Review requested: "${title}"`;
    // review.completed intentionally not handled — Phase 6, doc 24 §4.2. The type was
    // removed (never wired to any trigger); the `default` case below covers any stray
    // legacy row from before this change.
    case "changes.requested":
      return `Changes requested on "${title}"`;
    case "task.completed":
      return `Completed: "${title}"`;
    case "message.added":
      return `New message on "${title}"`;
    case "task.mentioned":
      return `You were mentioned on "${title}"`;
    default:
      return `Update on "${title}"`;
  }
}
