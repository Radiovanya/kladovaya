import type { AppData, ChargeStatus, Contract, PaymentSettings, TaskStatus, UnitStatus } from "./types";

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

export function unitStatus(unitId: number, data: Pick<AppData, "units" | "contracts">): UnitStatus {
  const unit = data.units.find((item) => item.id === unitId);
  if (!unit) throw new Error("Юнит не найден");
  if (data.contracts.some((contract) => contract.unitId === unitId && contract.status === "active")) return "occupied";
  return unit.status === "occupied" ? "free" : unit.status;
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

const cleanQrValue = (value: string) => value.replace(/[|]/g, " ").trim();

export function paymentPeriodLabel(period: string) {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) throw new Error("Некорректный месяц оплаты");
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

export function paymentPurpose(contractNumber: string, period: string) {
  return `Оплата аренды по договору ${cleanQrValue(contractNumber)} за ${paymentPeriodLabel(period)}, без НДС`;
}

export function hasCompletePaymentSettings(settings: PaymentSettings) {
  return Boolean(
    settings.recipientName.trim() &&
    /^(?:\d{10}|\d{12})$/.test(settings.taxId.trim()) &&
    /^\d{20}$/.test(settings.accountNumber.trim()) &&
    /^\d{9}$/.test(settings.bic.trim()) &&
    /^\d{20}$/.test(settings.correspondentAccount.trim())
  );
}

export function buildPaymentQrPayload(settings: PaymentSettings, amount: number, purpose: string) {
  if (!hasCompletePaymentSettings(settings)) throw new Error("Заполните платёжные реквизиты");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Сумма должна быть больше нуля");
  const fields = [
    "ST00012",
    `Name=${cleanQrValue(settings.recipientName)}`,
    `PersonalAcc=${cleanQrValue(settings.accountNumber)}`,
    `BankName=${cleanQrValue(settings.bankName)}`,
    `BIC=${cleanQrValue(settings.bic)}`,
    `CorrespAcc=${cleanQrValue(settings.correspondentAccount)}`,
    `PayeeINN=${cleanQrValue(settings.taxId)}`,
    settings.kpp.trim() ? `KPP=${cleanQrValue(settings.kpp)}` : "",
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
  const next = structuredClone(data);
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
