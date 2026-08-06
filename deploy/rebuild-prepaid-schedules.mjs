import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("/opt/kladovaya/app/node_modules/@prisma/client");
const prisma = new PrismaClient();

const parseDate = (value) => new Date(`${value}T12:00:00Z`);
const isoDate = (value) => value.toISOString().slice(0, 10);
const addDays = (value, days) => new Date(value.getTime() + days * 86_400_000);
const addMonthsClamped = (date, months) => {
  const targetMonth = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), targetMonth + 1, 0, 12)).getUTCDate();
  return new Date(Date.UTC(date.getUTCFullYear(), targetMonth, Math.min(date.getUTCDate(), lastDay), 12));
};
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart <= bEnd && bStart <= aEnd;

const state = await prisma.appState.findUnique({ where: { id: 1 } });
if (!state) throw new Error("AppState not found");
const data = structuredClone(state.payload);
const originalChargeCount = data.charges.length;
const paymentsByCharge = new Set(data.payments.filter((item) => item.chargeId != null).map((item) => item.chargeId));
const preserved = data.charges.filter((charge) => !String(charge.note ?? "").startsWith("Автоматический график") || paymentsByCharge.has(charge.id));
const preservedChargeCount = preserved.length;
let nextId = Math.max(0, ...data.charges.map((item) => item.id)) + 1;
const generatedIds = new Set();
data.charges = preserved;

for (const contract of data.contracts) {
  if (!contract.paymentIntervalMonths || contract.status === "draft") continue;
  const interval = contract.paymentIntervalMonths;
  const contractStart = parseDate(contract.startDate);
  const contractEnd = parseDate(contract.endDate);
  const firstPayment = parseDate(contract.firstPaymentDate || contract.startDate);
  let periodStart = firstPayment > contractStart ? firstPayment : contractStart;
  let dueDate = firstPayment;
  const dueOffsetDays = Math.round((periodStart.getTime() - dueDate.getTime()) / 86_400_000);
  let guard = 0;

  while (periodStart <= contractEnd) {
    if (++guard > 600) throw new Error(`Schedule loop overflow: ${contract.contractNumber}`);
    const nextStart = addMonthsClamped(periodStart, interval);
    const periodEnd = new Date(Math.min(contractEnd.getTime(), nextStart.getTime() - 86_400_000));
    const startValue = isoDate(periodStart);
    const endValue = isoDate(periodEnd);
    const overlapping = data.charges.filter((charge) => charge.contractId === contract.id && charge.chargeType === "rent" && charge.status !== "cancelled" && overlaps(startValue, endValue, charge.periodStart, charge.periodEnd));
    if (!overlapping.length) {
      const id = nextId++;
      generatedIds.add(id);
      data.charges.push({ id, contractId: contract.id, periodStart: startValue, periodEnd: endValue, dueDate: isoDate(dueDate), amount: contract.monthlyRate * interval, chargeType: "rent", status: "pending", note: `Автоматический график · период ${interval} мес.` });
    } else {
      const coveredUntil = overlapping.map((item) => item.periodEnd).sort().at(-1);
      const uncoveredStart = addDays(parseDate(coveredUntil), 1);
      if (uncoveredStart > periodStart && uncoveredStart < nextStart) {
        periodStart = uncoveredStart;
        dueDate = addDays(uncoveredStart, -dueOffsetDays);
        continue;
      }
    }
    periodStart = nextStart;
    dueDate = addMonthsClamped(dueDate, interval);
  }
}

const invalid = data.charges.filter((charge) => generatedIds.has(charge.id) && charge.dueDate > charge.periodStart);
if (invalid.length) throw new Error(`Postpaid automatic charges detected: ${invalid.map((item) => item.id).join(",")}`);

await prisma.appState.update({ where: { id: 1 }, data: { payload: data, version: { increment: 1 } } });
console.log(JSON.stringify({ ok: true, removed: originalChargeCount - preservedChargeCount, generated: generatedIds.size, total: data.charges.length }));
await prisma.$disconnect();
