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

export async function storeSignedContractFile(id: number, file: File, mimeType = file.type) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ id, blob: file, fileName: file.name, mimeType } satisfies StoredContractFile);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Не удалось сохранить файл"));
  });
  database.close();
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

export async function deleteSignedContractFile(id: number) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Не удалось удалить файл"));
  });
  database.close();
}
