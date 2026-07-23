"use client";

import {
  Archive, Banknote, Boxes, Building2, CheckSquare, ChevronRight, CircleDollarSign,
  Copy, CreditCard, Download, ExternalLink, Eye, EyeOff, FileDown, FileText, Image as ImageIcon, LayoutDashboard, LogOut, Mail, MapPin,
  Menu, Pencil, Plus, Printer, QrCode, Save, Search, Settings, Trash2, Upload, UserRound, Users, Warehouse, X
} from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { buildPaymentQrPayload, calculateChargeStatus, chargePaidAmount, dashboardMetrics, effectiveChargeStatus, hasCompletePaymentSettings, money, normalizeObjectPhotoUrl, paymentPeriodLabel, paymentPurpose, paymentSettingsErrors, paymentTaskDueDate, syncMonthlyPaymentTasks, unitStatus, validateActiveContract } from "@/lib/business";
import { contractFileName, generateRentalContract, nextContractNumber } from "@/lib/contract-document";
import { customerContractScans, eligibleContractsForScan, MAX_SIGNED_CONTRACTS_PER_CUSTOMER, validateSignedContractUpload } from "@/lib/contract-scans";
import { deleteSignedContractFile, getSignedContractFile, storeSignedContractFile } from "@/lib/document-storage";
import { useAppStore } from "@/lib/store";
import type { AppData, Contract, LandlordSettings, LandlordType, PaymentSettings, Role, TaskStatus, UnitStatus } from "@/lib/types";

type Page = "dashboard" | "locations" | "units" | "customers" | "contracts" | "charges" | "payments" | "tasks" | "payment-settings" | "users";
type EntityType = Page | "documents";
type Modal = null | { type: EntityType; id?: number };

const menu: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Обзор", icon: LayoutDashboard },
  { id: "locations", label: "Адреса", icon: MapPin },
  { id: "units", label: "Объекты", icon: Boxes },
  { id: "customers", label: "Клиенты", icon: Users },
  { id: "contracts", label: "Договоры", icon: FileText },
  { id: "charges", label: "Начисления", icon: CircleDollarSign },
  { id: "payments", label: "Оплаты", icon: Banknote },
  { id: "tasks", label: "Задачи", icon: CheckSquare },
  { id: "payment-settings", label: "Реквизиты", icon: CreditCard },
  { id: "users", label: "Пользователи", icon: Settings }
];

const titles: Record<Page, [string, string]> = {
  dashboard: ["Обзор", "Операционная картина на сегодня"],
  locations: ["Адреса", "Адреса и складские площадки"],
  units: ["Объекты", "Кладовки, гаражи и боксы"],
  customers: ["Клиенты", "Контактные данные арендаторов"],
  contracts: ["Договоры", "Условия и сроки аренды"],
  charges: ["Начисления", "Обязательства по договорам"],
  payments: ["Оплаты", "Зарегистрированные поступления"],
  tasks: ["Задачи", "Напоминания сотрудникам"],
  "payment-settings": ["Платёжные реквизиты", "Настройки банковского QR и почты для чеков"],
  users: ["Пользователи", "Доступ сотрудников к системе"]
};

const statusText: Record<string, string> = {
  free: "Свободна", reserved: "Зарезервирована", occupied: "Занята", maintenance: "В ремонте", archived: "Архив",
  draft: "Черновик", active: "Активен", expired: "Истёк", terminated: "Расторгнут",
  pending: "Ожидает", paid: "Оплачено", partial: "Частично", overdue: "Просрочено", cancelled: "Отменено",
  open: "Открыта", in_progress: "В работе", sent: "Отправлен", done: "Готово"
};
const date = (value: string) => new Intl.DateTimeFormat("ru-RU").format(new Date(value.includes("T") ? value : `${value}T00:00:00`));
const isoToday = () => new Date().toISOString().slice(0, 10);
const badge = (status: string) => <span className={`badge badge-${status}`}>{statusText[status] ?? status}</span>;
const nextId = <T extends { id: number }>(rows: T[]) => Math.max(0, ...rows.map((row) => row.id)) + 1;

export default function Home() {
  const { data, setData, reset, reload, ready, saveError, isDemo } = useAppStore();
  const [role, setRole] = useState<Role | null>(null);
  const [sessionName, setSessionName] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [page, setPage] = useState<Page>("dashboard");
  const [modal, setModal] = useState<Modal>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<number | null>(null);
  const [customerTab, setCustomerTab] = useState("contracts");
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [registryMode, setRegistryMode] = useState<"active" | "archived" | "all">("active");
  const [sidebar, setSidebar] = useState(false);
  const [toast, setToast] = useState("");
  const [qrContractId, setQrContractId] = useState<number | null>(null);
  const [documentContractId, setDocumentContractId] = useState<number | null>(null);
  const [selectedPaymentId, setSelectedPaymentId] = useState<number | null>(null);
  const [scanViewerCustomerId, setScanViewerCustomerId] = useState<number | null>(null);
  const [scanUploadCustomerId, setScanUploadCustomerId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      if (isDemo()) { if (!cancelled) setCheckingSession(false); return; }
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      if (response.ok) {
        const payload = await response.json() as { user: { role: Role; name: string } };
        await reload();
        if (!cancelled) { setRole(payload.user.role); setSessionName(payload.user.name); }
      }
      if (!cancelled) setCheckingSession(false);
    }
    restoreSession().catch(() => !cancelled && setCheckingSession(false));
    return () => { cancelled = true; };
    // Session bootstrap is intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function acceptLogin(user: { role: Role; name: string }) {
    if (!isDemo()) await reload();
    setSessionName(user.name);
    setRole(user.role);
  }

  async function logout() {
    if (!isDemo()) await fetch("/api/auth/logout", { method: "POST" });
    setRole(null);
    setSessionName("");
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }
  function navigate(next: Page) {
    setPage(next); setSelectedCustomer(null); setSearch(""); setRegistryMode("active"); setSidebar(false);
  }
  function update(next: AppData, message: string) {
    setData(syncMonthlyPaymentTasks(next, new Date())); setModal(null); notify(message);
  }
  function archiveEntity(type: Page, id: number) {
    if (type === "units" && data.contracts.some((contract) => contract.unitId === id && contract.status === "active")) {
      notify("Нельзя архивировать объект с активным договором"); return;
    }
    const next = structuredClone(data);
    const archived = new Set(next.archivedIds?.[type] ?? []);
    const restore = archived.has(id);
    if (restore) archived.delete(id); else archived.add(id);
    next.archivedIds = { ...(next.archivedIds ?? {}), [type]: [...archived] };
    setData(next); notify(restore ? "Запись восстановлена из архива" : "Запись скрыта в архив");
  }
  function deleteEntity(type: Page, id: number) {
    const dependency =
      type === "locations" && data.units.some((item) => item.locationId === id) ? "Сначала удалите связанные объекты" :
      type === "units" && data.contracts.some((item) => item.unitId === id) ? "Сначала удалите связанные договоры" :
      type === "customers" && data.contracts.some((item) => item.customerId === id) ? "Сначала удалите связанные договоры" :
      type === "contracts" && (data.charges.some((item) => item.contractId === id) || data.payments.some((item) => item.contractId === id)) ? "Сначала удалите начисления и оплаты договора" :
      type === "charges" && data.payments.some((item) => item.chargeId === id) ? "Сначала удалите связанные оплаты" : "";
    if (dependency) { notify(dependency); return; }
    if (!window.confirm("Удалить запись без возможности восстановления?")) return;
    const next = structuredClone(data);
    if (type === "locations") next.locations = next.locations.filter((item) => item.id !== id);
    if (type === "units") next.units = next.units.filter((item) => item.id !== id);
    if (type === "customers") next.customers = next.customers.filter((item) => item.id !== id);
    if (type === "contracts") next.contracts = next.contracts.filter((item) => item.id !== id);
    if (type === "charges") next.charges = next.charges.filter((item) => item.id !== id);
    if (type === "payments") next.payments = next.payments.filter((item) => item.id !== id);
    if (type === "tasks") next.tasks = next.tasks.filter((item) => item.id !== id);
    if (type === "users") next.users = next.users.filter((item) => item.id !== id);
    if (next.archivedIds?.[type]) next.archivedIds[type] = next.archivedIds[type].filter((item) => item !== id);
    setData(next); notify("Запись удалена");
  }
  function updateTaskStatus(id: number, status: TaskStatus) {
    const next = structuredClone(data);
    const task = next.tasks.find((item) => item.id === id);
    if (!task) return;
    task.status = status;
    if (task.relatedEntityType === "contract_payment" && task.relatedEntityId && task.paymentPeriod && (status === "sent" || status === "paid")) {
      const request = [...(next.paymentRequests ?? [])].reverse().find((item) =>
        item.contractId === task.relatedEntityId && item.period === task.paymentPeriod
      );
      if (request) request.status = status;
    }
    setData(next);
    notify(`Статус: ${statusText[status]}`);
  }
  async function copyObjectPhoto(id: number) {
    const unit = data.units.find((item) => item.id === id);
    if (!unit?.photoUrl) { notify("У объекта нет ссылки на фото"); return; }
    try {
      await navigator.clipboard.writeText(unit.photoUrl);
      notify("Ссылка на фото скопирована");
    } catch {
      notify("Не удалось скопировать ссылку");
    }
  }

  if (checkingSession || (role && !ready)) return <div className="login-page"><section className="login-card"><h1>Кладовая</h1><p>Загружаем систему…</p></section></div>;
  if (!role) return <Login onLogin={acceptLogin} />;

  const visibleMenu = menu.filter((item) => !["users", "payment-settings"].includes(item.id) || role === "Admin");
  const customer = selectedCustomer ? data.customers.find((item) => item.id === selectedCustomer) : null;

  return (
    <div className="app-shell">
      <aside className={sidebar ? "sidebar sidebar-open" : "sidebar"}>
        <div className="brand"><span className="brand-mark"><Warehouse size={18} /></span><span><strong>Кладовая</strong><small>Управление арендой</small></span></div>
        <nav>
          {visibleMenu.map(({ id, label, icon: Icon }) => (
            <button className={page === id ? "nav-link active" : "nav-link"} onClick={() => navigate(id)} key={id}>
              <Icon size={18} />{label}
            </button>
          ))}
        </nav>
        <div className="profile">
          <span className="avatar">{role.slice(0, 1)}</span>
          <span><strong>{sessionName || (role === "Admin" ? "Анна Крылова" : role === "Manager" ? "Дмитрий Орлов" : "Елена Романова")}</strong><small>{role}</small></span>
          <button title="Выйти" onClick={logout}><LogOut size={17} /></button>
        </div>
      </aside>
      {sidebar && <button className="mobile-scrim" onClick={() => setSidebar(false)} aria-label="Закрыть меню" />}
      <main>
        <header className="topbar">
          <button className="menu-button" onClick={() => setSidebar(true)} aria-label="Открыть меню"><Menu /></button>
          <div><h1>{customer ? customer.fullName : titles[page][0]}</h1><p>{customer ? customer.phone : titles[page][1]}</p></div>
          <div className="top-actions">
            {page !== "dashboard" && page !== "payment-settings" && !customer && <button className="button primary" onClick={() => setModal({ type: page })}><Plus size={17} />Добавить</button>}
          </div>
        </header>

        {customer ? (
          <CustomerDetails data={data} customerId={customer.id} tab={customerTab} setTab={setCustomerTab} onBack={() => setSelectedCustomer(null)} onAdd={(type) => setModal({ type })} onQr={setQrContractId} onContractDocument={setDocumentContractId} onPayment={setSelectedPaymentId} onViewScans={setScanViewerCustomerId} onUploadScan={setScanUploadCustomerId} />
        ) : page === "dashboard" ? (
          <Dashboard data={data} locationFilter={locationFilter} setLocationFilter={setLocationFilter} onNavigate={navigate} onCustomer={setSelectedCustomer} />
        ) : page === "payment-settings" ? (
          <PaymentSettingsPage data={data} onSave={update} />
        ) : (
          <Registry page={page} data={data} search={search} setSearch={setSearch} mode={registryMode} setMode={setRegistryMode}
            onCustomer={setSelectedCustomer} onEdit={(id) => setModal({ type: page, id })}
            onArchive={(id) => archiveEntity(page, id)} onDelete={(id) => deleteEntity(page, id)}
            onTaskStatus={updateTaskStatus} onContractDocument={setDocumentContractId} onPayment={setSelectedPaymentId} onCopyPhoto={copyObjectPhoto} />
        )}
      </main>
      {modal && <EntityModal modal={modal} data={data} onClose={() => setModal(null)} onSave={update} />}
      {qrContractId && <PaymentQrModal contractId={qrContractId} data={data} onClose={() => setQrContractId(null)} onSave={update} onOpenSettings={() => { setQrContractId(null); navigate("payment-settings"); }} />}
      {documentContractId && <ContractDocumentModal contractId={documentContractId} data={data} onClose={() => setDocumentContractId(null)} />}
      {selectedPaymentId && <PaymentDetailsModal paymentId={selectedPaymentId} data={data} onClose={() => setSelectedPaymentId(null)} />}
      {scanViewerCustomerId && <SignedContractsModal customerId={scanViewerCustomerId} data={data} onClose={() => setScanViewerCustomerId(null)} onSave={update} />}
      {scanUploadCustomerId && <SignedContractUploadModal customerId={scanUploadCustomerId} data={data} onClose={() => setScanUploadCustomerId(null)} onSave={update} />}
      {toast && <div className="toast">{toast}</div>}
      {saveError && <div className="toast save-error">{saveError}</div>}
      {isDemo() && <button className="demo-reset" onClick={() => { reset(); notify("Демо-данные восстановлены"); }}><Archive size={15} />Сбросить демо</button>}
    </div>
  );
}

function Login({ onLogin }: { onLogin: (user: { role: Role; name: string }) => Promise<void> | void }) {
  const [role, setRole] = useState<Role>("Admin");
  const [demoMode, setDemoMode] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => setDemoMode(window.location.hostname.endsWith("github.io")), []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSubmitting(true);
    const form = new FormData(event.currentTarget);
    if (demoMode) {
      await onLogin({ role, name: role === "Admin" ? "Анна Крылова" : role === "Manager" ? "Дмитрий Орлов" : "Елена Романова" });
      return;
    }
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
    });
    const payload = await response.json().catch(() => ({})) as { user?: { role: Role; name: string }; error?: string };
    if (!response.ok || !payload.user) { setError(payload.error ?? "Не удалось войти"); setSubmitting(false); return; }
    await onLogin(payload.user);
  }
  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <span className="login-logo"><Warehouse size={25} /></span>
        <h1>Кладовая</h1><p>Внутренняя система управления арендой</p>
        <label>Email<input name="email" defaultValue="admin@kladovaya.local" type="email" autoComplete="username" required /></label>
        <label>Пароль<input name="password" type="password" autoComplete="current-password" required /></label>
        {demoMode && <label>Демо-роль<select value={role} onChange={(event) => setRole(event.target.value as Role)}><option>Admin</option><option>Manager</option><option>Accountant</option></select></label>}
        {error && <div className="form-error">{error}</div>}
        <button className="button primary login-submit" disabled={submitting}>{submitting ? "Входим…" : "Войти"}</button>
        <small>{demoMode ? "Демо-режим: данные сохраняются в этом браузере" : "Защищённый доступ для сотрудников"}</small>
      </form>
    </div>
  );
}

function Dashboard({ data, locationFilter, setLocationFilter, onNavigate, onCustomer }: {
  data: AppData; locationFilter: string; setLocationFilter: (value: string) => void;
  onNavigate: (page: Page) => void; onCustomer: (id: number) => void;
}) {
  const filtered = useMemo(() => {
    if (locationFilter === "all") return data;
    const locationId = Number(locationFilter);
    const unitIds = data.units.filter((unit) => unit.locationId === locationId).map((unit) => unit.id);
    const contracts = data.contracts.filter((contract) => unitIds.includes(contract.unitId));
    const contractIds = contracts.map((contract) => contract.id);
    return { ...data, units: data.units.filter((unit) => unit.locationId === locationId), contracts, charges: data.charges.filter((charge) => contractIds.includes(charge.contractId)), payments: data.payments.filter((payment) => contractIds.includes(payment.contractId)) };
  }, [data, locationFilter]);
  const metrics = dashboardMetrics(filtered, new Date("2026-07-19T12:00:00"));
  const recentPayments = [...filtered.payments].sort((a, b) => b.paymentDate.localeCompare(a.paymentDate)).slice(0, 4);
  const dueTasks = data.tasks.filter((task) => task.status !== "done").slice(0, 4);
  return (
    <>
      <div className="filter-row"><select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="all">Все адреса</option>{data.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></div>
      <section className="kpi-grid">
        <Kpi label="Всего объектов" value={String(metrics.totalUnits)} note={`${filtered.locations.length} адреса`} />
        <Kpi label="Свободно" value={String(metrics.freeUnits)} note={`${metrics.totalUnits ? Math.round(metrics.freeUnits / metrics.totalUnits * 100) : 0}% фонда`} />
        <Kpi label="Занято" value={String(metrics.occupiedUnits)} note={`${metrics.totalUnits ? Math.round(metrics.occupiedUnits / metrics.totalUnits * 100) : 0}% фонда`} />
        <Kpi label="Просрочено" value={money(metrics.overdueAmount)} note={`${metrics.overdueChargesCount} начисления`} tone="danger" />
      </section>
      <section className="dashboard-grid">
        <div className="panel span-2">
          <PanelHead title="Последние оплаты" action="Все оплаты" onClick={() => onNavigate("payments")} />
          <table><thead><tr><th>Дата</th><th>Клиент</th><th>Способ</th><th className="number">Сумма</th></tr></thead>
            <tbody>{recentPayments.map((payment) => {
              const customer = data.customers.find((item) => item.id === payment.customerId);
              return <tr key={payment.id} onClick={() => customer && onCustomer(customer.id)}><td>{date(payment.paymentDate)}</td><td><strong>{customer?.fullName}</strong></td><td>{methodName(payment.paymentMethod)}</td><td className="number"><strong>{money(payment.amount)}</strong></td></tr>;
            })}</tbody>
          </table>
        </div>
        <div className="panel">
          <PanelHead title="Задачи" action="Все задачи" onClick={() => onNavigate("tasks")} />
          <div className="task-list">{dueTasks.map((task) => <div className="task-item" key={task.id}><span className={`task-dot ${task.priority}`} /><span><strong>{task.title}</strong><small>{date(task.dueDate)} · {task.relatedEntityType === "contract_payment" && task.status === "open" ? "Ожидает отправки" : statusText[task.status]}</small></span>{badge(task.status)}</div>)}</div>
        </div>
        <div className="panel span-2">
          <PanelHead title="Договоры заканчиваются" action="Все договоры" onClick={() => onNavigate("contracts")} />
          <table><tbody>{data.contracts.filter((contract) => contract.status === "active" && contract.endDate <= "2026-08-18").map((contract) => {
            const customer = data.customers.find((item) => item.id === contract.customerId);
            return <tr key={contract.id} onClick={() => customer && onCustomer(customer.id)}><td><strong>{contract.contractNumber}</strong><small className="cell-sub">{customer?.fullName}</small></td><td>{date(contract.endDate)}</td><td>{badge("active")}</td></tr>;
          })}</tbody></table>
        </div>
        <div className="panel">
          <PanelHead title="Заполняемость" />
          <div className="occupancy-list">{data.locations.map((location) => {
            const units = data.units.filter((unit) => unit.locationId === location.id && unit.status !== "archived");
            const occupied = units.filter((unit) => unitStatus(unit.id, data) === "occupied").length;
            return <div key={location.id}><span><strong>{location.name}</strong><small>{occupied} / {units.length}</small></span><div className="progress"><i style={{ width: `${units.length ? occupied / units.length * 100 : 0}%` }} /></div></div>;
          })}</div>
        </div>
      </section>
    </>
  );
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note: string; tone?: string }) {
  return <div className={`kpi ${tone ?? ""}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}
function PanelHead({ title, action, onClick }: { title: string; action?: string; onClick?: () => void }) {
  return <div className="panel-head"><h2>{title}</h2>{action && <button onClick={onClick}>{action}<ChevronRight size={15} /></button>}</div>;
}

function Registry({ page, data, search, setSearch, mode, setMode, onCustomer, onEdit, onArchive, onDelete, onTaskStatus, onContractDocument, onPayment, onCopyPhoto }: {
  page: Page; data: AppData; search: string; setSearch: (value: string) => void;
  mode: "active" | "archived" | "all"; setMode: (value: "active" | "archived" | "all") => void;
  onCustomer: (id: number) => void; onEdit: (id: number) => void; onArchive: (id: number) => void; onDelete: (id: number) => void;
  onTaskStatus: (id: number, status: TaskStatus) => void;
  onContractDocument: (id: number) => void;
  onPayment: (id: number) => void;
  onCopyPhoto: (id: number) => void;
}) {
  const q = search.toLowerCase();
  const cell = (value: unknown) => String(value ?? "").toLowerCase().includes(q);
  let headers: string[] = [], rows: { id: number; cells: React.ReactNode[]; customerId?: number }[] = [];
  if (page === "locations") {
    headers = ["Название", "Адрес", "Объекты", "Свободно", "Статус"];
    rows = data.locations.filter((x) => cell(x.name) || cell(x.address)).map((x) => ({ id: x.id, cells: [<strong key="n">{x.name}</strong>, x.address, data.units.filter((u) => u.locationId === x.id).length, data.units.filter((u) => u.locationId === x.id && unitStatus(u.id, data) === "free").length, badge(x.isActive ? "active" : "archived")] }));
  } else if (page === "units") {
    headers = ["Номер", "Адрес", "Тип", "Площадь", "Ставка", "Статус"];
    rows = data.units.filter((x) => cell(x.unitNumber)).map((x) => ({ id: x.id, cells: [<strong key="n">{x.unitNumber}</strong>, data.locations.find((l) => l.id === x.locationId)?.name, unitTypeName(x.unitType), `${x.areaSqm} м²`, money(x.monthlyRate), badge(unitStatus(x.id, data))] }));
  } else if (page === "customers") {
    headers = ["ФИО", "Телефон", "Email", "Договор", "Задолженность"];
    rows = data.customers.filter((x) => cell(x.fullName) || cell(x.phone) || cell(x.email)).map((x) => {
      const contracts = data.contracts.filter((c) => c.customerId === x.id);
      const ids = contracts.map((c) => c.id);
      const debt = data.charges.filter((c) => ids.includes(c.contractId) && effectiveChargeStatus(c.id, data, new Date("2026-07-19")) === "overdue").reduce((sum, c) => sum + c.amount - chargePaidAmount(c.id, data), 0);
      return { id: x.id, customerId: x.id, cells: [<strong key="n">{x.fullName}</strong>, x.phone, x.email, contracts.find((c) => c.status === "active")?.contractNumber ?? "—", <strong className={debt ? "danger-text" : ""} key="d">{money(debt)}</strong>] };
    });
  } else if (page === "contracts") {
    headers = ["Договор", "Клиент", "Объект", "Период", "Ставка", "Статус"];
    rows = data.contracts.filter((x) => cell(x.contractNumber) || cell(data.customers.find((c) => c.id === x.customerId)?.fullName)).map((x) => ({ id: x.id, customerId: x.customerId, cells: [<strong key="n">{x.contractNumber}</strong>, data.customers.find((c) => c.id === x.customerId)?.fullName, data.units.find((u) => u.id === x.unitId)?.unitNumber, `${date(x.startDate)} — ${date(x.endDate)}`, money(x.monthlyRate), badge(x.status)] }));
  } else if (page === "charges") {
    headers = ["Договор", "Клиент", "Период", "Срок", "Сумма", "Оплачено", "Статус"];
    rows = data.charges.filter((x) => cell(data.contracts.find((c) => c.id === x.contractId)?.contractNumber)).map((x) => {
      const contract = data.contracts.find((c) => c.id === x.contractId)!;
      return { id: x.id, customerId: contract.customerId, cells: [<strong key="n">{contract.contractNumber}</strong>, data.customers.find((c) => c.id === contract.customerId)?.fullName, `${date(x.periodStart)} — ${date(x.periodEnd)}`, date(x.dueDate), money(x.amount), money(chargePaidAmount(x.id, data)), badge(effectiveChargeStatus(x.id, data, new Date("2026-07-19")))] };
    });
  } else if (page === "payments") {
    headers = ["Дата", "Клиент", "Договор", "Способ", "Номер", "Сумма"];
    rows = data.payments.filter((x) => cell(data.customers.find((c) => c.id === x.customerId)?.fullName)).map((x) => ({ id: x.id, customerId: x.customerId, cells: [date(x.paymentDate), <strong key="n">{data.customers.find((c) => c.id === x.customerId)?.fullName}</strong>, data.contracts.find((c) => c.id === x.contractId)?.contractNumber, methodName(x.paymentMethod), x.referenceNumber || "—", <strong key="m">{money(x.amount)}</strong>] }));
  } else if (page === "tasks") {
    headers = ["Задача", "Срок", "Приоритет", "Статус"];
    rows = data.tasks.filter((x) => cell(x.title)).map((x) => {
      const isPaymentTask = x.relatedEntityType === "contract_payment";
      return { id: x.id, cells: [
        <span className="task-title-cell" key="n"><strong>{x.title}</strong>{x.paymentPeriod && <small>{paymentPeriodLabel(x.paymentPeriod)}</small>}</span>,
        date(x.dueDate),
        <span className={`priority ${x.priority}`} key="p">{priorityName(x.priority)}</span>,
        <select className={`task-status-select status-${x.status}`} key="s" value={x.status}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onTaskStatus(x.id, event.target.value as TaskStatus)}>
          <option value="open">{isPaymentTask ? "Ожидает отправки" : "Открыта"}</option>
          <option value="in_progress">В работе</option>
          {isPaymentTask && <option value="sent">Отправлен</option>}
          {isPaymentTask && <option value="paid">Оплачен</option>}
          <option value="done">Готово</option>
        </select>
      ] };
    });
  } else if (page === "users") {
    headers = ["Сотрудник", "Email", "Роль", "Статус"];
    rows = data.users.filter((x) => cell(x.name) || cell(x.email)).map((x) => ({ id: x.id, cells: [<strong key="n">{x.name}</strong>, x.email, x.role, badge(x.isActive ? "active" : "archived")] }));
  }
  const archived = new Set(data.archivedIds?.[page] ?? []);
  rows = rows.filter((row) => mode === "all" || (mode === "archived" ? archived.has(row.id) : !archived.has(row.id)));
  headers.push("Действия");
  return (
    <section>
      <div className="registry-toolbar"><label className="search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск…" /></label><select value={mode} onChange={(event) => setMode(event.target.value as "active" | "archived" | "all")}><option value="all">Все записи</option><option value="active">Активные</option><option value="archived">Архивные</option></select></div>
      <div className="table-card"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>
        {rows.map((row) => <tr key={row.id} onClick={() => page === "payments" ? onPayment(row.id) : row.customerId ? onCustomer(row.customerId) : onEdit(row.id)}>
          {row.cells.map((value, index) => <td key={index}>{value}</td>)}
          <td><div className="row-actions">
            {page === "contracts" && <button title="Сформировать договор" aria-label="Сформировать договор" onClick={(event) => { event.stopPropagation(); onContractDocument(row.id); }}><FileDown size={15} /></button>}
            <button title="Редактировать" aria-label="Редактировать" onClick={(event) => { event.stopPropagation(); onEdit(row.id); }}><Pencil size={15} /></button>
            {page === "units" && <button className="photo-copy-action" disabled={!data.units.find((unit) => unit.id === row.id)?.photoUrl} title={data.units.find((unit) => unit.id === row.id)?.photoUrl ? "Копировать ссылку на фото" : "Ссылка на фото не указана"} aria-label="Копировать ссылку на фото" onClick={(event) => { event.stopPropagation(); onCopyPhoto(row.id); }}><ImageIcon size={15} /></button>}
            <button title={archived.has(row.id) ? "Вернуть из архива" : "Скрыть в архив"} aria-label={archived.has(row.id) ? "Вернуть из архива" : "Скрыть в архив"} onClick={(event) => { event.stopPropagation(); onArchive(row.id); }}>{archived.has(row.id) ? <Eye size={15} /> : <EyeOff size={15} />}</button>
            <button className="danger-action" title="Удалить" aria-label="Удалить" onClick={(event) => { event.stopPropagation(); onDelete(row.id); }}><X size={16} /></button>
          </div></td>
        </tr>)}
      </tbody></table>{!rows.length && <div className="empty">Ничего не найдено</div>}</div>
    </section>
  );
}

function CustomerDetails({ data, customerId, tab, setTab, onBack, onAdd, onQr, onContractDocument, onPayment, onViewScans, onUploadScan }: {
  data: AppData; customerId: number; tab: string; setTab: (tab: string) => void; onBack: () => void;
  onAdd: (page: EntityType) => void; onQr: (contractId: number) => void; onContractDocument: (contractId: number) => void;
  onPayment: (paymentId: number) => void;
  onViewScans: (customerId: number) => void; onUploadScan: (customerId: number) => void;
}) {
  const customer = data.customers.find((item) => item.id === customerId)!;
  const contracts = data.contracts.filter((item) => item.customerId === customerId);
  const contractIds = contracts.map((item) => item.id);
  const active = contracts.find((item) => item.status === "active");
  const charges = data.charges.filter((item) => contractIds.includes(item.contractId));
  const payments = data.payments.filter((item) => item.customerId === customerId);
  const documents = data.documents.filter((item) => item.entityType === "customer" && item.entityId === customerId || item.entityType === "contract" && contractIds.includes(item.entityId));
  const tasks = data.tasks.filter((item) =>
    item.relatedEntityType === "customer" && item.relatedEntityId === customerId ||
    item.relatedEntityType === "contract_payment" && item.relatedEntityId !== null && contractIds.includes(item.relatedEntityId)
  );
  const debt = charges.filter((charge) => effectiveChargeStatus(charge.id, data, new Date("2026-07-19")) === "overdue").reduce((sum, charge) => sum + charge.amount - chargePaidAmount(charge.id, data), 0);
  return (
    <section>
      <button className="back-button" onClick={onBack}>← Назад к клиентам</button>
      <div className="summary-grid">
        <div><span>Текущий договор</span><strong>{active?.contractNumber ?? "Нет"}</strong></div>
        <div><span>Объект</span><strong>{active ? data.units.find((unit) => unit.id === active.unitId)?.unitNumber : "—"}</strong></div>
        <div><span>Статус аренды</span>{badge(active ? "active" : "expired")}</div>
        <div><span>Задолженность</span><strong className={debt ? "danger-text" : ""}>{money(debt)}</strong></div>
      </div>
      <div className="detail-tabs">{["contracts", "charges", "payments", "documents", "tasks"].map((id) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{({ contracts: "Договоры", charges: "Начисления", payments: "Оплаты", documents: "Документы", tasks: "Задачи" } as Record<string, string>)[id]}</button>)}</div>
      <div className="detail-content">
        <div className="detail-action">
          {active && <button className="button primary" onClick={() => onQr(active.id)}><QrCode size={16} />QR для оплаты</button>}
          {active && <button className="button" onClick={() => onContractDocument(active.id)}><FileDown size={16} />Сформировать договор</button>}
          <button className="button" onClick={() => onViewScans(customerId)}><Eye size={16} />Посмотреть договор</button>
          <button className="button" onClick={() => onUploadScan(customerId)} disabled={!eligibleContractsForScan(data, customerId).length || customerContractScans(data, customerId).length >= MAX_SIGNED_CONTRACTS_PER_CUSTOMER}><Upload size={16} />Загрузить договор</button>
          <button className="button" onClick={() => onAdd(tab as EntityType)}><Plus size={16} />Добавить</button>
        </div>
        {tab === "contracts" && <SimpleTable headers={["Договор", "Объект", "Период", "Ставка", "Статус"]} rows={contracts.map((x) => [<strong key="contract">{x.contractNumber}</strong>, data.units.find((u) => u.id === x.unitId)?.unitNumber, `${date(x.startDate)} — ${date(x.endDate)}`, money(x.monthlyRate), badge(x.status)])} onRowClick={(index) => onContractDocument(contracts[index].id)} />}
        {tab === "charges" && <SimpleTable headers={["Период", "Срок", "Сумма", "Оплачено", "Статус"]} rows={charges.map((x) => [`${date(x.periodStart)} — ${date(x.periodEnd)}`, date(x.dueDate), money(x.amount), money(chargePaidAmount(x.id, data)), badge(effectiveChargeStatus(x.id, data, new Date("2026-07-19")))])} />}
        {tab === "payments" && <SimpleTable headers={["Дата", "Способ", "Номер", "Сумма"]} rows={payments.map((x) => [date(x.paymentDate), methodName(x.paymentMethod), x.referenceNumber || "—", <strong key="amount">{money(x.amount)}</strong>])} onRowClick={(index) => onPayment(payments[index].id)} />}
        {tab === "documents" && <SimpleTable headers={["Файл", "Тип"]} rows={documents.map((x) => [
          x.fileUrl.startsWith("/api/documents?key=")
            ? <a key="file" href={x.fileUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{x.fileName}</a>
            : x.fileName,
          x.documentType
        ])} />}
        {tab === "tasks" && <SimpleTable headers={["Задача", "Срок", "Статус"]} rows={tasks.map((x) => [x.title, date(x.dueDate), badge(x.status)])} />}
      </div>
    </section>
  );
}

function PaymentSettingsPage({ data, onSave }: { data: AppData; onSave: (data: AppData, message: string) => void }) {
  const settings = data.paymentSettings ?? {
    bankName: "Т-Банк", recipientName: "", taxId: "", kpp: "", accountNumber: "",
    bic: "", correspondentAccount: "", receiptEmail: ""
  };
  const landlordSettings: LandlordSettings = data.landlordSettings ?? {
    individual: { fullName: "", passport: "", registrationAddress: "", phone: "", email: "", taxId: "", bankName: "", cardNumber: "" },
    entrepreneur: {
      fullName: settings.recipientName || "", passport: "", registrationAddress: "", phone: "",
      email: settings.receiptEmail || "", taxId: settings.taxId || "", bankName: "", cardNumber: ""
    }
  };
  const [validationError, setValidationError] = useState("");
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = structuredClone(data);
    const candidate = {
      bankName: String(form.get("bankName") ?? "").trim(),
      recipientName: String(form.get("recipientName") ?? "").trim(),
      taxId: String(form.get("taxId") ?? "").replace(/\D/g, ""),
      kpp: String(form.get("kpp") ?? "").replace(/\D/g, ""),
      accountNumber: String(form.get("accountNumber") ?? "").replace(/\D/g, ""),
      bic: String(form.get("bic") ?? "").replace(/\D/g, ""),
      correspondentAccount: String(form.get("correspondentAccount") ?? "").replace(/\D/g, ""),
      receiptEmail: String(form.get("receiptEmail") ?? "").trim()
    };
    const errors = paymentSettingsErrors(candidate);
    if (errors.length) { setValidationError(`Не удалось сохранить: ${errors.join("; ")}.`); return; }
    const individualCardNumber = String(form.get("individualCardNumber") ?? "").replace(/\D/g, "");
    if (individualCardNumber && !/^\d{16,19}$/.test(individualCardNumber)) {
      setValidationError("Не удалось сохранить: номер карты физического лица должен содержать от 16 до 19 цифр."); return;
    }
    setValidationError("");
    next.paymentSettings = candidate;
    next.landlordSettings = {
      individual: {
        fullName: String(form.get("individualFullName") ?? "").trim(),
        passport: String(form.get("individualPassport") ?? "").trim(),
        registrationAddress: String(form.get("individualRegistrationAddress") ?? "").trim(),
        phone: String(form.get("individualPhone") ?? "").trim(),
        email: String(form.get("individualEmail") ?? "").trim(),
        taxId: "",
        bankName: String(form.get("individualBankName") ?? "").trim(),
        cardNumber: individualCardNumber
      },
      entrepreneur: {
        fullName: String(form.get("entrepreneurFullName") ?? "").trim(),
        passport: "", registrationAddress: "",
        phone: String(form.get("entrepreneurPhone") ?? "").trim(),
        email: String(form.get("entrepreneurEmail") ?? "").trim(),
        taxId: String(form.get("entrepreneurTaxId") ?? "").replace(/\D/g, ""), bankName: "", cardNumber: ""
      }
    };
    onSave(next, "Платёжные реквизиты и данные арендодателей сохранены");
  }
  return (
    <form className="settings-layout" onSubmit={submit}>
      <section className="panel settings-panel">
        <div className="panel-head"><h2>Получатель платежа</h2>{hasCompletePaymentSettings(settings) ? badge("active") : <span className="badge badge-pending">Не настроено</span>}</div>
        <p className="settings-note">Реквизиты проверяются перед созданием банковского QR. Нерабочий или демонстрационный код отправить клиенту нельзя.</p>
        <div className="form-grid">
          <Field name="bankName" label="Банк" required defaultValue={settings.bankName} />
          <Field name="recipientName" label="Получатель" required defaultValue={settings.recipientName} />
          <Field name="taxId" label="ИНН" required defaultValue={settings.taxId} />
          <Field name="kpp" label="КПП, если есть" defaultValue={settings.kpp} />
          <Field name="accountNumber" label="Расчётный счёт" required defaultValue={settings.accountNumber} />
          <Field name="bic" label="БИК" required defaultValue={settings.bic} />
          <Field name="correspondentAccount" label="Корреспондентский счёт" required wide defaultValue={settings.correspondentAccount} />
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="panel-head"><h2>Почта для чеков</h2></div>
        <p className="settings-note">Адрес будет добавляться в инструкцию клиенту. Автоматический приём и распознавание писем включим после подключения почтового backend.</p>
        <div className="form-grid"><Field name="receiptEmail" label="Email для чеков" type="email" wide defaultValue={settings.receiptEmail} /></div>
      </section>
      <section className="panel settings-panel">
        <div className="panel-head"><h2>Арендодатель — физическое лицо</h2><UserRound size={20} /></div>
        <p className="settings-note">Эти данные подставляются в договор, когда сотрудник выбирает физическое лицо.</p>
        <div className="form-grid">
          <Field name="individualFullName" label="ФИО" wide defaultValue={landlordSettings.individual.fullName} />
          <Field name="individualPassport" label="Паспорт" wide defaultValue={landlordSettings.individual.passport} />
          <Field name="individualRegistrationAddress" label="Место регистрации" wide defaultValue={landlordSettings.individual.registrationAddress} />
          <Field name="individualPhone" label="Телефон" defaultValue={landlordSettings.individual.phone} />
          <Field name="individualEmail" label="Email" type="email" defaultValue={landlordSettings.individual.email} />
          <Field name="individualBankName" label="Банк для оплаты" defaultValue={landlordSettings.individual.bankName} />
          <Field name="individualCardNumber" label="Номер карты" defaultValue={landlordSettings.individual.cardNumber} />
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="panel-head"><h2>Арендодатель — ИП</h2><Building2 size={20} /></div>
        <p className="settings-note">Реквизиты ИП используются в договоре независимо от получателя банковского платежа.</p>
        <div className="form-grid">
          <Field name="entrepreneurFullName" label="Наименование / ФИО" wide defaultValue={landlordSettings.entrepreneur.fullName} />
          <Field name="entrepreneurTaxId" label="ИНН" defaultValue={landlordSettings.entrepreneur.taxId} />
          <Field name="entrepreneurPhone" label="Телефон" defaultValue={landlordSettings.entrepreneur.phone} />
          <Field name="entrepreneurEmail" label="Email" type="email" wide defaultValue={landlordSettings.entrepreneur.email} />
        </div>
      </section>
      {validationError && <div className="form-error">{validationError}</div>}
      <div className="settings-actions"><button className="button primary"><Save size={16} />Сохранить реквизиты</button></div>
    </form>
  );
}

function PaymentQrModal({ contractId, data, onClose, onSave, onOpenSettings }: {
  contractId: number; data: AppData; onClose: () => void;
  onSave: (data: AppData, message: string) => void; onOpenSettings: () => void;
}) {
  const contract = data.contracts.find((item) => item.id === contractId)!;
  const customer = data.customers.find((item) => item.id === contract.customerId)!;
  const nextCharge = data.charges.find((item) => item.contractId === contractId && ["pending", "partial", "overdue"].includes(effectiveChargeStatus(item.id, data, new Date("2026-07-19"))));
  const [period, setPeriod] = useState(nextCharge?.periodStart.slice(0, 7) ?? "2026-08");
  const [amount, setAmount] = useState(nextCharge?.amount ?? contract.monthlyRate);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [mailError, setMailError] = useState("");
  const settings = data.paymentSettings ?? {
    bankName: "Т-Банк", recipientName: "", taxId: "", kpp: "", accountNumber: "",
    bic: "", correspondentAccount: "", receiptEmail: ""
  };
  const purpose = paymentPurpose(contract.contractNumber, period);
  const settingsErrors = paymentSettingsErrors(settings);
  const isConfigured = settingsErrors.length === 0;
  const payload = isConfigured
    ? buildPaymentQrPayload(settings, amount, purpose)
    : "";

  useEffect(() => {
    if (!payload) { setQrDataUrl(""); return; }
    QRCode.toDataURL(payload, { width: 650, margin: 4, errorCorrectionLevel: "L", color: { dark: "#000000", light: "#ffffff" } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [payload]);

  async function prepareEmail() {
    setMailError("");
    if (!isConfigured) { setMailError(`QR не отправлен: ${settingsErrors.join("; ")}.`); return; }
    const receiptInstruction = settings.receiptEmail
      ? `После оплаты отправьте чек на ${settings.receiptEmail}. В теле письма укажите:\\nДоговор: ${contract.contractNumber}\\nПериод: ${paymentPeriodLabel(period)}`
      : "После оплаты сохраните чек. Адрес для автоматической отправки будет настроен позже.";
    const body = `Здравствуйте, ${customer.fullName}!\\n\\nСумма к оплате: ${money(amount)}\\n${purpose}.\\n\\n${receiptInstruction}`;
    const demoMode = window.location.hostname.endsWith("github.io");
    if (!demoMode) {
      setSending(true);
      const response = await fetch("/api/mail/payment-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: customer.email,
          customerName: customer.fullName,
          contractNumber: contract.contractNumber,
          periodLabel: paymentPeriodLabel(period),
          amountLabel: money(amount),
          amount,
          purpose,
          receiptEmail: settings.receiptEmail,
          paymentDetails: {
            recipientName: settings.recipientName,
            taxId: settings.taxId,
            bankName: settings.bankName,
            bic: settings.bic,
            accountNumber: settings.accountNumber,
            correspondentAccount: settings.correspondentAccount,
            kpp: settings.kpp
          }
        })
      });
      const responseBody = await response.json().catch(() => ({})) as { error?: string };
      setSending(false);
      if (!response.ok) { setMailError(responseBody.error ?? "Не удалось отправить письмо"); return; }
    }
    const next = structuredClone(data);
    const existingRequest = [...(next.paymentRequests ?? [])].reverse().find((item) =>
      item.contractId === contractId && item.period === period
    );
    if (existingRequest) {
      existingRequest.amount = amount;
      existingRequest.purpose = purpose;
      existingRequest.recipientEmail = customer.email;
      existingRequest.status = "sent";
    } else {
      next.paymentRequests = [...(next.paymentRequests ?? []), {
        id: nextId(next.paymentRequests ?? []),
        contractId,
        period,
        amount,
        purpose,
        recipientEmail: customer.email,
        status: "sent" as const,
        createdAt: new Date().toISOString()
      }];
    }
    const paymentTask = next.tasks.find((task) =>
      task.relatedEntityType === "contract_payment" &&
      task.relatedEntityId === contractId &&
      task.paymentPeriod === period
    );
    if (paymentTask) {
      paymentTask.status = "sent";
    } else {
      next.tasks.push({
        id: nextId(next.tasks),
        title: `Отправить QR · ${contract.contractNumber}`,
        description: `Ежемесячная оплата ${money(amount)} · ${customer.email}`,
        dueDate: paymentTaskDueDate(contract, period),
        priority: "medium",
        status: "sent",
        relatedEntityType: "contract_payment",
        relatedEntityId: contractId,
        paymentPeriod: period
      });
    }
    onSave(next, demoMode ? "Письмо открыто, задача отмечена как отправленная" : "QR отправлен клиенту, задача обновлена");
    if (demoMode) window.location.href = `mailto:${encodeURIComponent(customer.email)}?subject=${encodeURIComponent(`Оплата аренды · ${contract.contractNumber} · ${paymentPeriodLabel(period)}`)}&body=${encodeURIComponent(body)}`;
  }

  async function copyPurpose() {
    await navigator.clipboard.writeText(purpose);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <section className="modal qr-modal">
        <div className="modal-head"><div><h2>QR для оплаты аренды</h2><small>{customer.fullName} · {contract.contractNumber}</small></div><button type="button" onClick={onClose} aria-label="Закрыть"><X /></button></div>
        {!isConfigured && <div className="qr-warning"><strong>QR не сформирован</strong><span>{settingsErrors.join("; ")}. Исправьте реквизиты — система не отправляет демонстрационные коды клиентам.</span><button className="button" onClick={onOpenSettings}>Проверить реквизиты</button></div>}
        <div className="qr-layout">
          <div className="qr-image">{qrDataUrl ? <img src={qrDataUrl} alt="QR-код для оплаты аренды" /> : <span>{isConfigured ? "Формирование QR…" : "Ожидает корректных реквизитов"}</span>}<small>{isConfigured ? "Банковский QR · ST00012 · проверен" : "Отправка заблокирована"}</small></div>
          <div className="qr-fields">
            <label>Месяц оплаты<input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
            <label>Сумма, ₽<input type="number" min="1" step="0.01" value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></label>
            <div className="payment-purpose"><span>Назначение платежа</span><strong>{purpose}</strong><button onClick={copyPurpose} title="Копировать назначение"><Copy size={15} />{copied ? "Скопировано" : "Копировать"}</button></div>
          </div>
        </div>
        <div className="qr-summary"><span>Получатель<strong>{settings.recipientName || "Будет указан позже"}</strong></span><span>Банк<strong>{settings.bankName}</strong></span><span>Клиент<strong>{customer.email || "Email не указан"}</strong></span></div>
        <div className="modal-actions">
          {qrDataUrl && isConfigured && <a className="button" href={qrDataUrl} download={`qr-${contract.contractNumber}-${period}.png`}><QrCode size={16} />Скачать PNG</a>}
          <button className="button primary" onClick={prepareEmail} disabled={!customer.email || sending || !qrDataUrl || !isConfigured}><Mail size={16} />{sending ? "Отправляем…" : "Отправить QR клиенту"}</button>
        </div>
        {mailError && <div className="form-error">{mailError}</div>}
        <p className="qr-footnote">Письмо отправляется через подключённый служебный почтовый ящик.</p>
      </section>
    </div>
  );
}

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function markdownToHtml(markdown: string) {
  const inline = (value: string) => escapeHtml(value.trim().replace(/  $/, ""))
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const output: string[] = [];
  let inList = false;
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const item = line.match(/^-\s+(.+)$/);
    if (!item && inList) { output.push("</ul>"); inList = false; }
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (item) {
      if (!inList) { output.push("<ul>"); inList = true; }
      output.push(`<li>${inline(item[1])}</li>`);
    } else if (/^---+$/.test(line.trim())) {
      output.push("<hr>");
    } else if (line.trim()) {
      output.push(`<p>${inline(line)}</p>`);
    }
  }
  if (inList) output.push("</ul>");
  return output.join("\n");
}

function ContractDocumentModal({ contractId, data, onClose }: { contractId: number; data: AppData; onClose: () => void }) {
  const contract = data.contracts.find((item) => item.id === contractId)!;
  const customer = data.customers.find((item) => item.id === contract.customerId)!;
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [landlordType, setLandlordType] = useState<LandlordType>("entrepreneur");

  useEffect(() => {
    const controller = new AbortController();
    setContent(""); setError(""); setSent(false);
    fetch("/dogovor_arendy_kladovoi_RF.md", { signal: controller.signal, cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Не удалось загрузить шаблон договора");
        return response.text();
      })
      .then((template) => setContent(generateRentalContract(template, data, contractId, landlordType)))
      .catch((caught) => {
        if ((caught as Error).name !== "AbortError") setError(caught instanceof Error ? caught.message : "Не удалось сформировать договор");
      });
    return () => controller.abort();
  }, [contractId, data, landlordType]);

  function download() {
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = contractFileName(contract.contractNumber);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function print() {
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) { setError("Браузер заблокировал окно печати"); return; }
    printWindow.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(contract.contractNumber)}</title><style>body{font-family:Arial,sans-serif;color:#111;max-width:820px;margin:36px auto;line-height:1.45;font-size:12px}h1{text-align:center;font-size:22px;margin:0 0 24px}h2{font-size:16px;margin:24px 0 10px;page-break-after:avoid}h3{font-size:14px;margin:18px 0 8px}p{margin:6px 0}ul{margin:7px 0 12px;padding-left:24px}hr{border:0;border-top:1px solid #bbb;margin:28px 0}@page{size:A4;margin:18mm}@media print{body{margin:0;max-width:none}}</style></head><body>${markdownToHtml(content)}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 250);
  }

  async function copy() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function send() {
    if (!customer.email) { setError("В карточке клиента не указан email"); return; }
    setSending(true); setError(""); setSent(false);
    try {
      const response = await fetch("/api/mail/contract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: customer.email, customerName: customer.fullName, contractNumber: contract.contractNumber, content })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Не удалось отправить договор");
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось отправить договор");
    } finally { setSending(false); }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <section className="modal contract-modal">
        <div className="contract-modal-top">
          <div className="modal-head"><div><h2>Договор {contract.contractNumber}</h2><small>Данные подставлены из карточек клиента, адреса, объекта и договора</small></div><button type="button" onClick={onClose} aria-label="Закрыть"><X /></button></div>
          <div className="contract-party-picker" role="radiogroup" aria-label="Выбор арендодателя">
            <span>Сформировать договор от имени:</span>
            <button type="button" role="radio" aria-checked={landlordType === "individual"} className={landlordType === "individual" ? "active" : ""} onClick={() => setLandlordType("individual")}><UserRound size={20} /><span><strong>Физическое лицо</strong><small>ФИО и паспорт</small></span></button>
            <button type="button" role="radio" aria-checked={landlordType === "entrepreneur"} className={landlordType === "entrepreneur" ? "active" : ""} onClick={() => setLandlordType("entrepreneur")}><Building2 size={20} /><span><strong>ИП</strong><small>ИНН и реквизиты ИП</small></span></button>
          </div>
          {error && <div className="form-error">{error}</div>}
        </div>
        {!content && !error && <div className="empty">Формируем договор…</div>}
        {content && <article className="contract-preview" dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }} />}
        <div className="modal-actions contract-actions">
          <button className="button" onClick={copy} disabled={!content}><Copy size={16} />{copied ? "Скопировано" : "Копировать"}</button>
          <button className="button" onClick={download} disabled={!content}><Download size={16} />Скачать Markdown</button>
          <button className="button" onClick={send} disabled={!content || !customer.email || sending}><Mail size={16} />{sending ? "Отправляем…" : sent ? "Отправлен" : "Отправить клиенту"}</button>
          <button className="button primary" onClick={print} disabled={!content}><Printer size={16} />Печать / PDF</button>
        </div>
      </section>
    </div>
  );
}

function SignedContractUploadModal({ customerId, data, onClose, onSave }: {
  customerId: number; data: AppData; onClose: () => void; onSave: (data: AppData, message: string) => void;
}) {
  const customer = data.customers.find((item) => item.id === customerId)!;
  const scans = customerContractScans(data, customerId);
  const eligibleContracts = eligibleContractsForScan(data, customerId);
  const [contractId, setContractId] = useState(eligibleContracts[0]?.id ?? 0);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    try {
      if (!file) throw new Error("Выберите скан-копию договора");
      const extension = file.name.split(".").pop()?.toLowerCase();
      const inferredType = file.type || ({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as Record<string, string>)[extension ?? ""] || "";
      if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(inferredType)) throw new Error("Поддерживаются PDF, JPG, PNG и WebP");
      if (file.size > 10 * 1024 * 1024) throw new Error("Размер файла не должен превышать 10 МБ");
      validateSignedContractUpload(data, customerId, contractId);
      setSaving(true);
      const next = structuredClone(data);
      const documentId = nextId(next.documents);
      const fileUrl = await storeSignedContractFile(documentId, file, inferredType, contractId);
      next.documents.push({
        id: documentId,
        entityType: "contract",
        entityId: contractId,
        fileName: file.name,
        fileUrl,
        documentType: "contract_scan",
        mimeType: inferredType,
        fileSize: file.size,
        uploadedAt: new Date().toISOString()
      });
      onSave(next, "Подписанный договор загружен");
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить договор");
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <form className="modal scan-upload-modal" onSubmit={submit}>
        <div className="modal-head"><div><h2>Загрузить подписанный договор</h2><small>{customer.fullName} · загружено {scans.length} из {MAX_SIGNED_CONTRACTS_PER_CUSTOMER}</small></div><button type="button" onClick={onClose} aria-label="Закрыть"><X /></button></div>
        <div className="scan-limit-note">Можно сохранить до трёх договоров клиента. Каждый договор должен относиться к отдельному объекту.</div>
        <div className="form-grid scan-upload-fields">
          <label className="wide">Договор и объект<select value={contractId} onChange={(event) => setContractId(Number(event.target.value))} required>{eligibleContracts.map((contract) => { const unit = data.units.find((item) => item.id === contract.unitId); return <option key={contract.id} value={contract.id}>{contract.contractNumber} · объект {unit?.unitNumber}</option>; })}</select></label>
          <label className="wide file-picker">Скан-копия<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><small>PDF, JPG, PNG или WebP · до 10 МБ</small></label>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions"><button type="button" className="button" onClick={onClose}>Отмена</button><button className="button primary" disabled={saving || !eligibleContracts.length}><Upload size={16} />{saving ? "Сохраняем…" : "Загрузить договор"}</button></div>
      </form>
    </div>
  );
}

function SignedContractsModal({ customerId, data, onClose, onSave }: {
  customerId: number; data: AppData; onClose: () => void; onSave: (data: AppData, message: string) => void;
}) {
  const customer = data.customers.find((item) => item.id === customerId)!;
  const scans = useMemo(() => customerContractScans(data, customerId), [data, customerId]);
  const [selectedId, setSelectedId] = useState(scans[0]?.id ?? 0);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewType, setPreviewType] = useState("");
  const [error, setError] = useState("");
  const selected = scans.find((document) => document.id === selectedId);

  useEffect(() => {
    if (selectedId && !scans.some((document) => document.id === selectedId)) setSelectedId(scans[0]?.id ?? 0);
  }, [scans, selectedId]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    setPreviewUrl(""); setPreviewType(""); setError("");
    if (!selected) return;
    if (selected.fileUrl.startsWith("https://") || selected.fileUrl.startsWith("/api/documents")) {
      setPreviewUrl(selected.fileUrl); setPreviewType(selected.mimeType ?? "application/pdf"); return;
    }
    getSignedContractFile(selected.id)
      .then((stored) => {
        if (cancelled) return;
        if (!stored) throw new Error("Файл не найден в локальном хранилище этого браузера");
        objectUrl = URL.createObjectURL(stored.blob);
        setPreviewUrl(objectUrl); setPreviewType(stored.mimeType || selected.mimeType || "application/pdf");
      })
      .catch((caught) => !cancelled && setError(caught instanceof Error ? caught.message : "Не удалось открыть договор"));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [selected]);

  async function remove(documentId: number) {
    if (!window.confirm("Удалить скан-копию договора?")) return;
    const document = data.documents.find((item) => item.id === documentId);
    if (document) await deleteSignedContractFile(documentId, document.fileUrl);
    const next = structuredClone(data);
    next.documents = next.documents.filter((item) => item.id !== documentId);
    onSave(next, "Скан-копия договора удалена");
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <section className="modal scans-modal">
        <div className="modal-head"><div><h2>Подписанные договоры</h2><small>{customer.fullName} · {scans.length} из {MAX_SIGNED_CONTRACTS_PER_CUSTOMER}</small></div><button type="button" onClick={onClose} aria-label="Закрыть"><X /></button></div>
        {!scans.length ? <div className="empty">Подписанные договоры ещё не загружены</div> : <div className="scans-layout">
          <aside className="scan-list">{scans.map((document) => { const contract = data.contracts.find((item) => item.id === document.entityId); const unit = data.units.find((item) => item.id === contract?.unitId); return <button key={document.id} className={selectedId === document.id ? "active" : ""} onClick={() => setSelectedId(document.id)}><FileText size={17} /><span><strong>{contract?.contractNumber}</strong><small>Объект {unit?.unitNumber} · {document.fileName}</small></span></button>; })}</aside>
          <div className="scan-preview">
            {error && <div className="form-error">{error}</div>}
            {!previewUrl && !error && <div className="empty">Открываем договор…</div>}
            {previewUrl && previewType.startsWith("image/") && <img src={previewUrl} alt={`Скан договора ${selected?.fileName ?? ""}`} />}
            {previewUrl && !previewType.startsWith("image/") && <iframe src={previewUrl} title={`Скан договора ${selected?.fileName ?? ""}`} />}
          </div>
        </div>}
        <div className="modal-actions scans-actions">
          {previewUrl && <a className="button" href={previewUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />Открыть отдельно</a>}
          {selected && <button className="button danger-button" onClick={() => remove(selected.id)}><Trash2 size={16} />Удалить</button>}
          <button className="button primary" onClick={onClose}>Закрыть</button>
        </div>
      </section>
    </div>
  );
}

function PaymentDetailsModal({ paymentId, data, onClose }: { paymentId: number; data: AppData; onClose: () => void }) {
  const payment = data.payments.find((item) => item.id === paymentId);
  if (!payment) return null;
  const customer = data.customers.find((item) => item.id === payment.customerId);
  const contract = data.contracts.find((item) => item.id === payment.contractId);
  const unit = data.units.find((item) => item.id === contract?.unitId);
  const location = data.locations.find((item) => item.id === unit?.locationId);
  const charge = payment.chargeId ? data.charges.find((item) => item.id === payment.chargeId) : undefined;
  const receipts = data.documents.filter((item) => item.entityType === "payment" && item.entityId === payment.id && item.documentType === "receipt");
  const paidForCharge = charge ? chargePaidAmount(charge.id, data) : 0;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <section className="modal payment-details-modal">
        <div className="modal-head"><div><h2>Оплата {money(payment.amount)}</h2><small>{date(payment.paymentDate)} · {customer?.fullName ?? "Клиент не найден"}</small></div><button type="button" onClick={onClose} aria-label="Закрыть"><X /></button></div>
        <div className="payment-detail-grid">
          <div><span>Договор</span><strong>{contract?.contractNumber ?? "Не указан"}</strong></div>
          <div><span>Объект</span><strong>{unit ? `${unit.unitNumber}${location ? ` · ${location.address}` : ""}` : "Не указан"}</strong></div>
          <div><span>Способ оплаты</span><strong>{methodName(payment.paymentMethod)}</strong></div>
          <div><span>Номер операции</span><strong>{payment.referenceNumber || "Не указан"}</strong></div>
        </div>

        <section className="payment-source">
          <h3>Источник начисления</h3>
          {charge ? <div className="payment-source-grid">
            <span><small>Период</small><strong>{date(charge.periodStart)} — {date(charge.periodEnd)}</strong></span>
            <span><small>Срок оплаты</small><strong>{date(charge.dueDate)}</strong></span>
            <span><small>Тип</small><strong>{chargeTypeName(charge.chargeType)}</strong></span>
            <span><small>Начислено</small><strong>{money(charge.amount)}</strong></span>
            <span><small>Оплачено по начислению</small><strong>{money(paidForCharge)}</strong></span>
            <span><small>Статус</small>{badge(effectiveChargeStatus(charge.id, data))}</span>
          </div> : <div className="empty compact-empty">Оплата внесена без привязки к начислению</div>}
        </section>

        {payment.comment && <div className="payment-comment"><span>Комментарий</span><p>{payment.comment}</p></div>}

        <section className="receipt-history">
          <div className="receipt-history-head"><div><h3>Чеки и подтверждения</h3><small>Файлы сохраняются в истории оплаты и закрытом хранилище</small></div><span className="badge">{receipts.length}</span></div>
          {!receipts.length ? <div className="empty compact-empty">К этой оплате чек ещё не прикреплён</div> : receipts.map((receipt) => {
            const isImage = receipt.mimeType?.startsWith("image/");
            const available = receipt.fileUrl && receipt.fileUrl !== "#";
            return <article className="receipt-card" key={receipt.id}>
              <header><span><strong>{receipt.fileName}</strong><small>{receipt.uploadedAt ? date(receipt.uploadedAt) : "Дата загрузки не указана"}{receipt.fileSize ? ` · ${Math.ceil(receipt.fileSize / 1024)} КБ` : ""}</small></span>{available && <a className="button" href={receipt.fileUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Открыть</a>}</header>
              {available && isImage && <img src={receipt.fileUrl} alt={`Чек ${receipt.fileName}`} />}
              {available && !isImage && <iframe src={receipt.fileUrl} title={`Чек ${receipt.fileName}`} />}
            </article>;
          })}
        </section>
        <div className="modal-actions"><button className="button primary" onClick={onClose}>Закрыть</button></div>
      </section>
    </div>
  );
}

function SimpleTable({ headers, rows, onRowClick }: { headers: string[]; rows: React.ReactNode[][]; onRowClick?: (index: number) => void }) {
  if (!rows.length) return <div className="empty">Записей пока нет</div>;
  return <div className="table-card"><table><thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i} className={onRowClick ? "clickable-row" : ""} onClick={() => onRowClick?.(i)}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function EntityModal({ modal, data, onClose, onSave }: { modal: Exclude<Modal, null>; data: AppData; onClose: () => void; onSave: (data: AppData, message: string) => void }) {
  const collection =
    modal.type === "locations" ? data.locations : modal.type === "units" ? data.units :
    modal.type === "customers" ? data.customers : modal.type === "contracts" ? data.contracts :
    modal.type === "charges" ? data.charges : modal.type === "payments" ? data.payments :
    modal.type === "tasks" ? data.tasks : modal.type === "documents" ? data.documents : data.users;
  const editing = modal.id ? collection.find((item) => item.id === modal.id) as unknown as Record<string, unknown> | undefined : undefined;
  const value = (key: string, fallback = "") => String(editing?.[key] ?? fallback);
  const editingPayment = modal.type === "payments" && editing ? editing : undefined;
  const [error, setError] = useState("");
  const [customerId, setCustomerId] = useState(Number(editingPayment?.customerId ?? data.customers[0]?.id ?? 0));
  const [contractId, setContractId] = useState(Number(editingPayment?.contractId ?? data.contracts.find((c) => c.status === "active")?.id ?? 0));
  const [rentalUnitId, setRentalUnitId] = useState(Number(editing?.unitId ?? data.units.find((unit) => unitStatus(unit.id, data) === "free")?.id ?? data.units[0]?.id ?? 0));
  const contract = data.contracts.find((item) => item.id === contractId);
  const rentalUnit = data.units.find((item) => item.id === rentalUnitId);
  const input = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
  const upsert = <T extends { id: number }>(rows: T[], record: T) => {
    const index = rows.findIndex((item) => item.id === record.id);
    if (index >= 0) rows[index] = record; else rows.push(record);
  };
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const next = structuredClone(data);
      if (modal.type === "locations") upsert(next.locations, { id: modal.id ?? nextId(next.locations), name: input(form, "name"), address: input(form, "address"), description: input(form, "description"), isActive: editing?.isActive !== false });
      else if (modal.type === "units") {
        const locationId = Number(input(form, "locationId"));
        const unitNumber = input(form, "unitNumber");
        const duplicate = next.units.some((unit) => unit.id !== modal.id && unit.locationId === locationId && unit.unitNumber.toLocaleLowerCase("ru") === unitNumber.toLocaleLowerCase("ru"));
        if (duplicate) throw new Error("Объект с таким номером уже существует по выбранному адресу");
        upsert(next.units, { id: modal.id ?? nextId(next.units), locationId, unitNumber, unitType: input(form, "unitType") as "storage", areaSqm: Number(input(form, "areaSqm")), monthlyRate: Number(input(form, "monthlyRate")), depositAmount: Number(input(form, "depositAmount")), status: input(form, "status") as UnitStatus, note: input(form, "note"), photoUrl: normalizeObjectPhotoUrl(input(form, "photoUrl")) });
      }
      else if (modal.type === "customers") upsert(next.customers, { id: modal.id ?? nextId(next.customers), customerType: (editing?.customerType as "individual" | "business" | undefined) ?? "individual", fullName: input(form, "fullName"), phone: input(form, "phone"), email: input(form, "email"), passportOrRegistrationData: input(form, "registration"), taxId: input(form, "taxId"), address: input(form, "address"), note: input(form, "note") });
      else if (modal.type === "contracts") {
        const candidate: Contract = { id: modal.id ?? nextId(next.contracts), customerId: Number(input(form, "customerId")), unitId: Number(input(form, "unitId")), contractNumber: input(form, "contractNumber"), startDate: input(form, "startDate"), endDate: input(form, "endDate"), monthlyRate: Number(input(form, "monthlyRate")), depositAmount: Number(input(form, "depositAmount")), billingDay: Number(input(form, "billingDay")), status: input(form, "status") as "active", terminationReason: value("terminationReason"), note: input(form, "note") };
        validateActiveContract(candidate, next.contracts); upsert(next.contracts, candidate);
        if (candidate.status === "active") next.units.find((unit) => unit.id === candidate.unitId)!.status = "occupied";
      } else if (modal.type === "charges") upsert(next.charges, { id: modal.id ?? nextId(next.charges), contractId: Number(input(form, "contractId")), periodStart: input(form, "periodStart"), periodEnd: input(form, "periodEnd"), dueDate: input(form, "dueDate"), amount: Number(input(form, "amount")), chargeType: input(form, "chargeType") as "rent", status: (editing?.status as "pending" | undefined) ?? "pending", note: input(form, "note") });
      else if (modal.type === "payments") {
        const chargeId = input(form, "chargeId");
        upsert(next.payments, { id: modal.id ?? nextId(next.payments), customerId: Number(input(form, "customerId")), contractId: Number(input(form, "contractId")), chargeId: chargeId ? Number(chargeId) : null, paymentDate: input(form, "paymentDate"), amount: Number(input(form, "amount")), paymentMethod: input(form, "paymentMethod") as "sbp", referenceNumber: input(form, "referenceNumber"), comment: input(form, "comment") });
        if (chargeId) {
          const charge = next.charges.find((item) => item.id === Number(chargeId))!;
          charge.status = calculateChargeStatus(charge.amount, chargePaidAmount(charge.id, next), charge.dueDate, new Date("2026-07-19"));
          if (charge.status === "paid") {
            const period = charge.periodStart.slice(0, 7);
            const task = next.tasks.find((item) =>
              item.relatedEntityType === "contract_payment" &&
              item.relatedEntityId === charge.contractId &&
              item.paymentPeriod === period
            );
            if (task) task.status = "paid";
            const request = [...(next.paymentRequests ?? [])].reverse().find((item) =>
              item.contractId === charge.contractId && item.period === period
            );
            if (request) request.status = "paid";
          }
        }
      } else if (modal.type === "tasks") upsert(next.tasks, { id: modal.id ?? nextId(next.tasks), title: input(form, "title"), description: input(form, "description"), dueDate: input(form, "dueDate"), priority: input(form, "priority") as "medium", status: (editing?.status as TaskStatus | undefined) ?? "open", relatedEntityType: (editing?.relatedEntityType as string | null | undefined) ?? null, relatedEntityId: (editing?.relatedEntityId as number | null | undefined) ?? null, paymentPeriod: editing?.paymentPeriod as string | undefined });
      else if (modal.type === "documents") upsert(next.documents, { id: modal.id ?? nextId(next.documents), entityType: (editing?.entityType as "customer" | undefined) ?? "customer", entityId: Number(editing?.entityId ?? customerId), fileName: input(form, "fileName"), fileUrl: value("fileUrl", "#"), documentType: input(form, "documentType") as "other" });
      else if (modal.type === "users") upsert(next.users, { id: modal.id ?? nextId(next.users), name: input(form, "name"), email: input(form, "email"), role: input(form, "role") as Role, isActive: editing?.isActive !== false });
      onSave(next, modal.id ? "Изменения сохранены" : "Запись сохранена");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось сохранить запись"); }
  }
  const title = modal.id ? "Редактирование" : `Новая запись: ${modal.type === "documents" ? "Документы" : titles[modal.type][0]}`;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <form className="modal" onSubmit={submit}>
        <div className="modal-head"><h2>{title}</h2><button type="button" onClick={onClose} aria-label="Закрыть"><X /></button></div>
        <div className="form-grid">
          {modal.type === "locations" && <><Field name="name" label="Название" required defaultValue={value("name")} /><Field name="address" label="Адрес" required defaultValue={value("address")} /><Field name="description" label="Описание" wide defaultValue={value("description")} /></>}
          {modal.type === "units" && <><Select name="locationId" label="Адрес" options={data.locations.map((x) => [x.id, x.name])} defaultValue={value("locationId")} /><Field name="unitNumber" label="Номер" required defaultValue={value("unitNumber")} /><Select name="status" label="Статус" options={[["occupied", "Занята"], ["free", "Свободна"], ["maintenance", "В ремонте"]]} defaultValue={value("status", "free")} /><Select name="unitType" label="Тип" options={[["storage", "Кладовка"], ["garage", "Гараж"], ["box", "Бокс"]]} defaultValue={value("unitType")} /><Field name="areaSqm" label="Площадь, м²" type="number" required defaultValue={value("areaSqm")} /><Field name="monthlyRate" label="Ставка, ₽" type="number" required defaultValue={value("monthlyRate")} /><Field name="depositAmount" label="Депозит, ₽" type="number" defaultValue={value("depositAmount")} /><Field name="photoUrl" label="Ссылка на фото в Яндекс Облаке" type="url" wide defaultValue={value("photoUrl")} /><Field name="note" label="Примечание" wide defaultValue={value("note")} /></>}
          {modal.type === "customers" && <><Field name="fullName" label="ФИО" required defaultValue={value("fullName")} /><Field name="phone" label="Телефон" required defaultValue={value("phone")} /><Field name="email" label="Email" type="email" defaultValue={value("email")} /><Field name="registration" label="Паспорт / регистрационные данные" wide defaultValue={value("passportOrRegistrationData")} /><Field name="taxId" label="ИНН" defaultValue={value("taxId")} /><Field name="address" label="Адрес" defaultValue={value("address")} /><Field name="note" label="Примечание" wide defaultValue={value("note")} /></>}
          {modal.type === "contracts" && <><Select name="customerId" label="Клиент" options={data.customers.map((x) => [x.id, x.fullName])} defaultValue={value("customerId")} /><label>Объект<select name="unitId" value={rentalUnitId} onChange={(event) => setRentalUnitId(Number(event.target.value))}>{data.units.filter((x) => x.id === Number(editing?.unitId) || unitStatus(x.id, data) === "free").map((x) => <option key={x.id} value={x.id}>{x.unitNumber} · {unitTypeName(x.unitType)} · {money(x.monthlyRate)}</option>)}</select></label><Field name="contractNumber" label="Номер договора" required readOnly defaultValue={value("contractNumber", nextContractNumber(data.contracts))} /><Select name="status" label="Статус" options={[["active", "Активен"], ["draft", "Черновик"]]} defaultValue={value("status")} /><Field name="startDate" label="Дата начала" type="date" required defaultValue={value("startDate", isoToday())} /><Field name="endDate" label="Дата окончания" type="date" required defaultValue={value("endDate", "2027-07-18")} /><Field key={`rate-${rentalUnitId}`} name="monthlyRate" label="Ставка, ₽" type="number" required defaultValue={value("monthlyRate", String(rentalUnit?.monthlyRate ?? ""))} /><Field key={`deposit-${rentalUnitId}`} name="depositAmount" label="Депозит, ₽" type="number" defaultValue={value("depositAmount", String(rentalUnit?.depositAmount ?? ""))} /><Field name="billingDay" label="День начисления" type="number" defaultValue={value("billingDay", "5")} /><Field name="note" label="Примечание" wide defaultValue={value("note")} /></>}
          {modal.type === "charges" && <><Select name="contractId" label="Активный договор" options={data.contracts.filter((x) => x.status === "active").map((x) => [x.id, x.contractNumber])} defaultValue={value("contractId")} /><Select name="chargeType" label="Тип" options={[["rent", "Аренда"], ["deposit", "Депозит"], ["penalty", "Пени"], ["other", "Другое"]]} defaultValue={value("chargeType")} /><Field name="periodStart" label="Начало периода" type="date" required defaultValue={value("periodStart", "2026-08-01")} /><Field name="periodEnd" label="Конец периода" type="date" required defaultValue={value("periodEnd", "2026-08-31")} /><Field name="dueDate" label="Срок оплаты" type="date" required defaultValue={value("dueDate", "2026-08-05")} /><Field name="amount" label="Сумма, ₽" type="number" required defaultValue={value("amount")} /><Field name="note" label="Примечание" wide defaultValue={value("note")} /></>}
          {modal.type === "payments" && <><label>Клиент<select name="customerId" value={customerId} onChange={(e) => { const id = Number(e.target.value); setCustomerId(id); const c = data.contracts.find((x) => x.customerId === id && x.status === "active"); if (c) setContractId(c.id); }}>{data.customers.map((x) => <option value={x.id} key={x.id}>{x.fullName}</option>)}</select></label><label>Договор<select name="contractId" value={contractId} onChange={(e) => setContractId(Number(e.target.value))}>{data.contracts.filter((x) => x.customerId === customerId).map((x) => <option value={x.id} key={x.id}>{x.contractNumber}</option>)}</select></label><Select name="chargeId" label="Начисление" options={[["", "Без привязки"], ...data.charges.filter((x) => x.contractId === contract?.id).map((x) => [x.id, `${date(x.periodStart)} · ${money(x.amount)}`] as [number, string])]} defaultValue={value("chargeId")} /><Field name="paymentDate" label="Дата" type="date" required defaultValue={value("paymentDate", isoToday())} /><Field name="amount" label="Сумма, ₽" type="number" required defaultValue={value("amount")} /><Select name="paymentMethod" label="Способ" options={[["sbp", "СБП"], ["bank_transfer", "Банковский перевод"], ["cash", "Наличные"], ["card", "Карта"], ["other", "Другое"]]} defaultValue={value("paymentMethod")} /><Field name="referenceNumber" label="Номер операции" defaultValue={value("referenceNumber")} /><Field name="comment" label="Комментарий" wide defaultValue={value("comment")} /></>}
          {modal.type === "tasks" && <><Field name="title" label="Название" required wide defaultValue={value("title")} /><Field name="dueDate" label="Срок" type="datetime-local" required defaultValue={value("dueDate")} /><Select name="priority" label="Приоритет" options={[["low", "Низкий"], ["medium", "Средний"], ["high", "Высокий"]]} defaultValue={value("priority")} /><Field name="description" label="Описание" wide defaultValue={value("description")} /></>}
          {modal.type === "documents" && <><Field name="fileName" label="Название файла" required wide /><Select name="documentType" label="Тип документа" options={[["contract_scan", "Скан договора"], ["receipt", "Квитанция"], ["invoice", "Счёт"], ["other", "Другое"]]} /></>}
          {modal.type === "users" && <><Field name="name" label="Имя" required defaultValue={value("name")} /><Field name="email" label="Email" type="email" required defaultValue={value("email")} /><Select name="role" label="Роль" options={[["Admin", "Admin"], ["Manager", "Manager"], ["Accountant", "Accountant"]]} defaultValue={value("role")} /></>}
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions"><button type="button" className="button" onClick={onClose}>Отмена</button><button className="button primary"><Save size={16} />Сохранить</button></div>
      </form>
    </div>
  );
}

function Field({ name, label, type = "text", required, readOnly, wide, defaultValue }: { name: string; label: string; type?: string; required?: boolean; readOnly?: boolean; wide?: boolean; defaultValue?: string }) {
  return <label className={wide ? "wide" : ""}>{label}<input name={name} type={type} required={required} readOnly={readOnly} defaultValue={defaultValue} /></label>;
}
function Select({ name, label, options, defaultValue }: { name: string; label: string; options: ([string | number, string])[]; defaultValue?: string }) {
  return <label>{label}<select name={name} defaultValue={defaultValue}>{options.map(([value, text]) => <option value={value} key={String(value)}>{text}</option>)}</select></label>;
}
function methodName(value: string) { return ({ cash: "Наличные", bank_transfer: "Банк", sbp: "СБП", card: "Карта", other: "Другое" } as Record<string, string>)[value] ?? value; }
function unitTypeName(value: string) { return ({ storage: "Кладовка", garage: "Гараж", box: "Бокс" } as Record<string, string>)[value] ?? value; }
function priorityName(value: string) { return ({ low: "Низкий", medium: "Средний", high: "Высокий" } as Record<string, string>)[value] ?? value; }
function chargeTypeName(value: string) { return ({ rent: "Аренда", deposit: "Депозит", penalty: "Пени", other: "Другое" } as Record<string, string>)[value] ?? value; }
