import type { Location, PurchaseBuyer, PurchaseDeal, PurchaseSeller, Unit } from "./types";

const line = (value: string, fallback = "____________________________") => value.trim() || fallback;
const moneyWordsHint = (amount: number) => new Intl.NumberFormat("ru-RU").format(amount);

export function nextPurchaseContractNumber(deals: PurchaseDeal[], dealDate: string) {
  const year = new Date(`${dealDate}T00:00:00`).getFullYear();
  const used = deals
    .filter((deal) => deal.contractNumber.startsWith(`КП-${year}-`))
    .map((deal) => Number(deal.contractNumber.split("-").at(-1)))
    .filter(Number.isFinite);
  return `КП-${year}-${String(Math.max(0, ...used) + 1).padStart(3, "0")}`;
}

export function generatePurchaseContract(input: {
  contractNumber: string;
  buyer: PurchaseBuyer;
  seller: PurchaseSeller;
  unit: Unit;
  location: Location;
  dealDate: string;
  price: number;
  paymentTerms: string;
  additionalTerms: string;
}) {
  const { contractNumber, buyer, seller, unit, location, dealDate, price, paymentTerms, additionalTerms } = input;
  const formattedDate = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric" })
    .format(new Date(`${dealDate}T00:00:00`));
  const objectType = unit.unitType === "garage" ? "гараж" : unit.unitType === "box" ? "бокс" : "кладовую";

  return `# ДОГОВОР КУПЛИ-ПРОДАЖИ № ${contractNumber}

г. ____________________                                      ${formattedDate}

${line(seller.fullName)}, именуемый(ая) в дальнейшем «Продавец», с одной стороны, и ${line(buyer.fullName)}, именуемый(ая) в дальнейшем «Покупатель», с другой стороны, совместно именуемые «Стороны», заключили настоящий договор о нижеследующем.

## 1. Предмет договора

1.1. Продавец обязуется передать в собственность Покупателю, а Покупатель обязуется принять и оплатить ${objectType} № ${line(unit.unitNumber)}, площадью ${unit.areaSqm} кв. м, расположенную(ый) по адресу: ${line(location.address)}.

1.2. Продавец подтверждает, что на дату подписания договора объект не продан, не заложен, не находится под арестом или запретом, не является предметом спора и не обременён правами третьих лиц, кроме прямо указанных в настоящем договоре.

1.3. Покупатель осмотрел объект, ознакомился с его состоянием и характеристиками и не имеет претензий к видимым недостаткам.

## 2. Цена и порядок расчётов

2.1. Цена объекта составляет ${moneyWordsHint(price)} (${line(String(price))}) рублей.

2.2. Порядок расчётов: ${line(paymentTerms, "полная оплата в день подписания договора")}.

2.3. Обязательство Покупателя по оплате считается исполненным с момента передачи денежных средств Продавцу либо зачисления полной суммы на указанный Продавцом счёт.

## 3. Передача объекта

3.1. Передача объекта, ключей и иных средств доступа производится по акту приёма-передачи.

3.2. Риск случайной гибели или повреждения объекта переходит к Покупателю с момента подписания акта приёма-передачи.

3.3. Вместе с объектом Продавец передаёт имеющиеся документы и сведения, необходимые для его использования.

## 4. Заявления и гарантии сторон

4.1. Каждая Сторона подтверждает свою дееспособность, добровольность заключения договора и достоверность предоставленных данных.

4.2. Продавец обязуется урегулировать требования третьих лиц, возникшие из обстоятельств, существовавших до передачи объекта.

4.3. Стороны подтверждают, что условия договора им понятны, договор не является мнимой или притворной сделкой.

## 5. Ответственность и споры

5.1. За нарушение обязательств Стороны несут ответственность в соответствии с законодательством Российской Федерации.

5.2. Споры разрешаются путём переговоров, а при недостижении соглашения — в суде по правилам действующего законодательства.

## 6. Заключительные положения

6.1. Договор вступает в силу с момента подписания Сторонами.

6.2. Договор составлен в двух экземплярах равной юридической силы, по одному для каждой Стороны.

6.3. Дополнительные условия: ${line(additionalTerms, "отсутствуют")}.

## 7. Реквизиты и подписи сторон

### Продавец

ФИО: ${line(seller.fullName)}

Паспорт: ${line(seller.passport)}

Выдан: ${line(seller.issuedBy)}

Дата выдачи: ${line(seller.issueDate)}   Код подразделения: ${line(seller.departmentCode)}

Адрес регистрации: ${line(seller.registrationAddress)}

Телефон: ${line(seller.phone)}   E-mail: ${line(seller.email)}

Подпись: __________________ / ${line(seller.fullName)}

### Покупатель

ФИО: ${line(buyer.fullName)}

Паспорт: ${line(buyer.passport)}

Выдан: ${line(buyer.issuedBy)}

Дата выдачи: ${line(buyer.issueDate)}   Код подразделения: ${line(buyer.departmentCode)}

Адрес регистрации: ${line(buyer.registrationAddress)}

Телефон: ${line(buyer.phone)}   E-mail: ${line(buyer.email)}

Подпись: __________________ / ${line(buyer.fullName)}

---

# АКТ ПРИЁМА-ПЕРЕДАЧИ

к договору купли-продажи № ${contractNumber} от ${formattedDate}

Продавец передал, а Покупатель принял ${objectType} № ${line(unit.unitNumber)}, площадью ${unit.areaSqm} кв. м, расположенную(ый) по адресу: ${line(location.address)}.

Покупатель подтверждает, что объект осмотрен, его состояние известно, ключи и средства доступа получены, претензий по комплектности и видимому состоянию нет.

Продавец: __________________ / ${line(seller.fullName)}

Покупатель: __________________ / ${line(buyer.fullName)}
`;
}
