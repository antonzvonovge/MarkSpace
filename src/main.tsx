import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyPrefsToDom } from "./settings/applyPrefs";
import { DEFAULT_PREFS } from "./settings/types";

applyPrefsToDom(DEFAULT_PREFS);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
