CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'ACCOUNTANT');
CREATE TYPE "UnitType" AS ENUM ('STORAGE', 'GARAGE', 'BOX');
CREATE TYPE "UnitStatus" AS ENUM ('FREE', 'RESERVED', 'OCCUPIED', 'MAINTENANCE', 'ARCHIVED');
CREATE TYPE "CustomerType" AS ENUM ('INDIVIDUAL', 'BUSINESS');
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED');
CREATE TYPE "ChargeType" AS ENUM ('RENT', 'DEPOSIT', 'PENALTY', 'OTHER');
CREATE TYPE "ChargeStatus" AS ENUM ('PENDING', 'PAID', 'PARTIAL', 'OVERDUE', 'CANCELLED');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'SBP', 'CARD', 'OTHER');
CREATE TYPE "DocumentEntityType" AS ENUM ('CUSTOMER', 'CONTRACT', 'PAYMENT');
CREATE TYPE "DocumentType" AS ENUM ('CONTRACT_SCAN', 'RECEIPT', 'INVOICE', 'OTHER');
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE');

CREATE TABLE "User" (
  "id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL, "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL, "role" "UserRole" NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "Location" (
  "id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL, "address" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '',
  "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "Unit" (
  "id" SERIAL PRIMARY KEY, "locationId" INTEGER NOT NULL REFERENCES "Location"("id"),
  "unitNumber" TEXT NOT NULL, "unitType" "UnitType" NOT NULL, "areaSqm" DECIMAL(10,2) NOT NULL,
  "monthlyRate" DECIMAL(12,2) NOT NULL, "depositAmount" DECIMAL(12,2) NOT NULL,
  "status" "UnitStatus" NOT NULL DEFAULT 'FREE', "note" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE ("locationId", "unitNumber")
);
CREATE TABLE "Customer" (
  "id" SERIAL PRIMARY KEY, "customerType" "CustomerType" NOT NULL, "fullName" TEXT NOT NULL,
  "phone" TEXT NOT NULL, "email" TEXT NOT NULL, "passportOrRegistrationData" TEXT NOT NULL,
  "taxId" TEXT NOT NULL, "address" TEXT NOT NULL, "note" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "Contract" (
  "id" SERIAL PRIMARY KEY, "customerId" INTEGER NOT NULL REFERENCES "Customer"("id"),
  "unitId" INTEGER NOT NULL REFERENCES "Unit"("id"), "contractNumber" TEXT NOT NULL UNIQUE,
  "startDate" DATE NOT NULL, "endDate" DATE NOT NULL, "monthlyRate" DECIMAL(12,2) NOT NULL,
  "depositAmount" DECIMAL(12,2) NOT NULL, "billingDay" INTEGER NOT NULL,
  "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT', "terminationReason" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "Charge" (
  "id" SERIAL PRIMARY KEY, "contractId" INTEGER NOT NULL REFERENCES "Contract"("id"),
  "periodStart" DATE NOT NULL, "periodEnd" DATE NOT NULL, "dueDate" DATE NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL, "chargeType" "ChargeType" NOT NULL,
  "status" "ChargeStatus" NOT NULL DEFAULT 'PENDING', "note" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "Payment" (
  "id" SERIAL PRIMARY KEY, "customerId" INTEGER NOT NULL REFERENCES "Customer"("id"),
  "contractId" INTEGER NOT NULL REFERENCES "Contract"("id"), "chargeId" INTEGER REFERENCES "Charge"("id"),
  "paymentDate" DATE NOT NULL, "amount" DECIMAL(12,2) NOT NULL, "paymentMethod" "PaymentMethod" NOT NULL,
  "referenceNumber" TEXT NOT NULL, "comment" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "Document" (
  "id" SERIAL PRIMARY KEY, "entityType" "DocumentEntityType" NOT NULL, "entityId" INTEGER NOT NULL,
  "fileName" TEXT NOT NULL, "fileUrl" TEXT NOT NULL, "documentType" "DocumentType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "Task" (
  "id" SERIAL PRIMARY KEY, "title" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '',
  "dueDate" TIMESTAMP(3) NOT NULL, "priority" "TaskPriority" NOT NULL, "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
  "relatedEntityType" TEXT, "relatedEntityId" INTEGER, "assignedToUserId" INTEGER REFERENCES "User"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX "Unit_locationId_status_idx" ON "Unit"("locationId", "status");
CREATE INDEX "Contract_unitId_status_startDate_endDate_idx" ON "Contract"("unitId", "status", "startDate", "endDate");
CREATE INDEX "Contract_customerId_status_idx" ON "Contract"("customerId", "status");
CREATE INDEX "Charge_contractId_dueDate_status_idx" ON "Charge"("contractId", "dueDate", "status");
CREATE INDEX "Payment_contractId_paymentDate_idx" ON "Payment"("contractId", "paymentDate");
CREATE INDEX "Payment_chargeId_idx" ON "Payment"("chargeId");
CREATE INDEX "Document_entityType_entityId_idx" ON "Document"("entityType", "entityId");
CREATE INDEX "Task_status_dueDate_idx" ON "Task"("status", "dueDate");
