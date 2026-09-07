-- DropIndex
DROP INDEX "task_attachments_task_id_idx";

-- AlterTable
ALTER TABLE "task_attachments" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "is_deleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "message_id" TEXT;

-- CreateIndex
CREATE INDEX "task_attachments_task_id_created_at_idx" ON "task_attachments"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "task_attachments_message_id_idx" ON "task_attachments"("message_id");

-- AddForeignKey
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "task_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
