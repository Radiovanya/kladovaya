import assert from "node:assert/strict";
import test from "node:test";
import { generatePurchaseContract, nextPurchaseContractNumber } from "../lib/purchase-document";
import type { PurchaseBuyer, PurchaseDeal, PurchaseSeller } from "../lib/types";

const buyer: PurchaseBuyer = {
  id: 1, label: "Основной", fullName: "Иванов Иван Иванович", passport: "36 00 123456",
  issuedBy: "УМВД России", issueDate: "2020-01-15", departmentCode: "630-001",
  registrationAddress: "г. Тольятти", phone: "+79000000000", email: "buyer@example.ru"
};
const seller: PurchaseSeller = {
  fullName: "Петров Пётр Петрович", passport: "36 01 654321", issuedBy: "УМВД России",
  issueDate: "2019-04-10", departmentCode: "630-002", registrationAddress: "г. Самара",
  phone: "+79110000000", email: "seller@example.ru"
};

test("договор покупки содержит стороны, объект, цену и акт", () => {
  const document = generatePurchaseContract({
    contractNumber: "КП-2026-001", buyer, seller,
    objectDetails: {
      objectType: "кладовка", purpose: "нежилое помещение", areaSqm: 5,
      address: "Тольятти, Автостроителей, 50А", objectNumber: "46",
      cadastralNumber: "63:09:0101155:1368", ownershipBasis: "договор купли-продажи",
      ownershipRegistrationDate: "2020-01-20", ownershipRegistrationNumber: "63-63-09/060/2009-240",
      restrictions: "не зарегистрированы"
    },
    dealDate: "2026-07-29", price: 25000, paymentTerms: "наличными", additionalTerms: ""
  });
  assert.match(document, /Иванов Иван Иванович/);
  assert.match(document, /Петров Пётр Петрович/);
  assert.match(document, /номер объекта: 46/);
  assert.match(document, /63:09:0101155:1368/);
  assert.match(document, /63-63-09\/060\/2009-240/);
  assert.match(document, /25\s000/);
  assert.match(document, /АКТ ПРИЁМА-ПЕРЕДАЧИ/);
});

test("номер договора покупки продолжается внутри года", () => {
  const deals = [
    { contractNumber: "КП-2026-004" },
    { contractNumber: "КП-2025-018" }
  ] as PurchaseDeal[];
  assert.equal(nextPurchaseContractNumber(deals, "2026-07-29"), "КП-2026-005");
});
