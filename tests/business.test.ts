import assert from "node:assert/strict";
import test from "node:test";
import { calculateChargeStatus, dashboardMetrics, unitStatus, validateActiveContract } from "../lib/business";
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
