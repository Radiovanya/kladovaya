import type { AppData, Contract, LandlordProfile, LandlordType } from "./types";

const ruDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  const monthName = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"][month - 1];
  return `«${String(day).padStart(2, "0")}» ${monthName} ${year} г.`;
};

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
const cardNumber = (value: string) => value.replace(/\D/g, "").replace(/(.{4})(?=.)/g, "$1 ");

export function nextContractNumber(contracts: Contract[], now = new Date()) {
  const year = now.getFullYear();
  const maximum = contracts.reduce((max, contract) => {
    const match = contract.contractNumber.match(/^Д-(\d{4})-(\d+)$/);
    return match && Number(match[1]) === year ? Math.max(max, Number(match[2])) : max;
  }, 0);
  return `Д-${year}-${String(maximum + 1).padStart(3, "0")}`;
}

function replaceFirst(source: string, search: string | RegExp, replacement: string) {
  return source.replace(search, replacement);
}

export function generateRentalContract(template: string, data: AppData, contractId: number, landlordType: LandlordType = "entrepreneur") {
  const contract = data.contracts.find((item) => item.id === contractId);
  if (!contract) throw new Error("Договор не найден");
  const customer = data.customers.find((item) => item.id === contract.customerId);
  const unit = data.units.find((item) => item.id === contract.unitId);
  const location = unit ? data.locations.find((item) => item.id === unit.locationId) : undefined;
  if (!customer || !unit || !location) throw new Error("Не хватает данных клиента или объекта");

  const forms = unit.unitType === "garage"
    ? { title: "гаража", nominative: "Гараж", genitive: "Гаража", accusative: "Гараж", lower: "гараж", located: "расположенный" }
    : unit.unitType === "box"
      ? { title: "бокса", nominative: "Бокс", genitive: "Бокса", accusative: "Бокс", lower: "бокс", located: "расположенный" }
      : { title: "кладовой", nominative: "Кладовая", genitive: "Кладовой", accusative: "Кладовую", lower: "кладовую", located: "расположенную" };
  const city = location.address.split(",")[0]?.trim() || "__________";
  const entrepreneurFallback: LandlordProfile = {
    fullName: data.paymentSettings?.recipientName || "ИП Маньковский Алексей Александрович",
    passport: "", registrationAddress: "", phone: "+79033314445",
    email: data.paymentSettings?.receiptEmail || "payments@klad-v.ru",
    taxId: data.paymentSettings?.taxId || "632139808096", bankName: "", cardNumber: ""
  };
  const individualFallback: LandlordProfile = {
    fullName: "", passport: "", registrationAddress: "", phone: "", email: "", taxId: "", bankName: "", cardNumber: ""
  };
  const landlord = landlordType === "individual"
    ? (data.landlordSettings?.individual ?? individualFallback)
    : (data.landlordSettings?.entrepreneur ?? entrepreneurFallback);
  const landlordName = landlord.fullName || "____________________________________________";
  const landlordIntro = landlordType === "individual"
    ? `${landlordName}, паспорт: ${landlord.passport || "____________________________"}, зарегистрированный по адресу: ${landlord.registrationAddress || "____________________________________________"}`
    : `${landlordName}, ИНН: ${landlord.taxId || "____________________________"}`;
  const notes = [
    customer.note && `Примечание к клиенту: ${customer.note}`,
    location.description && `Описание адреса: ${location.description}`,
    unit.note && `Примечание к объекту: ${unit.note}`,
    contract.note && `Примечание к договору: ${contract.note}`
  ].filter(Boolean);
  const objectDetails = `${forms.nominative} № ${unit.unitNumber}, тип: ${unit.unitType === "storage" ? "кладовка" : unit.unitType === "garage" ? "гараж" : "бокс"}, площадь: ${number(unit.areaSqm)} кв. м`;

  let result = template.replace(/\[file:\d+\]/g, "");
  result = result.replace(/## Редакционные замечания к применению шаблона[\s\S]*?(?=# Приложение № 2)/, "");
  result = result
    .replace(/^# Договор аренды кладовой$/m, `# Договор аренды ${forms.title} № ${contract.contractNumber}`)
    .replaceAll("Кладовую", forms.accusative)
    .replaceAll("Кладовой", forms.genitive)
    .replaceAll("Кладовая", forms.nominative)
    .replaceAll("кладовую", forms.lower)
    .replaceAll("кладовой", forms.title);

  result = replaceFirst(result, /г\. ____________  \n«___» __________ 20___ г\./, `г. ${city}  \n${ruDate(contract.startDate)}`);
  result = result.replace(/г\. ____________  \n«___» __________ 20___ г\./g, `г. ${city}  \n${ruDate(contract.startDate)}`);
  result = replaceFirst(
    result,
    /\*\*Арендодатель:\*\*[\s\S]*?совместно именуемые «Стороны», заключили настоящий договор о нижеследующем\./,
    `**Арендодатель:** ${landlordIntro}, с одной стороны, и  \n**Арендатор:** ${customer.fullName}, ${customer.passportOrRegistrationData || customer.taxId || "паспорт/реквизиты не указаны"}, с другой стороны, совместно именуемые «Стороны», заключили настоящий договор о нижеследующем.`
  );
  result = replaceFirst(
    result,
    /1\.1\.[\s\S]*?далее — «[^»]+»\./,
    `1.1. Арендодатель предоставляет Арендатору за плату во временное владение и пользование ${forms.lower}, ${forms.located} по адресу: ${location.address}, номер: ${unit.unitNumber}, площадь: ${number(unit.areaSqm)} кв. м, далее — «${forms.nominative}».${location.description ? ` Описание адреса: ${location.description}.` : ""}${unit.note ? ` Примечание к объекту: ${unit.note}.` : ""}`
  );
  result = replaceFirst(result, /3\.1\. Срок аренды устанавливается[^\n]*/, `3.1. Срок аренды устанавливается с ${ruDate(contract.startDate)} по ${ruDate(contract.endDate)}`);
  result = replaceFirst(result, /4\.1\. Размер арендной платы составляет[^\n]*/, `4.1. Размер арендной платы составляет ${number(unit.monthlyRate)} рублей в месяц.`);
  result = replaceFirst(result, /4\.2\. Арендная плата вносится авансом не позднее[^\n]*/, `4.2. Арендная плата вносится авансом не позднее ${contract.billingDay}-го числа оплачиваемого периода путем перечисления денежных средств по реквизитам Арендодателя либо иным согласованным способом.`);
  result = replaceFirst(result, /4\.4\. Помимо арендной платы, Арендатор вносит обеспечительный платеж в размере[^\n]*/, `4.4. Помимо арендной платы, Арендатор вносит обеспечительный платеж в размере ${number(unit.depositAmount)} рублей в целях обеспечения исполнения обязательств по настоящему договору, в том числе обязательств по оплате аренды, неустойки, возмещению убытков и иных платежей.`);
  result = replaceFirst(result, /13\.1\. Все уведомления и сообщения по настоящему договору могут направляться:\n- по электронной почте:[^\n]*\n- посредством смс-сообщений на номер телефона:[^\n]*/, `13.1. Все уведомления и сообщения по настоящему договору могут направляться:\n- по электронной почте: ${customer.email || "не указана"};\n- посредством смс-сообщений на номер телефона: ${customer.phone || "не указан"}.`);

  const landlordDetails = landlordType === "individual"
    ? `**Арендодатель**  \nФИО: ${landlordName}  \nПаспорт: ${landlord.passport || "не указан"}  \nМесто регистрации: ${landlord.registrationAddress || "не указано"}  \nТелефон: ${landlord.phone || "не указан"}  \nE-mail: ${landlord.email || "не указан"}  \nБанк: ${landlord.bankName || "не указан"}  \nНомер карты: ${landlord.cardNumber ? cardNumber(landlord.cardNumber) : "не указан"}  \nПодпись: ___________________/___________________`
    : `**Арендодатель**  \n${landlordName}  \nИНН: ${landlord.taxId || "не указан"}  \nТелефон: ${landlord.phone || "не указан"}  \nE-mail: ${landlord.email || "не указан"}  \nПодпись: ___________________/___________________`;
  const tenantDetails = `**Арендатор**  \nФИО/Наименование: ${customer.fullName}  \nАдрес: ${customer.address || "не указан"}  \nПаспорт/ИНН/ОГРН: ${customer.passportOrRegistrationData || customer.taxId || "не указаны"}  \nТелефон: ${customer.phone || "не указан"}  \nE-mail: ${customer.email || "не указан"}${customer.note ? `  \nПримечание: ${customer.note}` : ""}  \nПодпись: ___________________/___________________`;
  result = replaceFirst(result, /\*\*Арендодатель\*\*  \n[\s\S]*?(?=\n\n\*\*Арендатор\*\*)/, landlordDetails);
  result = replaceFirst(result, /\*\*Арендатор\*\*  \nФИО\/Наименование:[\s\S]*?Подпись: ___________________\/___________________/, tenantDetails);

  result = result.replace(
    /Арендодатель передал, а Арендатор принял [^\n]+/,
    `Арендодатель передал, а Арендатор принял ${forms.accusative} по адресу: ${location.address}, номер: ${unit.unitNumber}, площадь: ${number(unit.areaSqm)} кв. м.`
  );
  result = result
    .replace(/1\.1\. Базовая арендная плата[^\n]*/, `1.1. Базовая арендная плата за пользование объектом составляет ${number(unit.monthlyRate)} рублей в месяц.`)
    .replace(/2\.1\. Обеспечительный платеж составляет[^\n]*/, `2.1. Обеспечительный платеж составляет ${number(unit.depositAmount)} рублей и вносится до передачи объекта Арендатору.`)
    .replace(/3\.3\. Исходя из базовой месячной ставки[^\n]*/, `3.3. Размер платы по пункту 3.2 составляет ${number(unit.monthlyRate * 0.1)} рублей за каждый день просрочки освобождения объекта.`);

  const summary = `\n\n## Сведения из системы\n\n- Номер договора: ${contract.contractNumber}\n- Арендодатель: ${landlordName} (${landlordType === "individual" ? "физическое лицо" : "индивидуальный предприниматель"})\n- Арендатор: ${customer.fullName}\n- Телефон: ${customer.phone || "не указан"}\n- E-mail: ${customer.email || "не указан"}\n- Паспорт/реквизиты: ${customer.passportOrRegistrationData || customer.taxId || "не указаны"}\n- Адрес арендатора: ${customer.address || "не указан"}\n- Адрес объекта: ${location.address}\n- ${objectDetails}\n- Арендная ставка: ${number(unit.monthlyRate)} рублей в месяц\n- Депозит: ${number(unit.depositAmount)} рублей\n- Период: ${ruDate(contract.startDate)} — ${ruDate(contract.endDate)}${notes.length ? `\n- ${notes.join("\n- ")}` : ""}\n`;
  return result.replace("\n## 1. Предмет договора", `${summary}\n## 1. Предмет договора`).trim() + "\n";
}

export function contractFileName(contractNumber: string) {
  return `dogovor-${contractNumber.replace(/[^a-zA-Zа-яА-Я0-9-]+/g, "-")}.md`;
}
