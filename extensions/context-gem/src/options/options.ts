import { loadSettings, saveSettings } from "../lib/storage";
import { MODEL_OPTIONS, type ExplanationLanguage } from "../lib/types";

const form = document.getElementById("settings-form") as HTMLFormElement;
const apiKeyInput = document.getElementById(
  "google-api-key",
) as HTMLInputElement;
const modelSelect = document.getElementById("model") as HTMLSelectElement;
const statusEl = document.getElementById("status") as HTMLElement;

function applyTheme(): void {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = prefersDark ? "dark" : "light";
}

function populateModels(selected: string): void {
  modelSelect.innerHTML = "";
  for (const option of MODEL_OPTIONS) {
    const el = document.createElement("option");
    el.value = option.id;
    el.textContent = option.label;
    if (option.id === selected) el.selected = true;
    modelSelect.appendChild(el);
  }
}

function setStatus(message: string, kind: "idle" | "success" | "error"): void {
  statusEl.textContent = message;
  statusEl.className = "status";
  if (kind === "success") statusEl.classList.add("is-success");
  if (kind === "error") statusEl.classList.add("is-error");
}

async function loadForm(): Promise<void> {
  const settings = await loadSettings();
  apiKeyInput.value = settings.googleApiKey;
  populateModels(settings.model);
  const radio = form.querySelector<HTMLInputElement>(
    `input[name="explanationLanguage"][value="${settings.explanationLanguage}"]`,
  );
  if (radio) radio.checked = true;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const language = (
    form.querySelector(
      'input[name="explanationLanguage"]:checked',
    ) as HTMLInputElement
  ).value as ExplanationLanguage;

  try {
    await saveSettings({
      googleApiKey: apiKeyInput.value.trim(),
      model: modelSelect.value,
      explanationLanguage: language === "ru" ? "ru" : "en",
    });
    setStatus("Saved.", "success");
  } catch {
    setStatus("Could not save settings.", "error");
  }
});

applyTheme();
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", applyTheme);

void loadForm();
