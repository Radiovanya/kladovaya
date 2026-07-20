"use client";

import { useEffect, useState } from "react";
import { seedData } from "./seed";
import type { AppData } from "./types";

const STORAGE_KEY = "kladovaya-demo-v1";
const cloneSeed = () => JSON.parse(JSON.stringify(seedData)) as AppData;

export function useAppStore() {
  const [data, setData] = useState<AppData>(cloneSeed);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setData(JSON.parse(stored) as AppData);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data, ready]);

  return {
    data,
    setData,
    reset: () => {
      const next = cloneSeed();
      setData(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  };
}
