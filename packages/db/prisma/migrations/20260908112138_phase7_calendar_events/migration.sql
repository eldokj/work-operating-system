-- Phase 7 — docs/architecture/26-phase7-calendar-meeting-architecture-report.md. Purely
-- additive: two new tables (calendar_events, calendar_event_participants), two new enums,
-- and one new nullable column on the existing audit_logs table (the same additive-
-- nullable-column pattern already used four times for taskId/projectId/workdayId). No
-- existing table's data is modified, renamed, or dropped.

-- CreateEnum
CREATE TYPE "CalendarEventStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CalendarEventVisibility" AS ENUM ('PRIVATE', 'ORGANIZATION_VISIBLE');

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "calendar_event_id" TEXT;

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "organizer_id" TEXT NOT NULL,
    "project_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "is_all_day" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "meeting_link" TEXT,
    "status" "CalendarEventStatus" NOT NULL DEFAULT 'CONFIRMED',
    "visibility" "CalendarEventVisibility" NOT NULL DEFAULT 'PRIVATE',
    "external_provider" TEXT,
    "external_event_id" TEXT,
    "starting_soon_notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event_participants" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "calendar_event_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_events_workspace_id_start_at_idx" ON "calendar_events"("workspace_id", "start_at");

-- CreateIndex
CREATE INDEX "calendar_events_organizer_id_start_at_idx" ON "calendar_events"("organizer_id", "start_at");

-- CreateIndex
CREATE INDEX "calendar_event_participants_user_id_idx" ON "calendar_event_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_participants_event_id_user_id_key" ON "calendar_event_participants"("event_id", "user_id");

-- CreateIndex
CREATE INDEX "audit_logs_calendar_event_id_created_at_idx" ON "audit_logs"("calendar_event_id", "created_at");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_participants" ADD CONSTRAINT "calendar_event_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_calendar_event_id_fkey" FOREIGN KEY ("calendar_event_id") REFERENCES "calendar_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

