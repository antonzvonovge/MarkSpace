import { writeText } from "@tauri-apps/plugin-clipboard-manager";

/** Write plain text to the system clipboard (Tauri, then browser fallback). */
export async function writeClipboardText(text: string): Promise<void> {
  try {
    await writeText(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

/**
 * Copy HTML + plain text. Prefer a synchronous `copy` event (button click)
 * so GTK/WebKit gets text/html, not only Tauri's plain-text write.
 */
export async function writeClipboardHtml(
  html: string,
  plain: string,
): Promise<void> {
  if (copyHtmlViaExecCommand(html, plain)) return;

  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      // fall through
    }
  }

  await writeClipboardText(plain);
}

function copyHtmlViaExecCommand(html: string, plain: string): boolean {
  const onCopy = (event: ClipboardEvent) => {
    event.preventDefault();
    event.clipboardData?.setData("text/html", html);
    event.clipboardData?.setData("text/plain", plain);
  };
  document.addEventListener("copy", onCopy, true);
  try {
    return document.execCommand("copy");
  } finally {
    document.removeEventListener("copy", onCopy, true);
  }
}
