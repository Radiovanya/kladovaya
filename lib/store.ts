"use client";

import { useEffect, useState } from "react";
import { syncMonthlyPaymentTasks } from "./business";
import { seedData } from "./seed";
import type { AppData } from "./types";

const STORAGE_KEY = "kladovaya-demo-v1";
const cloneSeed = () => JSON.parse(JSON.stringify(seedData)) as AppData;
const isStaticDemo = () => {
  if (typeof window === "undefined") return false;
  return window.location.hostname.endsWith("github.io")
    || window.location.hostname === "localhost"
    || window.location.hostname === "127.0.0.1";
};

export function useAppStore() {
  const [data, setData] = useState<AppData>(cloneSeed);
  const [ready, setReady] = useState(false);
  const [remote, setRemote] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function load() {
    setSaveError("");
    if (isStaticDemo()) {
      const stored = localStorage.getItem(STORAGE_KEY);
      const hydrated = stored
        ? (() => {
          const parsed = JSON.parse(stored) as AppData;
          return {
          ...cloneSeed(),
          ...parsed,
          paymentSettings: { ...seedData.paymentSettings!, ...(parsed.paymentSettings ?? {}) },
          landlordSettings: {
            individual: { ...seedData.landlordSettings!.individual, ...(parsed.landlordSettings?.individual ?? {}) },
            entrepreneur: { ...seedData.landlordSettings!.entrepreneur, ...(parsed.landlordSettings?.entrepreneur ?? {}) }
          },
          paymentRequests: parsed.paymentRequests ?? []
          };
        })()
        : cloneSeed();
      setData(syncMonthlyPaymentTasks(hydrated, new Date()));
      setReady(true);
      setRemote(false);
      return;
    }
    const response = await fetch("/api/state", { cache: "no-store" });
    if (response.status === 401) { setReady(true); setRemote(false); return; }
    const payload = await response.json().catch(() => ({})) as { data?: AppData; error?: string };
    if (!response.ok || !payload.data) throw new Error(payload.error ?? "Не удалось загрузить данные");
    setData(syncMonthlyPaymentTasks(payload.data, new Date()));
    setRemote(true);
    setReady(true);
  }

  useEffect(() => {
    load().catch((error) => { setSaveError(error instanceof Error ? error.message : "Не удалось загрузить данные"); setReady(true); });
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!remote) {
      if (isStaticDemo()) localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
        signal: controller.signal
      }).then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(payload.error ?? "Не удалось сохранить изменения");
        }
        setSaveError("");
      }).catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSaveError(error instanceof Error ? error.message : "Не удалось сохранить изменения");
      });
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [data, ready, remote]);

  return {
    data,
    setData,
    ready,
    saveError,
    reload: load,
    isDemo: isStaticDemo,
    reset: () => {
      const next = syncMonthlyPaymentTasks(cloneSeed(), new Date());
      setData(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  };
}
