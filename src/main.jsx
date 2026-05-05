import React from "react";
import { createRoot } from "react-dom/client";
import PencilRoomZFoldPinchPWA from "./App.jsx";
import "./styles.css";

const APP_VERSION = "v5.4.0";
window.__PENCIL_ROOM_VERSION__ = APP_VERSION;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PencilRoomZFoldPinchPWA />
  </React.StrictMode>
);

function notifyUpdateAvailable(registration) {
  window.dispatchEvent(new CustomEvent("pencilroom:update-available", { detail: { registration, version: APP_VERSION } }));
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(APP_VERSION)}`, {
        updateViaCache: "none",
      });

      await registration.update();

      if (registration.waiting) notifyUpdateAvailable(registration);

      registration.addEventListener("updatefound", () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;

        installingWorker.addEventListener("statechange", () => {
          if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
            notifyUpdateAvailable(registration);
          }
        });
      });

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (window.__PENCIL_ROOM_RELOADING_FOR_UPDATE__) return;
        window.__PENCIL_ROOM_RELOADING_FOR_UPDATE__ = true;
        window.location.reload();
      });
    } catch (error) {
      console.warn("Service worker registration failed:", error);
    }
  });
}
