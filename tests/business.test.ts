import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import QRCode from "qrcode";
import { buildPaymentQrPayload, calculateChargeStatus, dashboardMetrics, hasCompletePaymentSettings, normalizeObjectPhotoUrl, paymentSettingsErrors, paymentTaskDueDate, paymentPurpose, syncMonthlyPaymentTasks, unitStatus, validateActiveContract } from "../lib/business";
import { generateRentalContract, nextContractNumber } from "../lib/contract-document";
import { customerContractScans, eligibleContractsForScan, validateSignedContractUpload } from "../lib/contract-scans";
import { findContractNumber, findPaymentPeriod } from "../lib/receipt-email";
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

test("ручной статус занятого объекта сохраняется", () => {
  assert.equal(unitStatus(1, seedData), "occupied");
});

test("ручной статус ремонта сохраняется", () => {
  assert.equal(unitStatus(4, seedData), "maintenance");
});

test("ручной статус свободного объекта не подменяется активным договором", () => {
  const data = structuredClone(seedData);
  data.units.find((unit) => unit.id === 1)!.status = "free";
  assert.equal(unitStatus(1, data), "free");
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
  assert.equal(paymentPurpose("Д-2026-014", "2026-08"), "Аренда Д-2026-014 08.2026, без НДС");
});

test("QR ST00012 содержит сумму в копейках и банковские реквизиты", () => {
  const settings = {
    bankName: "АО ТБанк", recipientName: "ИП Маньковский Алексей Александрович", taxId: "632139808096", kpp: "",
    accountNumber: "40802810600009495815", bic: "044525974",
    correspondentAccount: "30101810145250000974", receiptEmail: "payments@example.ru"
  };
  assert.equal(hasCompletePaymentSettings(settings), true);
  const payload = buildPaymentQrPayload(settings, 6500, paymentPurpose("Д-2026-014", "2026-08"));
  assert.match(payload, /^ST00012\|/);
  assert.match(payload, /\|Sum=650000\|/);
  assert.match(payload, /\|PersonalAcc=40802810600009495815\|/);
  assert.match(payload, /Д-2026-014/);
  assert.equal(QRCode.create(payload, { errorCorrectionLevel: "L" }).modules.size, 57);
});

test("платёжный QR не формируется без настоящих реквизитов", () => {
  const settings = {
    bankName: "Т-Банк", recipientName: "", taxId: "", kpp: "",
    accountNumber: "", bic: "", correspondentAccount: "", receiptEmail: ""
  };
  assert.equal(hasCompletePaymentSettings(settings), false);
  assert.throws(() => buildPaymentQrPayload(settings, 6500, "Аренда"), /Заполните платёжные реквизиты/);
});

test("платёжный QR отклоняет реквизиты с неверными контрольными суммами", () => {
  const settings = {
    bankName: "АО ТБанк", recipientName: "ИП Маньковский Алексей Александрович", taxId: "632139808095", kpp: "",
    accountNumber: "40802810600009495814", bic: "044525974",
    correspondentAccount: "30101810145250000973", receiptEmail: "payments@example.ru"
  };
  assert.deepEqual(paymentSettingsErrors(settings), [
    "проверьте ИНН получателя",
    "расчётный счёт не соответствует БИК",
    "корреспондентский счёт не соответствует БИК"
  ]);
  assert.equal(hasCompletePaymentSettings(settings), false);
});

test("актуальные реквизиты получателя проходят расширенную проверку", () => {
  const settings = {
    bankName: "АО ТБанк", recipientName: "ИП Маньковский Алексей Александрович", taxId: "632139808096", kpp: "",
    accountNumber: "40802810600009495815", bic: "044525974",
    correspondentAccount: "30101810145250000974", receiptEmail: "payments@klad-v.ru"
  };
  assert.deepEqual(paymentSettingsErrors(settings), []);
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

test("скан договора связывается с договором и исключает повторную загрузку для объекта", () => {
  const data = structuredClone(seedData);
  data.documents = [];
  assert.deepEqual(eligibleContractsForScan(data, 1).map((contract) => contract.id), [1]);
  data.documents.push({ id: 100, entityType: "contract", entityId: 1, fileName: "signed.pdf", fileUrl: "indexeddb:100", documentType: "contract_scan" });
  assert.equal(customerContractScans(data, 1).length, 1);
  assert.equal(eligibleContractsForScan(data, 1).length, 0);
  assert.throws(() => validateSignedContractUpload(data, 1, 1), /уже загружена/);
});

test("для одного клиента разрешено не более трёх сканов на разных объектах", () => {
  const data = structuredClone(seedData);
  data.documents = [];
  data.contracts = [1, 2, 3, 5].map((unitId, index) => ({ ...seedData.contracts[0], id: 101 + index, unitId, customerId: 1, contractNumber: `Т-${index + 1}` }));
  data.documents = data.contracts.slice(0, 3).map((contract, index) => ({ id: 201 + index, entityType: "contract" as const, entityId: contract.id, fileName: `${index}.pdf`, fileUrl: `indexeddb:${201 + index}`, documentType: "contract_scan" as const }));
  assert.throws(() => validateSignedContractUpload(data, 1, data.contracts[3].id), /максимальное количество/);
});

test("письмо с чеком сопоставляется по договору и русскому названию месяца", () => {
  const text = "Договор: Д-2026-014\nПериод: июль 2026";
  assert.equal(findContractNumber(text, ["Д-2026-014", "Д-2026-011"]), "Д-2026-014");
  assert.equal(findPaymentPeriod(text), "2026-07");
});

test("письмо с чеком принимает числовой период", () => {
  assert.equal(findPaymentPeriod("Месяц: 08.2026"), "2026-08");
  assert.equal(findPaymentPeriod("Период: 2026-09"), "2026-09");
});
