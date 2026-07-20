"use client";

import {
  Archive, Banknote, Boxes, Building2, CheckSquare, ChevronRight, CircleDollarSign,
  FileText, LayoutDashboard, LogOut, MapPin, Menu, Plus, Search, Settings, Users, Warehouse, X
} from "lucide-react";
import { useMemo, useState } from "react";
import { calculateChargeStatus, chargePaidAmount, dashboardMetrics, effectiveChargeStatus, money, unitStatus, validateActiveContract } from "@/lib/business";
import { useAppStore } from "@/lib/store";
import type { AppData, Contract, Role } from "@/lib/types";

type Page = "dashboard" | "locations" | "units" | "customers" | "contracts" | "charges" | "payments" | "tasks" | "users";
type EntityType = Page | "documents";
type Modal = null | { type: EntityType; id?: number };

const menu: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Обзор", icon: LayoutDashboard },
  { id: "locations", label: "Объекты", icon: MapPin },
  { id: "units", label: "Юниты", icon: Boxes },
  { id: "customers", label: "Клиенты", icon: Users },
  { id: "contracts", label: "Договоры", icon: FileText },
  { id: "charges", label: "Начисления", icon: CircleDollarSign },
  { id: "payments", label: "Оплаты", icon: Banknote },
  { id: "tasks", label: "Задачи", icon: CheckSquare },
  { id: "users", label: "Пользователи", icon: Settings }
];

const titles: Record<Page, [string, string]> = {
  dashboard: ["Обзор", "Операционная картина на сегодня"],
  locations: ["Объекты", "Адреса и складские площадки"],
  units: ["Юниты", "Кладовки, гаражи и боксы"],
  customers: ["Клиенты", "Физические лица и компании"],
  contracts: ["Договоры", "Условия и сроки аренды"],
  charges: ["Начисления", "Обязательства по договорам"],
  payments: ["Оплаты", "Зарегистрированные поступления"],
  tasks: ["Задачи", "Напоминания сотрудникам"],
  users: ["Пользователи", "Доступ сотрудников к системе"]
};

const statusText: Record<string, string> = {
  free: "Свободен", reserved: "Зарезервирован", occupied: "Занят", maintenance: "Ремонт", archived: "Архив",
  draft: "Черновик", active: "Активен", expired: "Истёк", terminated: "Расторгнут",
  pending: "Ожидает", paid: "Оплачено", partial: "Частично", overdue: "Просрочено", cancelled: "Отменено",
  open: "Открыта", in_progress: "В работе", done: "Готово"
};
const date = (value: string) => new Intl.DateTimeFormat("ru-RU").format(new Date(value));
const isoToday = () => new Date().toISOString().slice(0, 10);
const badge = (status: string) => <span className={`badge badge-${status}`}>{statusText[status] ?? status}</span>;
const nextId = <T extends { id: number }>(rows: T[]) => Math.max(0, ...rows.map((row) => row.id)) + 1;

export default function Home() {
  const { data, setData, reset } = useAppStore();
  const [role, setRole] = useState<Role | null>(null);
  const [page, setPage] = useState<Page>("dashboard");
  const [modal, setModal] = useState<Modal>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<number | null>(null);
  const [customerTab, setCustomerTab] = useState("contracts");
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [sidebar, setSidebar] = useState(false);
  const [toast, setToast] = useState("");

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }
  function navigate(next: Page) {
    setPage(next); setSelectedCustomer(null); setSearch(""); setSidebar(false);
  }
  function update(next: AppData, message: string) {
    setData(next); setModal(null); notify(message);
  }

  if (!role) return <Login onLogin={setRole} />;

  const visibleMenu = menu.filter((item) => item.id !== "users" || role === "Admin");
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
          <span><strong>{role === "Admin" ? "Анна Крылова" : role === "Manager" ? "Дмитрий Орлов" : "Елена Романова"}</strong><small>{role}</small></span>
          <button title="Выйти" onClick={() => setRole(null)}><LogOut size={17} /></button>
        </div>
      </aside>
      {sidebar && <button className="mobile-scrim" onClick={() => setSidebar(false)} aria-label="Закрыть меню" />}
      <main>
        <header className="topbar">
          <button className="menu-button" onClick={() => setSidebar(true)} aria-label="Открыть меню"><Menu /></button>
          <div><h1>{customer ? customer.fullName : titles[page][0]}</h1><p>{customer ? `${customer.customerType === "business" ? "Компания" : "Физическое лицо"} · ${customer.phone}` : titles[page][1]}</p></div>
          <div className="top-actions">
            {page !== "dashboard" && !customer && <button className="button primary" onClick={() => setModal({ type: page })}><Plus size={17} />Добавить</button>}
          </div>
        </header>

        {customer ? (
          <CustomerDetails data={data} customerId={customer.id} tab={customerTab} setTab={setCustomerTab} onBack={() => setSelectedCustomer(null)} onAdd={(type) => setModal({ type })} />
        ) : page === "dashboard" ? (
          <Dashboard data={data} locationFilter={locationFilter} setLocationFilter={setLocationFilter} onNavigate={navigate} onCustomer={setSelectedCustomer} />
        ) : (
          <Registry page={page} data={data} search={search} setSearch={setSearch} onCustomer={setSelectedCustomer} onEdit={(id) => setModal({ type: page, id })} />
        )}
      </main>
      {modal && <EntityModal modal={modal} data={data} onClose={() => setModal(null)} onSave={update} />}
      {toast && <div className="toast">{toast}</div>}
      <button className="demo-reset" onClick={() => { reset(); notify("Демо-данные восстановлены"); }}><Archive size={15} />Сбросить демо</button>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (role: Role) => void }) {
  const [role, setRole] = useState<Role>("Admin");
  return (
    <div className="login-page">
      <section className="login-card">
        <span className="login-logo"><Warehouse size={25} /></span>
        <h1>Кладовая</h1><p>Внутренняя система управления арендой</p>
        <label>Email<input defaultValue="admin@kladovaya.local" type="email" /></label>
        <label>Пароль<input defaultValue="demo1234" type="password" /></label>
        <label>Демо-роль<select value={role} onChange={(event) => setRole(event.target.value as Role)}><option>Admin</option><option>Manager</option><option>Accountant</option></select></label>
        <button className="button primary login-submit" onClick={() => onLogin(role)}>Войти</button>
        <small>Демо-режим: данные сохраняются в этом браузере</small>
      </section>
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
      <div className="filter-row"><select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="all">Все объекты</option>{data.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></div>
      <section className="kpi-grid">
        <Kpi label="Всего юнитов" value={String(metrics.totalUnits)} note={`${filtered.locations.length} объекта`} />
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
          <div className="task-list">{dueTasks.map((task) => <div className="task-item" key={task.id}><span className={`task-dot ${task.priority}`} /><span><strong>{task.title}</strong><small>{new Date(task.dueDate) < new Date("2026-07-19T12:00") ? "Просрочено" : new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(task.dueDate))}</small></span></div>)}</div>
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

function Registry({ page, data, search, setSearch, onCustomer, onEdit }: {
  page: Page; data: AppData; search: string; setSearch: (value: string) => void; onCustomer: (id: number) => void; onEdit: (id: number) => void;
}) {
  const q = search.toLowerCase();
  const cell = (value: unknown) => String(value ?? "").toLowerCase().includes(q);
  let headers: string[] = [], rows: { id: number; cells: React.ReactNode[]; customerId?: number }[] = [];
  if (page === "locations") {
    headers = ["Название", "Адрес", "Юниты", "Свободно", "Статус"];
    rows = data.locations.filter((x) => cell(x.name) || cell(x.address)).map((x) => ({ id: x.id, cells: [<strong key="n">{x.name}</strong>, x.address, data.units.filter((u) => u.locationId === x.id).length, data.units.filter((u) => u.locationId === x.id && unitStatus(u.id, data) === "free").length, badge(x.isActive ? "active" : "archived")] }));
  } else if (page === "units") {
    headers = ["Номер", "Объект", "Тип", "Площадь", "Ставка", "Статус"];
    rows = data.units.filter((x) => cell(x.unitNumber)).map((x) => ({ id: x.id, cells: [<strong key="n">{x.unitNumber}</strong>, data.locations.find((l) => l.id === x.locationId)?.name, unitTypeName(x.unitType), `${x.areaSqm} м²`, money(x.monthlyRate), badge(unitStatus(x.id, data))] }));
  } else if (page === "customers") {
    headers = ["Клиент", "Тип", "Телефон", "Email", "Договор", "Задолженность"];
    rows = data.customers.filter((x) => cell(x.fullName) || cell(x.phone) || cell(x.email)).map((x) => {
      const contracts = data.contracts.filter((c) => c.customerId === x.id);
      const ids = contracts.map((c) => c.id);
      const debt = data.charges.filter((c) => ids.includes(c.contractId) && effectiveChargeStatus(c.id, data, new Date("2026-07-19")) === "overdue").reduce((sum, c) => sum + c.amount - chargePaidAmount(c.id, data), 0);
      return { id: x.id, customerId: x.id, cells: [<strong key="n">{x.fullName}</strong>, x.customerType === "business" ? "Компания" : "Физлицо", x.phone, x.email, contracts.find((c) => c.status === "active")?.contractNumber ?? "—", <strong className={debt ? "danger-text" : ""} key="d">{money(debt)}</strong>] };
    });
  } else if (page === "contracts") {
    headers = ["Договор", "Клиент", "Юнит", "Период", "Ставка", "Статус"];
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
    rows = data.tasks.filter((x) => cell(x.title)).map((x) => ({ id: x.id, cells: [<strong key="n">{x.title}</strong>, date(x.dueDate), <span className={`priority ${x.priority}`} key="p">{priorityName(x.priority)}</span>, badge(x.status)] }));
  } else if (page === "users") {
    headers = ["Сотрудник", "Email", "Роль", "Статус"];
    rows = data.users.filter((x) => cell(x.name) || cell(x.email)).map((x) => ({ id: x.id, cells: [<strong key="n">{x.name}</strong>, x.email, x.role, badge(x.isActive ? "active" : "archived")] }));
  }
  return (
    <section>
      <div className="registry-toolbar"><label className="search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск…" /></label><select><option>Все статусы</option><option>Активные</option><option>Архивные</option></select></div>
      <div className="table-card"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>
        {rows.map((row) => <tr key={row.id} onClick={() => row.customerId ? onCustomer(row.customerId) : onEdit(row.id)}>{row.cells.map((value, index) => <td key={index}>{value}</td>)}</tr>)}
      </tbody></table>{!rows.length && <div className="empty">Ничего не найдено</div>}</div>
    </section>
  );
}

function CustomerDetails({ data, customerId, tab, setTab, onBack, onAdd }: {
  data: AppData; customerId: number; tab: string; setTab: (tab: string) => void; onBack: () => void; onAdd: (page: EntityType) => void;
}) {
  const customer = data.customers.find((item) => item.id === customerId)!;
  const contracts = data.contracts.filter((item) => item.customerId === customerId);
  const contractIds = contracts.map((item) => item.id);
  const active = contracts.find((item) => item.status === "active");
  const charges = data.charges.filter((item) => contractIds.includes(item.contractId));
  const payments = data.payments.filter((item) => item.customerId === customerId);
  const documents = data.documents.filter((item) => item.entityType === "customer" && item.entityId === customerId || item.entityType === "contract" && contractIds.includes(item.entityId));
  const tasks = data.tasks.filter((item) => item.relatedEntityType === "customer" && item.relatedEntityId === customerId);
  const debt = charges.filter((charge) => effectiveChargeStatus(charge.id, data, new Date("2026-07-19")) === "overdue").reduce((sum, charge) => sum + charge.amount - chargePaidAmount(charge.id, data), 0);
  return (
    <section>
      <button className="back-button" onClick={onBack}>← Назад к клиентам</button>
      <div className="summary-grid">
        <div><span>Текущий договор</span><strong>{active?.contractNumber ?? "Нет"}</strong></div>
        <div><span>Юнит</span><strong>{active ? data.units.find((unit) => unit.id === active.unitId)?.unitNumber : "—"}</strong></div>
        <div><span>Статус аренды</span>{badge(active ? "active" : "expired")}</div>
        <div><span>Задолженность</span><strong className={debt ? "danger-text" : ""}>{money(debt)}</strong></div>
      </div>
      <div className="detail-tabs">{["contracts", "charges", "payments", "documents", "tasks"].map((id) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{({ contracts: "Договоры", charges: "Начисления", payments: "Оплаты", documents: "Документы", tasks: "Задачи" } as Record<string, string>)[id]}</button>)}</div>
      <div className="detail-content">
        <div className="detail-action"><button className="button" onClick={() => onAdd(tab as EntityType)}><Plus size={16} />Добавить</button></div>
        {tab === "contracts" && <SimpleTable headers={["Договор", "Юнит", "Период", "Ставка", "Статус"]} rows={contracts.map((x) => [x.contractNumber, data.units.find((u) => u.id === x.unitId)?.unitNumber, `${date(x.startDate)} — ${date(x.endDate)}`, money(x.monthlyRate), badge(x.status)])} />}
        {tab === "charges" && <SimpleTable headers={["Период", "Срок", "Сумма", "Оплачено", "Статус"]} rows={charges.map((x) => [`${date(x.periodStart)} — ${date(x.periodEnd)}`, date(x.dueDate), money(x.amount), money(chargePaidAmount(x.id, data)), badge(effectiveChargeStatus(x.id, data, new Date("2026-07-19")))])} />}
        {tab === "payments" && <SimpleTable headers={["Дата", "Способ", "Номер", "Сумма"]} rows={payments.map((x) => [date(x.paymentDate), methodName(x.paymentMethod), x.referenceNumber, money(x.amount)])} />}
        {tab === "documents" && <SimpleTable headers={["Файл", "Тип"]} rows={documents.map((x) => [x.fileName, x.documentType])} />}
        {tab === "tasks" && <SimpleTable headers={["Задача", "Срок", "Статус"]} rows={tasks.map((x) => [x.title, date(x.dueDate), badge(x.status)])} />}
      </div>
    </section>
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length) return <div className="empty">Записей пока нет</div>;
  return <div className="table-card"><table><thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function EntityModal({ modal, data, onClose, onSave }: { modal: Exclude<Modal, null>; data: AppData; onClose: () => void; onSave: (data: AppData, message: string) => void }) {
  const [error, setError] = useState("");
  const [customerId, setCustomerId] = useState(data.customers[0]?.id ?? 0);
  const [contractId, setContractId] = useState(data.contracts.find((c) => c.status === "active")?.id ?? 0);
  const contract = data.contracts.find((item) => item.id === contractId);
  const input = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const next = structuredClone(data);
      if (modal.type === "locations") next.locations.push({ id: nextId(next.locations), name: input(form, "name"), address: input(form, "address"), description: input(form, "description"), isActive: true });
      else if (modal.type === "units") next.units.push({ id: nextId(next.units), locationId: Number(input(form, "locationId")), unitNumber: input(form, "unitNumber"), unitType: input(form, "unitType") as "storage", areaSqm: Number(input(form, "areaSqm")), monthlyRate: Number(input(form, "monthlyRate")), depositAmount: Number(input(form, "depositAmount")), status: "free", note: input(form, "note") });
      else if (modal.type === "customers") next.customers.push({ id: nextId(next.customers), customerType: input(form, "customerType") as "individual", fullName: input(form, "fullName"), phone: input(form, "phone"), email: input(form, "email"), passportOrRegistrationData: input(form, "registration"), taxId: input(form, "taxId"), address: input(form, "address"), note: input(form, "note") });
      else if (modal.type === "contracts") {
        const candidate: Contract = { id: nextId(next.contracts), customerId: Number(input(form, "customerId")), unitId: Number(input(form, "unitId")), contractNumber: input(form, "contractNumber"), startDate: input(form, "startDate"), endDate: input(form, "endDate"), monthlyRate: Number(input(form, "monthlyRate")), depositAmount: Number(input(form, "depositAmount")), billingDay: Number(input(form, "billingDay")), status: input(form, "status") as "active", terminationReason: "", note: input(form, "note") };
        validateActiveContract(candidate, next.contracts); next.contracts.push(candidate);
        if (candidate.status === "active") next.units.find((unit) => unit.id === candidate.unitId)!.status = "occupied";
      } else if (modal.type === "charges") next.charges.push({ id: nextId(next.charges), contractId: Number(input(form, "contractId")), periodStart: input(form, "periodStart"), periodEnd: input(form, "periodEnd"), dueDate: input(form, "dueDate"), amount: Number(input(form, "amount")), chargeType: input(form, "chargeType") as "rent", status: "pending", note: input(form, "note") });
      else if (modal.type === "payments") {
        const chargeId = input(form, "chargeId");
        next.payments.push({ id: nextId(next.payments), customerId: Number(input(form, "customerId")), contractId: Number(input(form, "contractId")), chargeId: chargeId ? Number(chargeId) : null, paymentDate: input(form, "paymentDate"), amount: Number(input(form, "amount")), paymentMethod: input(form, "paymentMethod") as "sbp", referenceNumber: input(form, "referenceNumber"), comment: input(form, "comment") });
        if (chargeId) {
          const charge = next.charges.find((item) => item.id === Number(chargeId))!;
          charge.status = calculateChargeStatus(charge.amount, chargePaidAmount(charge.id, next), charge.dueDate, new Date("2026-07-19"));
        }
      } else if (modal.type === "tasks") next.tasks.push({ id: nextId(next.tasks), title: input(form, "title"), description: input(form, "description"), dueDate: input(form, "dueDate"), priority: input(form, "priority") as "medium", status: "open", relatedEntityType: null, relatedEntityId: null });
      else if (modal.type === "documents") next.documents.push({ id: nextId(next.documents), entityType: "customer", entityId: customerId, fileName: input(form, "fileName"), fileUrl: "#", documentType: input(form, "documentType") as "other" });
      else if (modal.type === "users") next.users.push({ id: nextId(next.users), name: input(form, "name"), email: input(form, "email"), role: input(form, "role") as Role, isActive: true });
      onSave(next, "Запись сохранена");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось сохранить запись"); }
  }
  const title = modal.id ? "Редактирование" : `Новая запись: ${modal.type === "documents" ? "Документы" : titles[modal.type][0]}`;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <form className="modal" onSubmit={submit}>
        <div className="modal-head"><h2>{title}</h2><button type="button" onClick={onClose} aria-label="Закрыть"><X /></button></div>
        <div className="form-grid">
          {modal.type === "locations" && <><Field name="name" label="Название" required /><Field name="address" label="Адрес" required /><Field name="description" label="Описание" wide /></>}
          {modal.type === "units" && <><Select name="locationId" label="Объект" options={data.locations.map((x) => [x.id, x.name])} /><Field name="unitNumber" label="Номер" required /><Select name="unitType" label="Тип" options={[["storage", "Кладовка"], ["garage", "Гараж"], ["box", "Бокс"]]} /><Field name="areaSqm" label="Площадь, м²" type="number" required /><Field name="monthlyRate" label="Ставка, ₽" type="number" required /><Field name="depositAmount" label="Депозит, ₽" type="number" /><Field name="note" label="Примечание" wide /></>}
          {modal.type === "customers" && <><Select name="customerType" label="Тип" options={[["individual", "Физлицо"], ["business", "Компания"]]} /><Field name="fullName" label="Имя / название" required /><Field name="phone" label="Телефон" required /><Field name="email" label="Email" type="email" /><Field name="registration" label="Паспорт / регистрационные данные" wide /><Field name="taxId" label="ИНН" /><Field name="address" label="Адрес" /><Field name="note" label="Примечание" wide /></>}
          {modal.type === "contracts" && <><Select name="customerId" label="Клиент" options={data.customers.map((x) => [x.id, x.fullName])} /><Select name="unitId" label="Свободный юнит" options={data.units.filter((x) => unitStatus(x.id, data) === "free").map((x) => [x.id, x.unitNumber])} /><Field name="contractNumber" label="Номер" required defaultValue={`Д-2026-${String(nextId(data.contracts)).padStart(3, "0")}`} /><Select name="status" label="Статус" options={[["active", "Активен"], ["draft", "Черновик"]]} /><Field name="startDate" label="Дата начала" type="date" required defaultValue={isoToday()} /><Field name="endDate" label="Дата окончания" type="date" required defaultValue="2027-07-18" /><Field name="monthlyRate" label="Ставка, ₽" type="number" required /><Field name="depositAmount" label="Депозит, ₽" type="number" /><Field name="billingDay" label="День начисления" type="number" defaultValue="5" /><Field name="note" label="Примечание" wide /></>}
          {modal.type === "charges" && <><Select name="contractId" label="Активный договор" options={data.contracts.filter((x) => x.status === "active").map((x) => [x.id, x.contractNumber])} /><Select name="chargeType" label="Тип" options={[["rent", "Аренда"], ["deposit", "Депозит"], ["penalty", "Пени"], ["other", "Другое"]]} /><Field name="periodStart" label="Начало периода" type="date" required defaultValue="2026-08-01" /><Field name="periodEnd" label="Конец периода" type="date" required defaultValue="2026-08-31" /><Field name="dueDate" label="Срок оплаты" type="date" required defaultValue="2026-08-05" /><Field name="amount" label="Сумма, ₽" type="number" required /><Field name="note" label="Примечание" wide /></>}
          {modal.type === "payments" && <><label>Клиент<select name="customerId" value={customerId} onChange={(e) => { const id = Number(e.target.value); setCustomerId(id); const c = data.contracts.find((x) => x.customerId === id && x.status === "active"); if (c) setContractId(c.id); }}>{data.customers.map((x) => <option value={x.id} key={x.id}>{x.fullName}</option>)}</select></label><label>Договор<select name="contractId" value={contractId} onChange={(e) => setContractId(Number(e.target.value))}>{data.contracts.filter((x) => x.customerId === customerId).map((x) => <option value={x.id} key={x.id}>{x.contractNumber}</option>)}</select></label><Select name="chargeId" label="Начисление" options={[["", "Без привязки"], ...data.charges.filter((x) => x.contractId === contract?.id).map((x) => [x.id, `${date(x.periodStart)} · ${money(x.amount)}`] as [number, string])]} /><Field name="paymentDate" label="Дата" type="date" required defaultValue={isoToday()} /><Field name="amount" label="Сумма, ₽" type="number" required /><Select name="paymentMethod" label="Способ" options={[["sbp", "СБП"], ["bank_transfer", "Банковский перевод"], ["cash", "Наличные"], ["card", "Карта"], ["other", "Другое"]]} /><Field name="referenceNumber" label="Номер операции" /><Field name="comment" label="Комментарий" wide /></>}
          {modal.type === "tasks" && <><Field name="title" label="Название" required wide /><Field name="dueDate" label="Срок" type="datetime-local" required /><Select name="priority" label="Приоритет" options={[["low", "Низкий"], ["medium", "Средний"], ["high", "Высокий"]]} /><Field name="description" label="Описание" wide /></>}
          {modal.type === "documents" && <><Field name="fileName" label="Название файла" required wide /><Select name="documentType" label="Тип документа" options={[["contract_scan", "Скан договора"], ["receipt", "Квитанция"], ["invoice", "Счёт"], ["other", "Другое"]]} /></>}
          {modal.type === "users" && <><Field name="name" label="Имя" required /><Field name="email" label="Email" type="email" required /><Select name="role" label="Роль" options={[["Admin", "Admin"], ["Manager", "Manager"], ["Accountant", "Accountant"]]} /></>}
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions"><button type="button" className="button" onClick={onClose}>Отмена</button><button className="button primary">Сохранить</button></div>
      </form>
    </div>
  );
}

function Field({ name, label, type = "text", required, wide, defaultValue }: { name: string; label: string; type?: string; required?: boolean; wide?: boolean; defaultValue?: string }) {
  return <label className={wide ? "wide" : ""}>{label}<input name={name} type={type} required={required} defaultValue={defaultValue} /></label>;
}
function Select({ name, label, options }: { name: string; label: string; options: ([string | number, string])[] }) {
  return <label>{label}<select name={name}>{options.map(([value, text]) => <option value={value} key={String(value)}>{text}</option>)}</select></label>;
}
function methodName(value: string) { return ({ cash: "Наличные", bank_transfer: "Банк", sbp: "СБП", card: "Карта", other: "Другое" } as Record<string, string>)[value] ?? value; }
function unitTypeName(value: string) { return ({ storage: "Кладовка", garage: "Гараж", box: "Бокс" } as Record<string, string>)[value] ?? value; }
function priorityName(value: string) { return ({ low: "Низкий", medium: "Средний", high: "Высокий" } as Record<string, string>)[value] ?? value; }
