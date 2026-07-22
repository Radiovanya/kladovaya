const monthNumbers: Record<string, string> = {
  январь: "01", января: "01", январе: "01", февраль: "02", февраля: "02", феврале: "02",
  март: "03", марта: "03", марте: "03", апрель: "04", апреля: "04", апреле: "04",
  май: "05", мая: "05", мае: "05", июнь: "06", июня: "06", июне: "06",
  июль: "07", июля: "07", июле: "07", август: "08", августа: "08", августе: "08",
  сентябрь: "09", сентября: "09", сентябре: "09", октябрь: "10", октября: "10", октябре: "10",
  ноябрь: "11", ноября: "11", ноябре: "11", декабрь: "12", декабря: "12", декабре: "12"
};

export function normalizeContractText(value: string) {
  return value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/[^a-zа-я0-9]+/gi, "");
}

export function findContractNumber(text: string, contractNumbers: string[]) {
  const normalizedText = normalizeContractText(text);
  return contractNumbers.find((number) => normalizedText.includes(normalizeContractText(number))) ?? null;
}

export function findPaymentPeriod(text: string) {
  const normalized = text.toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
  const labeled = normalized.match(/(?:период|месяц)\s*[:№#-]?\s*([^\n\r]{2,40})/i)?.[1] ?? normalized;
  const yearFirst = labeled.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])\b/);
  if (yearFirst) return `${yearFirst[1]}-${yearFirst[2].padStart(2, "0")}`;
  const monthFirst = labeled.match(/\b(0?[1-9]|1[0-2])[-/.](20\d{2})\b/);
  if (monthFirst) return `${monthFirst[2]}-${monthFirst[1].padStart(2, "0")}`;
  const named = labeled.match(new RegExp(`(?:^|[^а-я])(${Object.keys(monthNumbers).join("|")})\\s+(20\\d{2})(?:$|[^0-9])`, "i"));
  return named ? `${named[2]}-${monthNumbers[named[1].toLocaleLowerCase("ru-RU")]}` : null;
}
