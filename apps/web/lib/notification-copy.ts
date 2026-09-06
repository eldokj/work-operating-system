// Renders a human-readable line for each NotificationType (packages/domain/src/services/notification.service.ts).
export function describeNotification(type: string, payload: Record<string, unknown>): string {
  const title = typeof payload.taskTitle === "string" ? payload.taskTitle : "a task";
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
    case "review.completed":
      return `Review completed: "${title}"`;
    case "changes.requested":
      return `Changes requested on "${title}"`;
    case "task.completed":
      return `Completed: "${title}"`;
    default:
      return `Update on "${title}"`;
  }
}
