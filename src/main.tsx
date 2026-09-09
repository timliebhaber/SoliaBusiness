import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./lib/toast";
import { StoreProvider } from "./lib/store";
import "./styles/global.css";

const container = document.getElementById("root");
if (!container) throw new Error("Wurzelelement #root fehlt im Dokument");

createRoot(container).render(
  <StrictMode>
    <ToastProvider>
      <StoreProvider>
        <App />
      </StoreProvider>
    </ToastProvider>
  </StrictMode>,
);
