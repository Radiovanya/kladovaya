import type { AppData, DocumentItem } from "./types";

export const MAX_SIGNED_CONTRACTS_PER_CUSTOMER = 3;

export function isStoredContractScan(document: DocumentItem) {
  return document.entityType === "contract" &&
    document.documentType === "contract_scan" &&
    (document.fileUrl.startsWith("indexeddb:") || document.fileUrl.startsWith("https://"));
}

export function customerContractScans(data: AppData, customerId: number) {
  const contractIds = new Set(data.contracts.filter((contract) => contract.customerId === customerId).map((contract) => contract.id));
  return data.documents.filter((document) => contractIds.has(document.entityId) && isStoredContractScan(document));
}

export function eligibleContractsForScan(data: AppData, customerId: number) {
  const scans = customerContractScans(data, customerId);
  const usedContractIds = new Set(scans.map((document) => document.entityId));
  const usedUnitIds = new Set(scans.map((document) => data.contracts.find((contract) => contract.id === document.entityId)?.unitId));
  return data.contracts.filter((contract) =>
    contract.customerId === customerId &&
    !usedContractIds.has(contract.id) &&
    !usedUnitIds.has(contract.unitId)
  );
}

export function validateSignedContractUpload(data: AppData, customerId: number, contractId: number) {
  const scans = customerContractScans(data, customerId);
  if (scans.length >= MAX_SIGNED_CONTRACTS_PER_CUSTOMER) throw new Error("Для клиента уже загружено максимальное количество договоров — 3");
  const eligible = eligibleContractsForScan(data, customerId);
  if (!eligible.some((contract) => contract.id === contractId)) throw new Error("Для этого договора или объекта скан-копия уже загружена");
}
