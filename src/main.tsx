import "./assets/fonts/fonts.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { applyPrefsToDom } from "./settings/applyPrefs";
import { DEFAULT_PREFS } from "./settings/types";

applyPrefsToDom(DEFAULT_PREFS);

document.addEventListener("contextmenu", (e) => e.preventDefault());

window.addEventListener("error", (e) => {
  console.error("Uncaught error", e.error ?? e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled promise rejection", e.reason);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
