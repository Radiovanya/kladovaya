"use client";

import { Download, WifiOff, X } from "lucide-react";
import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches
  || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

export function PwaRegister() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [offline, setOffline] = useState(false);
  const [iosInstall, setIosInstall] = useState(false);
  const [installed, setInstalled] = useState(true);

  useEffect(() => {
    setOffline(!navigator.onLine);
    setInstalled(isStandalone());

    const online = () => setOffline(false);
    const offlineHandler = () => setOffline(true);
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
      setInstalled(false);
    };
    const appInstalled = () => {
      setInstallPrompt(null);
      setInstalled(true);
      setIosInstall(false);
    };

    window.addEventListener("online", online);
    window.addEventListener("offline", offlineHandler);
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", appInstalled);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch(() => undefined);
    }

    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offlineHandler);
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", appInstalled);
    };
  }, []);

  async function install() {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstallPrompt(null);
      return;
    }
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) setIosInstall(true);
  }

  const showIosButton = !installed && /iphone|ipad|ipod/i.test(typeof navigator === "undefined" ? "" : navigator.userAgent);

  return (
    <>
      {offline && <div className="pwa-status" role="status"><WifiOff size={15} />Нет сети — данные доступны только после подключения</div>}
      {!installed && (installPrompt || showIosButton) && (
        <button className="pwa-install" type="button" onClick={install}>
          <Download size={16} />Установить приложение
        </button>
      )}
      {iosInstall && (
        <div className="pwa-ios-hint" role="status">
          <span>В Safari нажмите «Поделиться», затем «На экран Домой».</span>
          <button type="button" onClick={() => setIosInstall(false)} aria-label="Закрыть подсказку"><X size={15} /></button>
        </div>
      )}
    </>
  );
}
