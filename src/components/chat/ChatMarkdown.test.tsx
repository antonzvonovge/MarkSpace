import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useVaultStore } from "../../store/vaultStore";
import { ChatMarkdown } from "./ChatMarkdown";

vi.mock("../../lib/vaultApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/vaultApi")>();
  return {
    ...actual,
    resolveWikiTarget: vi.fn(),
  };
});

import { resolveWikiTarget } from "../../lib/vaultApi";

const originalOpenNote = useVaultStore.getState().openNote;
const resolveWikiTargetMock = vi.mocked(resolveWikiTarget);

afterEach(() => {
  cleanup();
  useVaultStore.setState({ openNote: originalOpenNote });
  resolveWikiTargetMock.mockReset();
});

describe("ChatMarkdown note references", () => {
  it("renders a vault note reference with an icon and opens the note", async () => {
    const openNote = vi.fn().mockResolvedValue(undefined);
    useVaultStore.setState({ openNote });
    const path = "Клуб Синдикат ИИ/Источники/twitter/2083150944280207562.md";
    resolveWikiTargetMock.mockResolvedValue(path);

    render(<ChatMarkdown text={`Источник: ![[${path}]]`} />);

    const link = screen.getByRole("link", { name: path });
    expect(link.querySelector("svg")).not.toBeNull();
    expect(link.getAttribute("title")).toBe(path);

    fireEvent.click(link);

    await waitFor(() => {
      expect(openNote).toHaveBeenCalledOnce();
      expect(openNote).toHaveBeenCalledWith(path);
    });
  });

  it("links plain [[wiki]] references written without a bang", async () => {
    const openNote = vi.fn().mockResolvedValue(undefined);
    useVaultStore.setState({ openNote });
    const path =
      "Клуб Синдикат ИИ/Источники/architect/Архитектура GenAI приложений LLM бургерный стек.md";
    resolveWikiTargetMock.mockResolvedValue(path);

    render(<ChatMarkdown text={`Заметка создана: [[${path}]].`} />);

    const link = screen.getByRole("link", { name: path });
    expect(link.querySelector("svg")).not.toBeNull();
    fireEvent.click(link);

    await waitFor(() => {
      expect(openNote).toHaveBeenCalledWith(path);
    });
    expect(screen.getByText(/Заметка создана:/)).toBeTruthy();
  });

  it("resolves extension-less wiki targets", async () => {
    const openNote = vi.fn().mockResolvedValue(undefined);
    useVaultStore.setState({ openNote });
    resolveWikiTargetMock.mockResolvedValue("Notes/Welcome.md");

    render(<ChatMarkdown text="См. [[Welcome]]" />);

    fireEvent.click(screen.getByRole("link", { name: "Welcome" }));

    await waitFor(() => {
      expect(openNote).toHaveBeenCalledWith("Notes/Welcome.md");
    });
    expect(resolveWikiTargetMock).toHaveBeenCalledWith("Welcome");
  });

  it("uses the optional display label and falls back when resolve misses", async () => {
    const openNote = vi.fn().mockResolvedValue(undefined);
    useVaultStore.setState({ openNote });
    resolveWikiTargetMock.mockResolvedValue(null);

    render(
      <ChatMarkdown text="См. ![[Sources/example.md|Original source]]" />,
    );

    const link = screen.getByRole("link", { name: "Original source" });
    fireEvent.click(link);

    await waitFor(() => {
      expect(openNote).toHaveBeenCalledWith("Sources/example.md");
    });
  });

  it("renders wiki links whose path contains a literal #", async () => {
    const openNote = vi.fn().mockResolvedValue(undefined);
    useVaultStore.setState({ openNote });
    const path =
      "Клуб Синдикат ИИ/Встречи клуба/#5 Agentic Loops/План презентации - Agentic Loops.md";
    resolveWikiTargetMock.mockResolvedValue(path);

    render(
      <ChatMarkdown
        text={`См. [[${path}|План презентации - Agentic Loops]]`}
      />,
    );

    const link = screen.getByRole("link", {
      name: "План презентации - Agentic Loops",
    });
    fireEvent.click(link);

    await waitFor(() => {
      expect(resolveWikiTargetMock).toHaveBeenCalledWith(path);
      expect(openNote).toHaveBeenCalledWith(path);
    });
  });

  it("leaves note-reference examples inside code untouched", () => {
    render(
      <ChatMarkdown text={"```\n![[Sources/example.md]]\n```\n\n`[[Inline]]`"} />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("![[Sources/example.md]]")).toBeTruthy();
    expect(screen.getByText("[[Inline]]")).toBeTruthy();
  });

  it("renders KaTeX for inline and display math", () => {
    const { container } = render(
      <ChatMarkdown text={"Chloride $Cl^-$ and\n\n$$\nE = mc^2\n$$"} />,
    );
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(container.textContent).not.toContain("$Cl^-$");
  });

  it("renders KaTeX when math contains <", () => {
    const { container } = render(
      <ChatMarkdown text={"threshold $<5$ and $a < b$"} />,
    );
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).not.toContain("$<5$");
  });

  it("renders one-line $$…$$ as display math", () => {
    const { container } = render(
      <ChatMarkdown
        text={
          "$$t_{sleep} = 2^{\\text{attempt}} \\times \\text{base\\_delay} + \\text{random\\_jitter}$$"
        }
      />,
    );
    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(container.querySelector(".katex-error")).toBeNull();
    expect(container.textContent).toMatch(/base_delay/);
  });
});
