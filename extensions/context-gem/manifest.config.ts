import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "ContextGem",
  description:
    "Expert English breakdown for selected text — for language teachers.",
  version: "0.1.0",
  permissions: ["contextMenus", "storage"],
  host_permissions: [
    "https://generativelanguage.googleapis.com/*",
    "http://*/*",
    "https://*/*",
  ],
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["src/content/panel.ts"],
      run_at: "document_idle",
    },
  ],
  action: {
    default_title: "ContextGem Settings",
    default_icon: {
      "16": "public/icons/icon16.png",
      "48": "public/icons/icon48.png",
      "128": "public/icons/icon128.png",
    },
  },
  icons: {
    "16": "public/icons/icon16.png",
    "48": "public/icons/icon48.png",
    "128": "public/icons/icon128.png",
  },
  options_page: "src/options/options.html",
});
