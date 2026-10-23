-- Tareas con fecha, prioridad, subtareas y comentarios.
-- El arranque en Render usa `prisma db push`: añade columnas con
-- valor por defecto y crea TaskComment sin borrar filas existentes.
-- SQLite (local) aplica un ALTER por columna.

ALTER TABLE "Task" ADD COLUMN "dueDate" DATETIME;
ALTER TABLE "Task" ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'media';
ALTER TABLE "Task" ADD COLUMN "parentId" TEXT;
ALTER TABLE "Task" ADD COLUMN "sort" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Task" ADD COLUMN "weeklyGoalId" TEXT;
ALTER TABLE "Task" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Task" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "Task_companyId_areaId_status_idx" ON "Task"("companyId", "areaId", "status");
CREATE INDEX IF NOT EXISTS "Task_companyId_assigneeId_status_idx" ON "Task"("companyId", "assigneeId", "status");
CREATE INDEX IF NOT EXISTS "Task_companyId_dueDate_idx" ON "Task"("companyId", "dueDate");
CREATE INDEX IF NOT EXISTS "Task_companyId_parentId_idx" ON "Task"("companyId", "parentId");

CREATE TABLE IF NOT EXISTS "TaskComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskComment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Membership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "TaskComment_companyId_idx" ON "TaskComment"("companyId");
CREATE INDEX IF NOT EXISTS "TaskComment_companyId_taskId_createdAt_idx" ON "TaskComment"("companyId", "taskId", "createdAt");
