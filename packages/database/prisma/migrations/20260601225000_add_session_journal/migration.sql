-- CreateTable
CREATE TABLE "time_entry_log" (
    "id" TEXT NOT NULL,
    "timeEntryId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'note',
    "text" VARCHAR(1000) NOT NULL,
    "taskId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_entry_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_time_capture" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'task_done',
    "label" TEXT NOT NULL,
    "completedByType" TEXT NOT NULL DEFAULT 'agent',
    "completedByName" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedTimeEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_time_capture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "time_entry_log_timeEntryId_createdAt_idx" ON "time_entry_log"("timeEntryId", "createdAt");

-- CreateIndex
CREATE INDEX "time_entry_log_organizationId_idx" ON "time_entry_log"("organizationId");

-- CreateIndex
CREATE INDEX "time_entry_log_taskId_idx" ON "time_entry_log"("taskId");

-- CreateIndex
CREATE INDEX "pending_time_capture_organizationId_resolvedAt_idx" ON "pending_time_capture"("organizationId", "resolvedAt");

-- CreateIndex
CREATE INDEX "pending_time_capture_projectId_resolvedAt_idx" ON "pending_time_capture"("projectId", "resolvedAt");

-- AddForeignKey
ALTER TABLE "time_entry_log" ADD CONSTRAINT "time_entry_log_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "time_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entry_log" ADD CONSTRAINT "time_entry_log_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_time_capture" ADD CONSTRAINT "pending_time_capture_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_time_capture" ADD CONSTRAINT "pending_time_capture_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
