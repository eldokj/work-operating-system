import { z } from "zod";
import { localDateStringSchema } from "./daily-work.schema";

// Phase 7 — docs/architecture/26-phase7-calendar-meeting-architecture-report.md §12/§18.

export const calendarEventVisibilitySchema = z.enum(["PRIVATE", "ORGANIZATION_VISIBLE"]);
export type CalendarEventVisibilityInput = z.infer<typeof calendarEventVisibilitySchema>;

export const createCalendarEventSchema = z
  .object({
    workspaceId: z.string().uuid(),
    projectId: z.string().uuid().nullable().optional(),
    title: z.string().min(1).max(200),
    description: z.string().max(5000).nullable().optional(),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    isAllDay: z.boolean().optional(),
    location: z.string().max(300).nullable().optional(),
    meetingLink: z.string().max(1000).nullable().optional(),
    visibility: calendarEventVisibilitySchema.optional(),
    // Individual participants only in v1 (doc 26 §12/§23) — no team-targeted invites.
    participantUserIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .refine((data) => data.endAt.getTime() > data.startAt.getTime(), {
    message: "endAt must be after startAt",
    path: ["endAt"],
  });
export type CreateCalendarEventInput = z.infer<typeof createCalendarEventSchema>;

// No cross-field start<end refine here: a partial update may set only one of the two
// fields, and the service layer validates the *effective* (merged with the existing row)
// start/end — a schema-level refine can't see the unset field's current value.
export const updateCalendarEventSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
  isAllDay: z.boolean().optional(),
  location: z.string().max(300).nullable().optional(),
  meetingLink: z.string().max(1000).nullable().optional(),
  visibility: calendarEventVisibilitySchema.optional(),
});
export type UpdateCalendarEventInput = z.infer<typeof updateCalendarEventSchema>;

export const calendarEventRangeQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  from: z.coerce.date(),
  to: z.coerce.date(),
});
export type CalendarEventRangeQuery = z.infer<typeof calendarEventRangeQuerySchema>;

export const calendarDayQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  date: localDateStringSchema.optional(),
});
export type CalendarDayQuery = z.infer<typeof calendarDayQuerySchema>;

export const addCalendarEventParticipantSchema = z.object({
  userId: z.string().uuid(),
});
export type AddCalendarEventParticipantInput = z.infer<typeof addCalendarEventParticipantSchema>;
