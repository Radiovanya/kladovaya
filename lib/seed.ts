import type { AppData } from "./types";

export const seedData: AppData = {
  paymentSettings: {
    bankName: "Т-Банк",
    recipientName: "",
    taxId: "",
    kpp: "",
    accountNumber: "",
    bic: "",
    correspondentAccount: "",
    receiptEmail: ""
  },
  landlordSettings: {
    individual: {
      fullName: "", passport: "", registrationAddress: "", phone: "", email: "", taxId: ""
    },
    entrepreneur: {
      fullName: "ИП Маньковский Алексей Александрович", passport: "", registrationAddress: "",
      phone: "+79033314445", email: "payments@klad-v.ru", taxId: "632139808096"
    }
  },
  paymentRequests: [],
  locations: [
    { id: 1, name: "Северная, 12", address: "Санкт-Петербург, ул. Северная, 12", description: "Основной складской комплекс", isActive: true },
    { id: 2, name: "Промышленная, 7", address: "Санкт-Петербург, ул. Промышленная, 7", description: "Боксы и кладовки", isActive: true },
    { id: 3, name: "Гаражный комплекс", address: "Санкт-Петербург, Гаражный проезд, 3", description: "Гаражи", isActive: true }
  ],
  units: [
    { id: 1, locationId: 1, unitNumber: "A-014", unitType: "storage", areaSqm: 4.2, monthlyRate: 6500, depositAmount: 6500, status: "occupied", note: "" },
    { id: 2, locationId: 1, unitNumber: "A-015", unitType: "storage", areaSqm: 3.8, monthlyRate: 5900, depositAmount: 5900, status: "free", note: "" },
    { id: 3, locationId: 2, unitNumber: "B-021", unitType: "box", areaSqm: 12, monthlyRate: 14000, depositAmount: 14000, status: "occupied", note: "" },
    { id: 4, locationId: 3, unitNumber: "G-008", unitType: "garage", areaSqm: 19.5, monthlyRate: 18500, depositAmount: 18500, status: "maintenance", note: "Ремонт ворот" },
    { id: 5, locationId: 2, unitNumber: "B-022", unitType: "box", areaSqm: 10.4, monthlyRate: 12500, depositAmount: 12500, status: "free", note: "" },
    { id: 6, locationId: 1, unitNumber: "A-009", unitType: "storage", areaSqm: 4.5, monthlyRate: 6500, depositAmount: 6500, status: "occupied", note: "" }
  ],
  customers: [
    { id: 1, customerType: "individual", fullName: "Алексей Смирнов", phone: "+7 921 555-14-20", email: "a.smirnov@mail.ru", passportOrRegistrationData: "Паспорт 4018 123456", taxId: "", address: "Санкт-Петербург", note: "" },
    { id: 2, customerType: "business", fullName: "ООО «Маяк»", phone: "+7 812 445-08-11", email: "office@mayak.ru", passportOrRegistrationData: "ОГРН 1157847000000", taxId: "7812345678", address: "Санкт-Петербург", note: "" },
    { id: 3, customerType: "individual", fullName: "Мария Волкова", phone: "+7 911 204-73-30", email: "m.volkova@mail.ru", passportOrRegistrationData: "Паспорт 4019 654321", taxId: "", address: "Санкт-Петербург", note: "Предложить продление" },
    { id: 4, customerType: "individual", fullName: "Игорь Петров", phone: "+7 921 470-19-88", email: "i.petrov@mail.ru", passportOrRegistrationData: "", taxId: "", address: "Санкт-Петербург", note: "" }
  ],
  contracts: [
    { id: 1, customerId: 1, unitId: 1, contractNumber: "Д-2026-014", startDate: "2026-06-01", endDate: "2027-05-31", monthlyRate: 6500, depositAmount: 6500, billingDay: 5, status: "active", terminationReason: "", note: "" },
    { id: 2, customerId: 2, unitId: 3, contractNumber: "Д-2026-011", startDate: "2026-04-15", endDate: "2027-04-14", monthlyRate: 14000, depositAmount: 14000, billingDay: 15, status: "active", terminationReason: "", note: "" },
    { id: 3, customerId: 3, unitId: 6, contractNumber: "Д-2025-128", startDate: "2025-08-01", endDate: "2026-07-31", monthlyRate: 6500, depositAmount: 6500, billingDay: 5, status: "active", terminationReason: "", note: "" },
    { id: 4, customerId: 4, unitId: 4, contractNumber: "Д-2025-099", startDate: "2025-03-01", endDate: "2026-02-28", monthlyRate: 17000, depositAmount: 17000, billingDay: 1, status: "expired", terminationReason: "", note: "" }
  ],
  charges: [
    { id: 1, contractId: 1, periodStart: "2026-07-01", periodEnd: "2026-07-31", dueDate: "2026-07-05", amount: 6500, chargeType: "rent", status: "paid", note: "" },
    { id: 2, contractId: 2, periodStart: "2026-07-01", periodEnd: "2026-07-31", dueDate: "2026-07-15", amount: 14000, chargeType: "rent", status: "overdue", note: "" },
    { id: 3, contractId: 3, periodStart: "2026-07-01", periodEnd: "2026-07-31", dueDate: "2026-07-05", amount: 6500, chargeType: "rent", status: "overdue", note: "" },
    { id: 4, contractId: 1, periodStart: "2026-08-01", periodEnd: "2026-08-31", dueDate: "2026-08-05", amount: 6500, chargeType: "rent", status: "pending", note: "" }
  ],
  payments: [
    { id: 1, customerId: 1, contractId: 1, chargeId: 1, paymentDate: "2026-07-18", amount: 6500, paymentMethod: "sbp", referenceNumber: "СБП-1841", comment: "" },
    { id: 2, customerId: 2, contractId: 2, chargeId: null, paymentDate: "2026-06-16", amount: 14000, paymentMethod: "bank_transfer", referenceNumber: "ПП-418", comment: "Аванс без привязки" },
    { id: 3, customerId: 3, contractId: 3, chargeId: null, paymentDate: "2026-06-05", amount: 6500, paymentMethod: "cash", referenceNumber: "ПКО-94", comment: "" }
  ],
  tasks: [
    { id: 1, title: "Связаться с Марией Волковой по продлению", description: "", dueDate: "2026-07-19T12:00", priority: "high", status: "open", relatedEntityType: "customer", relatedEntityId: 3 },
    { id: 2, title: "Проверить оплату ООО «Маяк»", description: "", dueDate: "2026-07-17T10:00", priority: "high", status: "open", relatedEntityType: "customer", relatedEntityId: 2 },
    { id: 3, title: "Осмотр бокса G-008 после ремонта", description: "", dueDate: "2026-07-19T16:30", priority: "medium", status: "open", relatedEntityType: "unit", relatedEntityId: 4 }
  ],
  documents: [
    { id: 1, entityType: "customer", entityId: 1, fileName: "passport-smirnov.pdf", fileUrl: "#", documentType: "other" },
    { id: 2, entityType: "contract", entityId: 1, fileName: "contract-d-2026-014.pdf", fileUrl: "#", documentType: "contract_scan" }
  ],
  users: [
    { id: 1, name: "Анна Крылова", email: "admin@kladovaya.local", role: "Admin", isActive: true },
    { id: 2, name: "Дмитрий Орлов", email: "manager@kladovaya.local", role: "Manager", isActive: true },
    { id: 3, name: "Елена Романова", email: "accountant@kladovaya.local", role: "Accountant", isActive: true }
  ]
};
