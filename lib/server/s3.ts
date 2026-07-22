import { S3Client } from "@aws-sdk/client-s3";

export const documentsBucket = process.env.S3_BUCKET ?? "";

export const s3 = new S3Client({
  region: process.env.S3_REGION ?? "ru1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY ? {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
  } : undefined
});

export function assertS3Configured() {
  if (!documentsBucket || !process.env.S3_ENDPOINT || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) {
    throw new Error("S3 storage is not configured");
  }
}
