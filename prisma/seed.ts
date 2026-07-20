import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.payment.deleteMany();
  await prisma.charge.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.task.deleteMany();
  await prisma.user.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.location.deleteMany();

  const north = await prisma.location.create({ data: { name: "Северная, 12", address: "Санкт-Петербург, ул. Северная, 12", description: "Основной комплекс" } });
  const industrial = await prisma.location.create({ data: { name: "Промышленная, 7", address: "Санкт-Петербург, ул. Промышленная, 7", description: "Кладовки и боксы" } });
  const customer = await prisma.customer.create({ data: { customerType: "INDIVIDUAL", fullName: "Алексей Смирнов", phone: "+7 921 555-14-20", email: "a.smirnov@mail.ru", passportOrRegistrationData: "Паспорт 4018 123456", taxId: "", address: "Санкт-Петербург" } });
  const unit = await prisma.unit.create({ data: { locationId: north.id, unitNumber: "A-014", unitType: "STORAGE", areaSqm: 4.2, monthlyRate: 6500, depositAmount: 6500, status: "OCCUPIED" } });
  await prisma.unit.create({ data: { locationId: industrial.id, unitNumber: "B-022", unitType: "BOX", areaSqm: 10.4, monthlyRate: 12500, depositAmount: 12500, status: "FREE" } });
  const contract = await prisma.contract.create({ data: { customerId: customer.id, unitId: unit.id, contractNumber: "Д-2026-014", startDate: new Date("2026-06-01"), endDate: new Date("2027-05-31"), monthlyRate: 6500, depositAmount: 6500, billingDay: 5, status: "ACTIVE" } });
  const charge = await prisma.charge.create({ data: { contractId: contract.id, periodStart: new Date("2026-07-01"), periodEnd: new Date("2026-07-31"), dueDate: new Date("2026-07-05"), amount: 6500, chargeType: "RENT", status: "PAID" } });
  await prisma.payment.create({ data: { customerId: customer.id, contractId: contract.id, chargeId: charge.id, paymentDate: new Date("2026-07-18"), amount: 6500, paymentMethod: "SBP", referenceNumber: "СБП-1841" } });
  await prisma.user.createMany({ data: [
    { name: "Анна Крылова", email: "admin@kladovaya.local", passwordHash: "replace-in-production", role: "ADMIN" },
    { name: "Дмитрий Орлов", email: "manager@kladovaya.local", passwordHash: "replace-in-production", role: "MANAGER" },
    { name: "Елена Романова", email: "accountant@kladovaya.local", passwordHash: "replace-in-production", role: "ACCOUNTANT" }
  ] });
}

main().finally(() => prisma.$disconnect());
