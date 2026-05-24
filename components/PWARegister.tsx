"use client";

import { useEffect } from "react";

export default function PWARegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      const timer = setTimeout(() => {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, []);
  return null;
}
