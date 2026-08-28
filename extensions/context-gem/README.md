# ContextGem

Chrome extension for English teachers: select text on any page and get an expert breakdown (grammar, usage, teaching tips) powered by Google Gemini.

## Setup

```bash
cd extensions/context-gem
npm install
npm run build
```

Load in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `extensions/context-gem/dist`

## Configure

Open **ContextGem → Options** (or click the extension icon):

- **Google AI API key** — same key as MarkSpace Settings → API keys, or [Google AI Studio](https://aistudio.google.com/apikey)
- **Model** — default `gemini-3.6-flash` (also 3.7 Flash)
- **Explanation language** — English (default) or Russian

## Use

1. Select English text on a web page
2. Right-click:
   - **Explain for class (ContextGem)** — how to deliver the point to students in class
   - **Expert analysis for teacher (ContextGem)** — rigorous linguistic analysis for you as a professional
3. A **floating chat panel** opens **on top of** the page (does not push or resize page content)
4. **Drag** the header to move it; starts near your selection
5. Close with **×** or **Esc**

After installing or updating, **refresh the page once** so the content script loads.

## Development

```bash
npm run dev
```

Reload the extension in `chrome://extensions` after changes.
