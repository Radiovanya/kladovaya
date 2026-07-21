ALTER TYPE "TaskStatus" ADD VALUE 'SENT';
ALTER TYPE "TaskStatus" ADD VALUE 'PAID';

ALTER TABLE "Task" ADD COLUMN "paymentPeriod" TEXT;

CREATE INDEX "Task_relatedEntityType_relatedEntityId_paymentPeriod_idx"
ON "Task"("relatedEntityType", "relatedEntityId", "paymentPeriod");
