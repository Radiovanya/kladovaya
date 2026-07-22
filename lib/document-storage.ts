const DATABASE_NAME = "kladovaya-files";
const STORE_NAME = "signed-contracts";

interface StoredContractFile {
  id: number;
  blob: Blob;
  fileName: string;
  mimeType: string;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Не удалось открыть хранилище файлов"));
  });
}

function isRemoteStorage() {
  return typeof window !== "undefined" && !window.location.hostname.endsWith("github.io");
}

export async function storeSignedContractFile(id: number, file: File, mimeType = file.type, contractId?: number) {
  if (isRemoteStorage()) {
    const form = new FormData();
    form.set("file", file);
    form.set("contractId", String(contractId ?? ""));
    const response = await fetch("/api/documents", { method: "POST", body: form });
    const payload = await response.json().catch(() => ({})) as { url?: string; error?: string };
    if (!response.ok || !payload.url) throw new Error(payload.error ?? "Не удалось загрузить файл");
    return payload.url;
  }
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ id, blob: file, fileName: file.name, mimeType } satisfies StoredContractFile);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Не удалось сохранить файл"));
  });
  database.close();
  return `indexeddb:${id}`;
}

export async function getSignedContractFile(id: number) {
  const database = await openDatabase();
  const result = await new Promise<StoredContractFile | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result as StoredContractFile | undefined);
    request.onerror = () => reject(request.error ?? new Error("Не удалось прочитать файл"));
  });
  database.close();
  return result;
}

export async function deleteSignedContractFile(id: number, fileUrl?: string) {
  if (fileUrl?.startsWith("/api/documents")) {
    const response = await fetch(fileUrl, { method: "DELETE" });
    if (!response.ok) throw new Error("Не удалось удалить файл из хранилища");
    return;
  }
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Не удалось удалить файл"));
  });
  database.close();
}
