CREATE TYPE "PaymentRequestStatus" AS ENUM ('PREPARED', 'SENT', 'PAID', 'EXPIRED');

CREATE TABLE "PaymentSettings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "bankName" TEXT NOT NULL DEFAULT 'Т-Банк',
  "recipientName" TEXT NOT NULL,
  "taxId" TEXT NOT NULL,
  "kpp" TEXT NOT NULL DEFAULT '',
  "accountNumber" TEXT NOT NULL,
  "bic" TEXT NOT NULL,
  "correspondentAccount" TEXT NOT NULL,
  "receiptEmail" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentRequest" (
  "id" SERIAL NOT NULL,
  "contractId" INTEGER NOT NULL,
  "period" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "purpose" TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "status" "PaymentRequestStatus" NOT NULL DEFAULT 'PREPARED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentRequest_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "PaymentRequest_contractId_period_status_idx" ON "PaymentRequest"("contractId", "period", "status");
