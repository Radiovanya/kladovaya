import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPaymentQrPayload, calculateChargeStatus, dashboardMetrics, hasCompletePaymentSettings, normalizeObjectPhotoUrl, paymentTaskDueDate, paymentPurpose, syncMonthlyPaymentTasks, unitStatus, validateActiveContract } from "../lib/business";
import { generateRentalContract, nextContractNumber, nextObjectNumber } from "../lib/contract-document";
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

test("для активных договоров создаются ежемесячные задачи по дню оплаты", () => {
  const data = syncMonthlyPaymentTasks(seedData, new Date("2026-07-21T12:00:00"));
  const paymentTasks = data.tasks.filter((task) =>
    task.relatedEntityType === "contract_payment" && task.paymentPeriod === "2026-07"
  );
  assert.equal(paymentTasks.length, seedData.contracts.filter((contract) => contract.status === "active").length);
  const first = paymentTasks.find((task) => task.relatedEntityId === seedData.contracts[0].id);
  assert.equal(first?.dueDate, paymentTaskDueDate(seedData.contracts[0], "2026-07"));
  assert.equal(first?.status, "paid");
});

test("повторная синхронизация не дублирует задачу за тот же месяц", () => {
  const once = syncMonthlyPaymentTasks(seedData, new Date("2026-07-21T12:00:00"));
  const twice = syncMonthlyPaymentTasks(once, new Date("2026-07-22T12:00:00"));
  assert.equal(twice.tasks.length, once.tasks.length);
});

test("день оплаты ограничивается последним днём короткого месяца", () => {
  const contract = { ...seedData.contracts[0], billingDay: 31 };
  assert.equal(paymentTaskDueDate(contract, "2027-02"), "2027-02-28T09:00");
});

test("номер договора продолжает последовательность текущего года", () => {
  assert.equal(nextContractNumber(seedData.contracts, new Date("2026-07-21")), "Д-2026-015");
});

test("номер нового объекта продолжает существующую последовательность", () => {
  assert.equal(nextObjectNumber(seedData), "О-023");
});

test("договор заполняется данными клиента, адреса, объекта и периода", () => {
  const template = readFileSync(new URL("../public/dogovor_arendy_kladovoi_RF.md", import.meta.url), "utf8");
  const document = generateRentalContract(template, seedData, 1);
  assert.match(document, /Договор аренды кладовой № Д-2026-014/);
  assert.match(document, /Алексей Смирнов/);
  assert.match(document, /\+7 921 555-14-20/);
  assert.match(document, /a\.smirnov@mail\.ru/);
  assert.match(document, /Паспорт 4018 123456/);
  assert.match(document, /Санкт-Петербург, ул\. Северная, 12/);
  assert.match(document, /A-014/);
  assert.match(document, /4,2 кв\. м/);
  assert.match(document, /6 500 рублей в месяц/);
  assert.match(document, /«01» июня 2026 г\. по «31» мая 2027 г\./);
  assert.doesNotMatch(document, /\[file:/);
  assert.doesNotMatch(document, /Редакционные замечания/);
});

test("ссылка на фото объекта принимает публичный HTTPS URL", () => {
  assert.equal(normalizeObjectPhotoUrl(" https://storage.yandexcloud.net/kladovaya/A-014.jpg "), "https://storage.yandexcloud.net/kladovaya/A-014.jpg");
  assert.equal(normalizeObjectPhotoUrl(""), "");
  assert.throws(() => normalizeObjectPhotoUrl("http://example.test/photo.jpg"), /https:\/\//);
  assert.throws(() => normalizeObjectPhotoUrl("не ссылка"), /корректную ссылку/);
});
