import assert from "node:assert/strict";
import test from "node:test";
import { buildPaymentQrPayload, calculateChargeStatus, dashboardMetrics, hasCompletePaymentSettings, paymentPurpose, unitStatus, validateActiveContract } from "../lib/business";
import { seedData } from "../lib/seed";

test("начисление становится partial при частичной оплате до срока", () => {
  assert.equal(calculateChargeStatus(10000, 4000, "2026-08-05", new Date("2026-07-19")), "partial");
});

test("начисление становится paid при полном покрытии", () => {
  assert.equal(calculateChargeStatus(10000, 10000, "2026-07-05", new Date("2026-07-19")), "paid");
});

test("неполностью оплаченное начисление после срока просрочено", () => {
  assert.equal(calculateChargeStatus(10000, 4000, "2026-07-05", new Date("2026-07-19")), "overdue");
});

test("активный договор делает юнит занятым", () => {
  assert.equal(unitStatus(1, seedData), "occupied");
});

test("истёкший договор не делает юнит занятым", () => {
  assert.equal(unitStatus(4, seedData), "maintenance");
});

test("пересекающийся активный договор запрещён", () => {
  const candidate = { ...seedData.contracts[0], id: 999, startDate: "2026-07-01", endDate: "2026-12-01" };
  assert.throws(() => validateActiveContract(candidate, seedData.contracts), /уже есть активный договор/);
});

test("dashboard исключает архивные юниты и считает просрочку", () => {
  const metrics = dashboardMetrics(seedData, new Date("2026-07-19"));
  assert.equal(metrics.totalUnits, 6);
  assert.equal(metrics.occupiedUnits, 3);
  assert.equal(metrics.overdueChargesCount, 2);
  assert.equal(metrics.overdueAmount, 20500);
});

test("назначение QR содержит договор и оплачиваемый месяц", () => {
  assert.equal(paymentPurpose("Д-2026-014", "2026-08"), "Оплата аренды по договору Д-2026-014 за август 2026 г., без НДС");
});

test("QR ST00012 содержит сумму в копейках и банковские реквизиты", () => {
  const settings = {
    bankName: "Т-Банк", recipientName: "ООО Кладовая", taxId: "7812345678", kpp: "781201001",
    accountNumber: "40702810900000000001", bic: "044525974",
    correspondentAccount: "30101810145250000974", receiptEmail: "payments@example.ru"
  };
  assert.equal(hasCompletePaymentSettings(settings), true);
  const payload = buildPaymentQrPayload(settings, 6500, paymentPurpose("Д-2026-014", "2026-08"));
  assert.match(payload, /^ST00012\|/);
  assert.match(payload, /\|Sum=650000\|/);
  assert.match(payload, /\|PersonalAcc=40702810900000000001\|/);
  assert.match(payload, /Д-2026-014/);
});

test("платёжный QR не формируется без настоящих реквизитов", () => {
  const settings = {
    bankName: "Т-Банк", recipientName: "", taxId: "", kpp: "",
    accountNumber: "", bic: "", correspondentAccount: "", receiptEmail: ""
  };
  assert.equal(hasCompletePaymentSettings(settings), false);
  assert.throws(() => buildPaymentQrPayload(settings, 6500, "Аренда"), /Заполните платёжные реквизиты/);
});
