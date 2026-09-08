import { z } from "zod";

// Phase 3 — docs/architecture/19-phase3-daily-work-cycle-architecture-report.md §20.

// A plain YYYY-MM-DD calendar date (no time/timezone component) — matches the shape
// resolveLocalDateString produces (packages/domain/src/local-day.ts) and what @db.Date
// columns expect. Never a full ISO instant: a "date" here is a day, not a moment.
export const localDateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const workdayDateQuerySchema = z.object({
  date: localDateStringSchema.optional(),
});
export type WorkdayDateQuery = z.infer<typeof workdayDateQuerySchema>;

export const addDailyPlanItemSchema = z.object({
  taskId: z.string().uuid(),
  date: localDateStringSchema.optional(),
  plannedDurationMinutes: z.number().int().positive().nullable().optional(),
  isUnplanned: z.boolean().optional(),
});
export type AddDailyPlanItemInput = z.infer<typeof addDailyPlanItemSchema>;

export const updateDailyPlanItemSchema = z.object({
  position: z.number().int().min(0).optional(),
  plannedDurationMinutes: z.number().int().positive().nullable().optional(),
  scheduledStart: z.coerce.date().nullable().optional(),
  scheduledEnd: z.coerce.date().nullable().optional(),
});
export type UpdateDailyPlanItemInput = z.infer<typeof updateDailyPlanItemSchema>;

export const dailyPlanItemDispositionActionSchema = z.enum(["CARRY_FORWARD", "MOVE_TO_BACKLOG", "DROP", "COMPLETE"]);
export type DailyPlanItemDispositionAction = z.infer<typeof dailyPlanItemDispositionActionSchema>;

export const closeWorkdaySchema = z.object({
  date: localDateStringSchema.optional(),
  dispositions: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        action: dailyPlanItemDispositionActionSchema,
        targetDate: localDateStringSchema.optional(),
      })
    )
    .default([]),
  reflectionNote: z.string().max(5000).nullable().optional(),
});
export type CloseWorkdayInput = z.infer<typeof closeWorkdaySchema>;

export const workingHoursSchema = z
  .record(
    z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
    z.object({
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
    })
  )
  .optional();
export type WorkingHoursInput = z.infer<typeof workingHoursSchema>;
