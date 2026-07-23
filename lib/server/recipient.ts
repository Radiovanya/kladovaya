import { prisma } from "@/lib/prisma";
import type { AppData } from "@/lib/types";

export async function isContractRecipient(contractNumber: string, recipient: string) {
  const state = await prisma.appState.findUnique({ where: { id: 1 }, select: { payload: true } });
  if (!state) return false;
  const data = state.payload as unknown as AppData;
  const contract = data.contracts?.find((item) => item.contractNumber === contractNumber);
  const customer = contract && data.customers?.find((item) => item.id === contract.customerId);
  return Boolean(customer?.email && customer.email.trim().toLowerCase() === recipient.trim().toLowerCase());
}
