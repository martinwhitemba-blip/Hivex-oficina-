-- Dónde se pone la foto en el avatar: cara o gafete.
-- `prisma db push` añade la columna con valor por defecto. Las filas
-- que ya existen quedan en «cara».

ALTER TABLE "Membership" ADD COLUMN "photoPlacement" TEXT NOT NULL DEFAULT 'cara';
