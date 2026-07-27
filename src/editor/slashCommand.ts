import { Extension } from "@tiptap/core";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import type { Editor } from "@tiptap/react";

export type SlashItem = {
  title: string;
  description: string;
  command: (props: { editor: Editor; range: { from: number; to: number } }) => void;
};

const items: SlashItem[] = [
  {
    title: "Text",
    description: "Plain paragraph",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setParagraph().run();
    },
  },
  {
    title: "Heading 1",
    description: "Large section heading",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run();
    },
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run();
    },
  },
  {
    title: "Heading 3",
    description: "Small section heading",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run();
    },
  },
  {
    title: "Bullet list",
    description: "Unordered list",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: "Numbered list",
    description: "Ordered list",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: "To-do list",
    description: "Track tasks",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },
  {
    title: "Quote",
    description: "Capture a quote",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    title: "Code block",
    description: "Fenced code",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
    },
  },
  {
    title: "Divider",
    description: "Horizontal rule",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
];

function filterItems(query: string): SlashItem[] {
  const q = query.toLowerCase();
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q),
  );
}

export const SlashCommand = Extension.create({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        pluginKey: new PluginKey("slashCommand"),
        allowSpaces: true,
        startOfLine: false,
        items: ({ query }) => filterItems(query),
        render: () => {
          let component: HTMLDivElement | null = null;
          let popup: TippyInstance[] | null = null;
          let selected = 0;
          let currentItems: SlashItem[] = [];
          let currentProps: {
            editor: Editor;
            range: { from: number; to: number };
            items: SlashItem[];
          } | null = null;

          const updateSelection = () => {
            if (!component) return;
            Array.from(component.querySelectorAll("button")).forEach((btn, i) => {
              btn.classList.toggle("is-selected", i === selected);
            });
          };

          const renderList = () => {
            if (!component || !currentProps) return;
            component.innerHTML = "";
            if (!currentItems.length) {
              component.innerHTML = `<div class="slash-empty">No matches</div>`;
              return;
            }
            currentItems.forEach((item, index) => {
              const btn = document.createElement("button");
              btn.type = "button";
              btn.className = "slash-item";
              btn.innerHTML = `<strong>${item.title}</strong><span>${item.description}</span>`;
              btn.addEventListener("click", () => {
                item.command(currentProps!);
              });
              if (index === selected) btn.classList.add("is-selected");
              component!.appendChild(btn);
            });
          };

          return {
            onStart: (props) => {
              currentProps = props as typeof currentProps;
              currentItems = props.items as SlashItem[];
              selected = 0;
              component = document.createElement("div");
              component.className = "slash-menu";
              renderList();

              popup = tippy("body", {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
              });
            },
            onUpdate: (props) => {
              currentProps = props as typeof currentProps;
              currentItems = props.items as SlashItem[];
              selected = 0;
              renderList();
              popup?.[0]?.setProps({
                getReferenceClientRect: props.clientRect as () => DOMRect,
              });
            },
            onKeyDown: (props) => {
              if (props.event.key === "ArrowUp") {
                selected = (selected + currentItems.length - 1) % Math.max(currentItems.length, 1);
                updateSelection();
                return true;
              }
              if (props.event.key === "ArrowDown") {
                selected = (selected + 1) % Math.max(currentItems.length, 1);
                updateSelection();
                return true;
              }
              if (props.event.key === "Enter") {
                const item = currentItems[selected];
                if (item && currentProps) item.command(currentProps);
                return true;
              }
              if (props.event.key === "Escape") {
                popup?.[0]?.hide();
                return true;
              }
              return false;
            },
            onExit: () => {
              popup?.[0]?.destroy();
              component = null;
              popup = null;
            },
          };
        },
        command: ({ editor, range, props }) => {
          (props as SlashItem).command({ editor, range });
        },
      } satisfies Partial<SuggestionOptions<SlashItem>>,
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
