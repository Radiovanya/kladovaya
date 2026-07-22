import assert from "node:assert/strict";
import test from "node:test";
import { createContractPdf } from "../lib/server/contract-pdf";

test("договор формируется как PDF с кириллицей", async () => {
  const pdf = await createContractPdf("# Договор аренды\n\nАрендатор: Игорь Иванович Иванов");
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  assert.ok(pdf.length > 1_000);
});
