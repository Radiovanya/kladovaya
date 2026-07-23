export type UnitStatus = "free" | "reserved" | "occupied" | "maintenance" | "archived";
export type ContractStatus = "draft" | "active" | "expired" | "terminated";
export type ChargeStatus = "pending" | "paid" | "partial" | "overdue" | "cancelled";
export type TaskStatus = "open" | "in_progress" | "sent" | "paid" | "done";
export type Role = "Admin" | "Manager" | "Accountant";
export type LandlordType = "individual" | "entrepreneur";

export interface Location {
  id: number; name: string; address: string; description: string; isActive: boolean;
}
export interface Unit {
  id: number; locationId: number; unitNumber: string; unitType: "storage" | "garage" | "box";
  areaSqm: number; monthlyRate: number; depositAmount: number; status: UnitStatus; note: string;
  photoUrl?: string;
}
export interface Customer {
  id: number; customerType: "individual" | "business"; fullName: string; phone: string;
  email: string; passportOrRegistrationData: string; taxId: string; address: string; note: string;
}
export interface Contract {
  id: number; customerId: number; unitId: number; contractNumber: string; startDate: string;
  endDate: string; monthlyRate: number; depositAmount: number; billingDay: number;
  status: ContractStatus; terminationReason: string; note: string;
}
export interface Charge {
  id: number; contractId: number; periodStart: string; periodEnd: string; dueDate: string;
  amount: number; chargeType: "rent" | "deposit" | "penalty" | "other"; status: ChargeStatus; note: string;
}
export interface Payment {
  id: number; customerId: number; contractId: number; chargeId: number | null; paymentDate: string;
  amount: number; paymentMethod: "cash" | "bank_transfer" | "sbp" | "card" | "other";
  referenceNumber: string; comment: string;
}
export interface Task {
  id: number; title: string; description: string; dueDate: string; priority: "low" | "medium" | "high";
  status: TaskStatus; relatedEntityType: string | null; relatedEntityId: number | null;
  paymentPeriod?: string;
}
export interface DocumentItem {
  id: number; entityType: "customer" | "contract" | "payment"; entityId: number; fileName: string;
  fileUrl: string; documentType: "contract_scan" | "receipt" | "invoice" | "other";
  mimeType?: string; fileSize?: number; uploadedAt?: string;
}
export interface User {
  id: number; name: string; email: string; role: Role; isActive: boolean;
}
export interface PaymentSettings {
  bankName: string; recipientName: string; taxId: string; kpp: string; accountNumber: string;
  bic: string; correspondentAccount: string; receiptEmail: string;
}
export interface LandlordProfile {
  fullName: string; passport: string; registrationAddress: string; phone: string; email: string; taxId: string;
}
export interface LandlordSettings {
  individual: LandlordProfile;
  entrepreneur: LandlordProfile;
}
export interface PaymentRequest {
  id: number; contractId: number; period: string; amount: number; purpose: string;
  recipientEmail: string; status: "prepared" | "sent" | "paid" | "expired"; createdAt: string;
}
export interface AppData {
  locations: Location[]; units: Unit[]; customers: Customer[]; contracts: Contract[];
  charges: Charge[]; payments: Payment[]; tasks: Task[]; documents: DocumentItem[]; users: User[];
  archivedIds?: Record<string, number[]>;
  paymentSettings?: PaymentSettings;
  landlordSettings?: LandlordSettings;
  paymentRequests?: PaymentRequest[];
}
