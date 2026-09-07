-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "task_id" TEXT;

-- CreateTable
CREATE TABLE "task_conversations" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "parent_message_id" TEXT,
    "body" TEXT NOT NULL,
    "is_edited" BOOLEAN NOT NULL DEFAULT false,
    "edited_at" TIMESTAMP(3),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_message_mentions" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "mentioned_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_message_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_message_reactions" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_message_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_conversation_reads" (
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "last_read_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_conversation_reads_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_conversations_task_id_key" ON "task_conversations"("task_id");

-- CreateIndex
CREATE INDEX "task_messages_conversation_id_created_at_idx" ON "task_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "task_messages_parent_message_id_idx" ON "task_messages"("parent_message_id");

-- CreateIndex
CREATE INDEX "task_message_mentions_mentioned_user_id_idx" ON "task_message_mentions"("mentioned_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_message_mentions_message_id_mentioned_user_id_key" ON "task_message_mentions"("message_id", "mentioned_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_message_reactions_message_id_user_id_emoji_key" ON "task_message_reactions"("message_id", "user_id", "emoji");

-- CreateIndex
CREATE INDEX "audit_logs_task_id_created_at_idx" ON "audit_logs"("task_id", "created_at");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_conversations" ADD CONSTRAINT "task_conversations_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_messages" ADD CONSTRAINT "task_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "task_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_messages" ADD CONSTRAINT "task_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_messages" ADD CONSTRAINT "task_messages_parent_message_id_fkey" FOREIGN KEY ("parent_message_id") REFERENCES "task_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_message_mentions" ADD CONSTRAINT "task_message_mentions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "task_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_message_mentions" ADD CONSTRAINT "task_message_mentions_mentioned_user_id_fkey" FOREIGN KEY ("mentioned_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_message_reactions" ADD CONSTRAINT "task_message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "task_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_message_reactions" ADD CONSTRAINT "task_message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_conversation_reads" ADD CONSTRAINT "task_conversation_reads_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "task_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_conversation_reads" ADD CONSTRAINT "task_conversation_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
