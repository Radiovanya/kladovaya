import type { AppData, ChargeStatus, Contract, PaymentSettings, TaskStatus, UnitOperatingCosts, UnitStatus } from "./types";

export const money = (value: number) =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value);

export function chargePaidAmount(chargeId: number, data: Pick<AppData, "payments">) {
  return data.payments.filter((payment) => payment.chargeId === chargeId).reduce((sum, payment) => sum + payment.amount, 0);
}

export function calculateChargeStatus(
  amount: number,
  paidAmount: number,
  dueDate: string,
  now = new Date()
): ChargeStatus {
  if (paidAmount >= amount) return "paid";
  if (new Date(`${dueDate}T23:59:59`) < now) return "overdue";
  if (paidAmount > 0) return "partial";
  return "pending";
}

export function effectiveChargeStatus(chargeId: number, data: Pick<AppData, "charges" | "payments">, now = new Date()) {
  const charge = data.charges.find((item) => item.id === chargeId);
  if (!charge) throw new Error("Начисление не найдено");
  if (charge.status === "cancelled") return "cancelled";
  return calculateChargeStatus(charge.amount, chargePaidAmount(charge.id, data), charge.dueDate, now);
}

export function unitStatus(unitId: number, data: Pick<AppData, "units">): UnitStatus {
  const unit = data.units.find((item) => item.id === unitId);
  if (!unit) throw new Error("Объект не найден");
  return unit.status;
}

export function validateActiveContract(candidate: Contract, contracts: Contract[]) {
  if (candidate.status !== "active") return;
  if (!candidate.customerId || !candidate.unitId) throw new Error("Активный договор должен иметь клиента и юнит");
  const start = new Date(candidate.startDate).getTime();
  const end = new Date(candidate.endDate).getTime();
  if (start > end) throw new Error("Дата окончания не может быть раньше даты начала");
  const collision = contracts.some((contract) => {
    if (contract.id === candidate.id || contract.unitId !== candidate.unitId || contract.status !== "active") return false;
    const otherStart = new Date(contract.startDate).getTime();
    const otherEnd = new Date(contract.endDate).getTime();
    return start <= otherEnd && end >= otherStart;
  });
  if (collision) throw new Error("На выбранный период у юнита уже есть активный договор");
}

export function dashboardMetrics(data: AppData, now = new Date()) {
  const relevantUnits = data.units.filter((unit) => unit.status !== "archived");
  const statuses = relevantUnits.map((unit) => unitStatus(unit.id, data));
  const overdue = data.charges.filter((charge) => effectiveChargeStatus(charge.id, data, now) === "overdue");
  const inThirtyDays = new Date(now);
  inThirtyDays.setDate(now.getDate() + 30);
  return {
    totalUnits: relevantUnits.length,
    freeUnits: statuses.filter((status) => status === "free").length,
    occupiedUnits: statuses.filter((status) => status === "occupied").length,
    overdueChargesCount: overdue.length,
    overdueAmount: overdue.reduce((sum, charge) => sum + Math.max(0, charge.amount - chargePaidAmount(charge.id, data)), 0),
    endingContracts: data.contracts.filter((contract) =>
      contract.status === "active" && new Date(contract.endDate) >= now && new Date(contract.endDate) <= inThirtyDays
    ).length
  };
}

const isoDate = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const dateAtMidnight = (value: string) => new Date(`${value}T00:00:00`);
const daysBetweenInclusive = (start: string, end: string) =>
  Math.max(0, Math.floor((dateAtMidnight(end).getTime() - dateAtMidnight(start).getTime()) / 86_400_000) + 1);

export function ensureUnitStatusHistory(data: AppData, now = new Date()) {
  const next = structuredClone(data);
  next.unitStatusHistory ??= [];
  let nextEventId = Math.max(0, ...next.unitStatusHistory.map((event) => event.id)) + 1;
  const today = isoDate(now);
  for (const unit of next.units) {
    const hasOpenEvent = next.unitStatusHistory.some((event) => event.unitId === unit.id && event.endDate === null);
    if (!hasOpenEvent) {
      next.unitStatusHistory.push({
        id: nextEventId++,
        unitId: unit.id,
        status: unit.status,
        startDate: today,
        endDate: null
      });
    }
  }
  return next;
}

export function recordUnitStatusChange(data: AppData, unitId: number, status: UnitStatus, changedAt = new Date()) {
  const next = ensureUnitStatusHistory(data, changedAt);
  const today = isoDate(changedAt);
  const events = next.unitStatusHistory!;
  const openEvent = [...events].reverse().find((event) => event.unitId === unitId && event.endDate === null);
  if (openEvent?.status === status) return next;
  if (openEvent?.startDate === today) {
    openEvent.status = status;
    return next;
  }
  if (openEvent) {
    const previousDay = dateAtMidnight(today);
    previousDay.setDate(previousDay.getDate() - 1);
    openEvent.endDate = isoDate(previousDay);
  }
  events.push({
    id: Math.max(0, ...events.map((event) => event.id)) + 1,
    unitId,
    status,
    startDate: today,
    endDate: null
  });
  return next;
}

export function unitOperatingCosts(data: AppData, unitId: number): UnitOperatingCosts {
  return data.unitOperatingCosts?.find((item) => item.unitId === unitId) ?? {
    unitId,
    purchasePrice: 0,
    monthlyPayment: 0,
    annualMembershipFees: 0,
    annualAdditionalExpenses: 0,
    updatedAt: ""
  };
}

export interface UnitAnalytics {
  unitId: number;
  purchasePrice: number;
  monthlyRent: number;
  rentalIncome: number;
  operatingCosts: number;
  profit: number;
  yieldPercent: number;
  idleDays: number;
  trackingSince: string | null;
}

export function unitAnalytics(data: AppData, unitId: number, now = new Date()): UnitAnalytics {
  const unit = data.units.find((item) => item.id === unitId);
  if (!unit) throw new Error("Объект не найден");
  const costs = unitOperatingCosts(data, unitId);
  const contractIds = data.contracts.filter((contract) => contract.unitId === unitId).map((contract) => contract.id);
  const periodStart = new Date(now);
  periodStart.setFullYear(periodStart.getFullYear() - 1);
  const startDate = isoDate(periodStart);
  const endDate = isoDate(now);
  const rentalIncome = data.payments
    .filter((payment) => {
      if (!contractIds.includes(payment.contractId) || payment.paymentDate < startDate || payment.paymentDate > endDate) return false;
      const charge = payment.chargeId ? data.charges.find((item) => item.id === payment.chargeId) : undefined;
      return !charge || charge.chargeType === "rent";
    })
    .reduce((sum, payment) => sum + payment.amount, 0);
  const operatingCosts = costs.monthlyPayment * 12 + costs.annualMembershipFees + costs.annualAdditionalExpenses;
  const events = (data.unitStatusHistory ?? []).filter((event) => event.unitId === unitId);
  const idleDays = events
    .filter((event) => event.status === "free" || event.status === "maintenance")
    .reduce((sum, event) => {
      const overlapStart = event.startDate > startDate ? event.startDate : startDate;
      const eventEnd = event.endDate && event.endDate < endDate ? event.endDate : endDate;
      return overlapStart <= eventEnd ? sum + daysBetweenInclusive(overlapStart, eventEnd) : sum;
    }, 0);
  return {
    unitId,
    purchasePrice: costs.purchasePrice,
    monthlyRent: unit.monthlyRate,
    rentalIncome,
    operatingCosts,
    profit: rentalIncome - operatingCosts,
    yieldPercent: costs.purchasePrice > 0 ? rentalIncome / costs.purchasePrice * 100 : 0,
    idleDays,
    trackingSince: events.length ? [...events].sort((a, b) => a.startDate.localeCompare(b.startDate))[0].startDate : null
  };
}

export function portfolioAnalytics(data: AppData, unitIds: number[], now = new Date()) {
  const rows = unitIds.map((unitId) => unitAnalytics(data, unitId, now));
  const total = rows.reduce((result, row) => ({
    purchasePrice: result.purchasePrice + row.purchasePrice,
    monthlyRent: result.monthlyRent + row.monthlyRent,
    rentalIncome: result.rentalIncome + row.rentalIncome,
    operatingCosts: result.operatingCosts + row.operatingCosts,
    profit: result.profit + row.profit,
    idleDays: result.idleDays + row.idleDays
  }), { purchasePrice: 0, monthlyRent: 0, rentalIncome: 0, operatingCosts: 0, profit: 0, idleDays: 0 });
  return {
    ...total,
    yieldPercent: total.purchasePrice > 0 ? total.rentalIncome / total.purchasePrice * 100 : 0,
    trackingSince: rows.map((row) => row.trackingSince).filter((value): value is string => Boolean(value)).sort()[0] ?? null
  };
}

const cleanQrValue = (value: string) => value.replace(/[|]/g, " ").trim();

const qrDigits = (value: string) => value.replace(/\D/g, "");
const qrChecksum = (value: string) => {
  const weights = [7, 1, 3];
  return [...value].reduce((sum, digit, index) => sum + Number(digit) * weights[index % weights.length], 0) % 10;
};

function validInn(value: string) {
  if (/^\d{10}$/.test(value)) {
    const weights = [2, 4, 10, 3, 5, 9, 4, 6, 8];
    const check = weights.reduce((sum, weight, index) => sum + Number(value[index]) * weight, 0) % 11 % 10;
    return check === Number(value[9]);
  }
  if (/^\d{12}$/.test(value)) {
    const firstWeights = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
    const secondWeights = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
    const first = firstWeights.reduce((sum, weight, index) => sum + Number(value[index]) * weight, 0) % 11 % 10;
    const second = secondWeights.reduce((sum, weight, index) => sum + Number(value[index]) * weight, 0) % 11 % 10;
    return first === Number(value[10]) && second === Number(value[11]);
  }
  return false;
}

export function paymentSettingsErrors(settings: PaymentSettings) {
  const bankName = settings.bankName.trim();
  const recipientName = settings.recipientName.trim();
  const taxId = qrDigits(settings.taxId);
  const kpp = qrDigits(settings.kpp);
  const account = qrDigits(settings.accountNumber);
  const bic = qrDigits(settings.bic);
  const correspondent = qrDigits(settings.correspondentAccount);
  const errors: string[] = [];

  if (!bankName) errors.push("укажите официальное название банка");
  if (!recipientName) errors.push("укажите получателя платежа");
  if (!validInn(taxId)) errors.push("проверьте ИНН получателя");
  if (settings.kpp.trim() && !/^\d{9}$/.test(kpp)) errors.push("КПП должен содержать 9 цифр");
  if (!/^\d{9}$/.test(bic)) errors.push("БИК должен содержать 9 цифр");
  if (!/^\d{20}$/.test(account)) errors.push("расчётный счёт должен содержать 20 цифр");
  if (!/^\d{20}$/.test(correspondent)) errors.push("корреспондентский счёт должен содержать 20 цифр");
  if (/^\d{9}$/.test(bic) && /^\d{20}$/.test(account) && qrChecksum(`${bic.slice(-3)}${account}`) !== 0) {
    errors.push("расчётный счёт не соответствует БИК");
  }
  if (/^\d{9}$/.test(bic) && /^\d{20}$/.test(correspondent) && qrChecksum(`0${bic.slice(4, 6)}${correspondent}`) !== 0) {
    errors.push("корреспондентский счёт не соответствует БИК");
  }
  return errors;
}

export function paymentPeriodLabel(period: string) {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) throw new Error("Некорректный месяц оплаты");
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

export function paymentPurpose(contractNumber: string, period: string) {
  const [year, month] = period.split("-");
  return `Аренда ${cleanQrValue(contractNumber)} ${month}.${year}, без НДС`;
}

export function hasCompletePaymentSettings(settings: PaymentSettings) {
  return paymentSettingsErrors(settings).length === 0;
}

export function buildPaymentQrPayload(settings: PaymentSettings, amount: number, purpose: string) {
  if (!hasCompletePaymentSettings(settings)) throw new Error("Заполните платёжные реквизиты");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Сумма должна быть больше нуля");
  const fields = [
    "ST00012",
    `Name=${cleanQrValue(settings.recipientName)}`,
    `PersonalAcc=${qrDigits(settings.accountNumber)}`,
    `BankName=${cleanQrValue(settings.bankName)}`,
    `BIC=${qrDigits(settings.bic)}`,
    `CorrespAcc=${qrDigits(settings.correspondentAccount)}`,
    `PayeeINN=${qrDigits(settings.taxId)}`,
    settings.kpp.trim() ? `KPP=${qrDigits(settings.kpp)}` : "",
    `Sum=${Math.round(amount * 100)}`,
    `Purpose=${cleanQrValue(purpose)}`
  ].filter(Boolean);
  return fields.join("|");
}

export function normalizeObjectPhotoUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  let url: URL;
  try { url = new URL(trimmed); }
  catch { throw new Error("Укажите корректную ссылку на фото"); }
  if (url.protocol !== "https:") throw new Error("Ссылка на фото должна начинаться с https://");
  return url.toString();
}

const pad = (value: number) => String(value).padStart(2, "0");

export function currentPaymentPeriod(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

export function paymentTaskDueDate(contract: Contract, period: string) {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) throw new Error("Некорректный месяц оплаты");
  const lastDay = new Date(year, month, 0).getDate();
  const billingDay = Math.min(Math.max(Math.trunc(contract.billingDay || 1), 1), lastDay);
  return `${period}-${pad(billingDay)}T09:00`;
}

function paymentTaskStatus(data: AppData, contractId: number, period: string, now: Date): TaskStatus {
  const request = [...(data.paymentRequests ?? [])]
    .reverse()
    .find((item) => item.contractId === contractId && item.period === period);
  if (request?.status === "paid") return "paid";
  if (request?.status === "sent") return "sent";
  const charge = data.charges.find((item) =>
    item.contractId === contractId && item.periodStart.slice(0, 7) === period
  );
  if (charge && effectiveChargeStatus(charge.id, data, now) === "paid") return "paid";
  return "open";
}

export function syncMonthlyPaymentTasks(data: AppData, now = new Date()): AppData {
  const next = ensureUnitStatusHistory(data, now);
  const period = currentPaymentPeriod(now);
  const [year, month] = period.split("-").map(Number);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59);

  for (const contract of next.contracts) {
    if (
      contract.status !== "active" ||
      new Date(`${contract.startDate}T00:00:00`) > monthEnd ||
      new Date(`${contract.endDate}T23:59:59`) < monthStart
    ) continue;

    const customer = next.customers.find((item) => item.id === contract.customerId);
    const dueDate = paymentTaskDueDate(contract, period);
    const existing = next.tasks.find((task) =>
      task.relatedEntityType === "contract_payment" &&
      task.relatedEntityId === contract.id &&
      task.paymentPeriod === period
    );
    if (existing) {
      existing.dueDate = dueDate;
      existing.title = `Отправить QR · ${contract.contractNumber}`;
      existing.priority = new Date(dueDate) <= now ? "high" : "medium";
      const detectedStatus = paymentTaskStatus(next, contract.id, period, now);
      if (detectedStatus !== "open") existing.status = detectedStatus;
      continue;
    }
    next.tasks.push({
      id: Math.max(0, ...next.tasks.map((task) => task.id)) + 1,
      title: `Отправить QR · ${contract.contractNumber}`,
      description: `Ежемесячная оплата ${money(contract.monthlyRate)}${customer?.email ? ` · ${customer.email}` : " · email не указан"}`,
      dueDate,
      priority: new Date(dueDate) <= now ? "high" : "medium",
      status: paymentTaskStatus(next, contract.id, period, now),
      relatedEntityType: "contract_payment",
      relatedEntityId: contract.id,
      paymentPeriod: period
    });
  }
  return next;
}
