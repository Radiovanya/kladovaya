CREATE TABLE "AppState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppState_pkey" PRIMARY KEY ("id")
);
