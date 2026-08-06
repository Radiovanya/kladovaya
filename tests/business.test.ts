import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import QRCode from "qrcode";
import { buildPaymentQrPayload, calculateChargeStatus, chargePaidAmount, dashboardMetrics, ensureUnitStatusHistory, hasCompletePaymentSettings, normalizeObjectPhotoUrl, paymentSettingsErrors, paymentTaskDueDate, paymentPurpose, portfolioAnalytics, recordUnitStatusChange, syncContractPaymentSchedule, syncMonthlyPaymentTasks, unitAnalytics, unitRentPaidThrough, unitStatus, validateActiveContract } from "../lib/business";
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

test("показывается последний полностью оплаченный период аренды объекта", () => {
  const unitId = seedData.contracts.find((contract) => seedData.payments.some((payment) => payment.contractId === contract.id && payment.chargeId))!.unitId;
  const paidCharge = seedData.charges.filter((charge) => seedData.contracts.some((contract) => contract.id === charge.contractId && contract.unitId === unitId) && chargePaidAmount(charge.id, seedData) >= charge.amount).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).at(-1);
  assert.equal(unitRentPaidThrough(seedData, unitId), paidCharge?.periodEnd ?? null);
});

test("старый платёж без chargeId закрывает совпадающий период для аналитики", () => {
  const data = structuredClone(seedData);
  const charge = data.charges[0];
  const payment = data.payments.find((item) => item.chargeId === charge.id)!;
  payment.chargeId = null;
  payment.paymentDate = charge.periodStart;
  assert.equal(unitRentPaidThrough(data, data.contracts.find((contract) => contract.id === charge.contractId)!.unitId), charge.periodEnd);
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

test("аналитика объекта считает доход, содержание, прибыль и доходность за 12 месяцев", () => {
  const analytics = unitAnalytics(seedData, 1, new Date("2026-07-19T12:00:00"));
  assert.equal(analytics.purchasePrice, 520000);
  assert.equal(analytics.rentalIncome, 6500);
  assert.equal(analytics.operatingCosts, 17700);
  assert.equal(analytics.profit, -11200);
  assert.equal(analytics.yieldPercent, 1.25);
  assert.equal(analytics.idleDays, 20);
});

test("портфельная аналитика суммирует выбранные объекты", () => {
  const analytics = portfolioAnalytics(seedData, [1, 3], new Date("2026-07-19T12:00:00"));
  assert.equal(analytics.purchasePrice, 1500000);
  assert.equal(analytics.rentalIncome, 20500);
  assert.equal(analytics.operatingCosts, 48000);
  assert.equal(analytics.profit, -27500);
  assert.equal(analytics.yieldPercent, 1.3666666666666667);
});

test("смена статуса закрывает прошлый период и начинает новый", () => {
  const changed = recordUnitStatusChange(seedData, 2, "maintenance", new Date("2026-07-20T12:00:00"));
  const events = changed.unitStatusHistory!.filter((event) => event.unitId === 2);
  assert.deepEqual(events, [
    { id: 3, unitId: 2, status: "free", startDate: "2026-04-01", endDate: "2026-07-19" },
    { id: 8, unitId: 2, status: "maintenance", startDate: "2026-07-20", endDate: null }
  ]);
});

test("для существующего объекта без истории отсчёт простоя начинается с обновления", () => {
  const data = structuredClone(seedData);
  delete data.unitStatusHistory;
  const initialized = ensureUnitStatusHistory(data, new Date("2026-07-24T12:00:00"));
  assert.equal(initialized.unitStatusHistory?.length, data.units.length);
  assert.equal(initialized.unitStatusHistory?.find((event) => event.unitId === 1)?.startDate, "2026-06-01");
  assert.equal(initialized.unitStatusHistory?.find((event) => event.unitId === 2)?.startDate, "2026-07-24");
});

test("занятый объект не получает фиктивный простой, а внесённая оплата с завтрашней датой входит в доход", () => {
  const data = structuredClone(seedData);
  data.locations = [{ id: 1, name: "АВТОВИТА", address: "Тольятти", description: "", isActive: true }];
  data.units = [{ id: 1, locationId: 1, unitNumber: "71", unitType: "storage", areaSqm: 5, monthlyRate: 2000, depositAmount: 0, status: "occupied", note: "" }];
  data.contracts = [{ id: 1, customerId: 1, unitId: 1, contractNumber: "Д-2026-001", startDate: "2026-07-15", endDate: "2026-09-15", monthlyRate: 2000, depositAmount: 0, billingDay: 15, status: "active", terminationReason: "", note: "" }];
  data.charges = [{ id: 1, contractId: 1, periodStart: "2026-07-15", periodEnd: "2026-09-15", dueDate: "2026-07-15", amount: 6000, chargeType: "rent", status: "paid", note: "" }];
  data.payments = [{ id: 1, customerId: 1, contractId: 1, chargeId: 1, paymentDate: "2026-07-28", amount: 6000, paymentMethod: "bank_transfer", referenceNumber: "ПП-1", comment: "" }];
  data.unitOperatingCosts = [{ unitId: 1, purchasePrice: 46000, monthlyPayment: 150, annualMembershipFees: 0, annualAdditionalExpenses: 0, updatedAt: "2026-07-27" }];
  data.unitStatusHistory = [{ id: 1, unitId: 1, status: "free", startDate: "2026-07-27", endDate: null }];

  const reconciled = ensureUnitStatusHistory(data, new Date("2026-07-27T12:00:00"));
  assert.deepEqual(reconciled.unitStatusHistory, [
    { id: 1, unitId: 1, status: "occupied", startDate: "2026-07-15", endDate: null }
  ]);
  const analytics = unitAnalytics(reconciled, 1, new Date("2026-07-27T12:00:00"));
  assert.equal(analytics.rentalIncome, 6000);
  assert.equal(analytics.idleDays, 0);
  assert.equal(analytics.profit, 4200);
  assert.equal(analytics.yieldPercent, 6000 / 46000 * 100);
});

test("аналитика отдельной кладовой не включает расходы и простой соседнего объекта", () => {
  const data = structuredClone(seedData);
  data.units = [
    { id: 2, locationId: 2, unitNumber: "182", unitType: "storage", areaSqm: 3, monthlyRate: 2000, depositAmount: 0, status: "free", note: "" },
    { id: 3, locationId: 2, unitNumber: "46", unitType: "storage", areaSqm: 3, monthlyRate: 2000, depositAmount: 0, status: "occupied", note: "" }
  ];
  data.unitOperatingCosts = [
    { unitId: 2, purchasePrice: 20000, monthlyPayment: 150, annualMembershipFees: 0, annualAdditionalExpenses: 500, updatedAt: "2026-07-28" },
    { unitId: 3, purchasePrice: 25000, monthlyPayment: 150, annualMembershipFees: 500, annualAdditionalExpenses: 0, updatedAt: "2026-07-28" }
  ];
  data.unitStatusHistory = [
    { id: 2, unitId: 2, status: "free", startDate: "2026-07-28", endDate: null },
    { id: 3, unitId: 3, status: "occupied", startDate: "2026-04-06", endDate: null }
  ];
  data.contracts = [];
  data.payments = [];
  data.charges = [];

  const unit = unitAnalytics(data, 3, new Date("2026-07-28T12:00:00"));
  assert.equal(unit.operatingCosts, 2300);
  assert.equal(unit.idleDays, 0);

  const address = portfolioAnalytics(data, [2, 3], new Date("2026-07-28T12:00:00"));
  assert.equal(address.operatingCosts, 4600);
  assert.equal(address.idleDays, 1);
});

test("назначение QR содержит договор и оплачиваемый месяц", () => {
  assert.equal(paymentPurpose("Д-2026-014", "2026-08"), "Аренда Д-2026-014 08.2026, без НДС");
});

test("QR ST00012 содержит сумму в копейках и банковские реквизиты", () => {
  const settings = {
    bankName: "АО ТБанк", recipientName: "ИП Тестов Иван Иванович", taxId: "500100732259", kpp: "",
    accountNumber: "40802810600009495815", bic: "044525974",
    correspondentAccount: "30101810145250000974", receiptEmail: "payments@example.ru"
  };
  assert.equal(hasCompletePaymentSettings(settings), true);
  const payload = buildPaymentQrPayload(settings, 6500, paymentPurpose("Д-2026-014", "2026-08"));
  assert.match(payload, /^ST00012\|/);
  assert.match(payload, /\|Sum=650000\|/);
  assert.match(payload, /\|PersonalAcc=40802810600009495815\|/);
  assert.match(payload, /Д-2026-014/);
  assert.ok(QRCode.create(payload, { errorCorrectionLevel: "L" }).modules.size <= 57);
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
    bankName: "АО ТБанк", recipientName: "ИП Тестов Иван Иванович", taxId: "500100732258", kpp: "",
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
    bankName: "АО ТБанк", recipientName: "ИП Тестов Иван Иванович", taxId: "500100732259", kpp: "",
    accountNumber: "40802810600009495815", bic: "044525974",
    correspondentAccount: "30101810145250000974", receiptEmail: "payments@example.test"
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
  const firstUnit = seedData.units.find((unit) => unit.id === seedData.contracts[0].unitId)!;
  const firstLocation = seedData.locations.find((location) => location.id === firstUnit.locationId)!;
  assert.equal(first?.title, `Кладовая № ${firstUnit.unitNumber} · ${firstLocation.name}`);
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

test("квартальный договор создаёт график начислений по 3 месяца", () => {
  const data = structuredClone(seedData);
  data.charges = [];
  data.payments = [];
  data.contracts = [{
    ...data.contracts[0],
    id: 50,
    startDate: "2026-08-15",
    endDate: "2027-08-14",
    monthlyRate: 2000,
    paymentIntervalMonths: 3,
    firstPaymentDate: "2026-08-10",
    advanceNoticeDays: 5
  }];
  const result = syncContractPaymentSchedule(data, 50);
  assert.equal(result.charges.length, 4);
  assert.deepEqual(
    result.charges.map((charge) => [charge.periodStart, charge.periodEnd, charge.dueDate, charge.amount]),
    [
      ["2026-08-15", "2026-11-14", "2026-08-10", 6000],
      ["2026-11-15", "2027-02-14", "2026-11-10", 6000],
      ["2027-02-15", "2027-05-14", "2027-02-10", 6000],
      ["2027-05-15", "2027-08-14", "2027-05-10", 6000]
    ]
  );
});

test("ожидающая проверки Telegram-оплата не закрывает начисление", () => {
  const data = structuredClone(seedData);
  data.payments = [{
    ...data.payments[0],
    chargeId: data.charges[0].id,
    amount: data.charges[0].amount,
    status: "pending_verification"
  }];
  assert.equal(chargePaidAmount(data.charges[0].id, data), 0);
});

test("номер договора продолжает последовательность текущего года", () => {
  assert.equal(nextContractNumber(seedData.contracts, new Date("2026-07-21")), "Д-2026-015");
});

test("договор заполняется данными клиента, адреса, объекта и периода", () => {
  const template = readFileSync(new URL("../public/dogovor_arendy_kladovoi_RF.md", import.meta.url), "utf8");
  const data = structuredClone(seedData);
  data.landlordSettings!.entrepreneur = {
    fullName: "ИП Тестов Иван Иванович", passport: "", registrationAddress: "", phone: "+79990000000",
    email: "payments@example.test", taxId: "500100732259", bankName: "", cardNumber: ""
  };
  const document = generateRentalContract(template, data, 1);
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
  assert.match(document, /ИП Тестов Иван Иванович/);
  assert.match(document, /ИНН: 500100732259/);
  assert.match(document, /Арбитражный суд Самарской области/);
  assert.match(document, /при направлении заказным письмом — на 2-й день/);
  assert.match(document, /стены: бетон/);
  assert.match(document, /брелок с номером кладовой: 1 шт\./);
  assert.match(document, /не менее 1000 рублей/);
  assert.doesNotMatch(document, /\[file:/);
  assert.doesNotMatch(document, /Редакционные замечания/);
});

test("договор можно сформировать от физического лица", () => {
  const template = readFileSync(new URL("../public/dogovor_arendy_kladovoi_RF.md", import.meta.url), "utf8");
  const data = structuredClone(seedData);
  data.landlordSettings!.individual = {
    fullName: "Тестов Иван Иванович",
    passport: "36 02 386312, выдан 01.02.2020",
    registrationAddress: "г. Тольятти, ул. Примерная, 1",
    phone: "+79990000000",
    email: "owner@klad-v.ru",
    taxId: "",
    bankName: "ТБанк",
    cardNumber: "2200123456789012"
  };
  const document = generateRentalContract(template, data, 1, "individual");
  assert.match(document, /Тестов Иван Иванович, паспорт: 36 02 386312/);
  assert.match(document, /ФИО: Тестов Иван Иванович/);
  assert.match(document, /Место регистрации: г\. Тольятти, ул\. Примерная, 1/);
  assert.match(document, /E-mail: owner@klad-v\.ru/);
  assert.match(document, /Банк: ТБанк/);
  assert.match(document, /Номер карты: 2200 1234 5678 9012/);
  assert.match(document, /Арендодатель: Тестов Иван Иванович \(физическое лицо\)/);
  assert.doesNotMatch(document, /ИНН: 500100732259/);
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
  data.documents.push({ id: 100, entityType: "contract", entityId: 1, fileName: "signed.pdf", fileUrl: "/api/documents?key=contracts%2F1%2Fsigned.pdf", documentType: "contract_scan" });
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
