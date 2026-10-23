-- Misiones semanales y racha por persona.
-- El arranque en Render usa `prisma db push`: añade columnas con
-- valor por defecto y crea WeeklyGoal sin borrar filas existentes.
-- weeklyGoalId en Task ya existe; la relación se engancha sin tocar tareas.

ALTER TABLE "Membership" ADD COLUMN "streakDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Membership" ADD COLUMN "streakLastDate" TEXT;

CREATE TABLE IF NOT EXISTS "WeeklyGoal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "areaId" TEXT,
    "membershipId" TEXT,
    "weekStart" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "kpiKey" TEXT,
    "title" TEXT NOT NULL,
    "target" REAL NOT NULL,
    "current" REAL NOT NULL DEFAULT 0,
    "rewardPoints" INTEGER NOT NULL DEFAULT 25,
    "awardedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeeklyGoal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WeeklyGoal_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WeeklyGoal_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "WeeklyGoal_companyId_idx" ON "WeeklyGoal"("companyId");
CREATE INDEX IF NOT EXISTS "WeeklyGoal_companyId_weekStart_idx" ON "WeeklyGoal"("companyId", "weekStart");
CREATE INDEX IF NOT EXISTS "WeeklyGoal_companyId_areaId_idx" ON "WeeklyGoal"("companyId", "areaId");
CREATE INDEX IF NOT EXISTS "WeeklyGoal_companyId_membershipId_idx" ON "WeeklyGoal"("companyId", "membershipId");
