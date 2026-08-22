import {
  editorHasBlockWithType,
  type Block,
} from "@blocknote/core";
import { SideMenuExtension } from "@blocknote/core/extensions";
import {
  BlockColorsItem,
  DragHandleMenu,
  RemoveBlockItem,
  SideMenu,
  TableColumnHeaderItem,
  TableRowHeaderItem,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useExtensionState,
} from "@blocknote/react";

type AnyEditor = any;
type AnyBlock = Block<any, any, any>;

function MenuDivider() {
  const Components = useComponentsContext()!;
  return <Components.Generic.Menu.Divider />;
}

function hasInlineContent(block: AnyBlock): boolean {
  return Array.isArray(block.content);
}

function getHandleTargetBlocks(editor: AnyEditor, block: AnyBlock): AnyBlock[] {
  const selected = editor.getSelection()?.blocks;
  if (selected && selected.some((b: AnyBlock) => b.id === block.id)) {
    return selected;
  }
  return [block];
}

function copyHandleBlocks(editor: AnyEditor, block: AnyBlock): boolean {
  const blocks = getHandleTargetBlocks(editor, block);
  if (blocks.length === 0) return false;
  editor.focus();
  editor.setSelection(blocks[0]!.id, blocks[blocks.length - 1]!.id);
  return document.execCommand("copy");
}

function useHandleBlock(): AnyBlock | undefined {
  const editor = useBlockNoteEditor();
  return useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block as AnyBlock | undefined,
  });
}

function TurnIntoItem() {
  const Components = useComponentsContext()!;
  const dict = useDictionary();
  const editor = useBlockNoteEditor();
  const block = useHandleBlock();

  if (block === undefined) return null;

  const targets = getHandleTargetBlocks(editor, block).filter(hasInlineContent);
  if (targets.length === 0) return null;

  const first = targets[0]!;
  const items = [
    { label: dict.slash_menu.paragraph.title, type: "paragraph" },
    {
      label: dict.slash_menu.heading.title,
      type: "heading",
      props: { level: 1, isToggleable: false },
    },
    {
      label: dict.slash_menu.heading_2.title,
      type: "heading",
      props: { level: 2, isToggleable: false },
    },
    {
      label: dict.slash_menu.heading_3.title,
      type: "heading",
      props: { level: 3, isToggleable: false },
    },
    { label: dict.slash_menu.quote.title, type: "quote" },
    { label: dict.slash_menu.bullet_list.title, type: "bulletListItem" },
    { label: dict.slash_menu.numbered_list.title, type: "numberedListItem" },
    { label: dict.slash_menu.check_list.title, type: "checkListItem" },
  ].filter((item) =>
    editorHasBlockWithType(
      editor as any,
      item.type,
      Object.fromEntries(
        Object.entries(item.props || {}).map(([name, value]) => [
          name,
          typeof value,
        ]),
      ) as Record<string, "string" | "number" | "boolean">,
    ),
  );

  if (items.length === 0) return null;

  return (
    <Components.Generic.Menu.Root position="right" sub={true}>
      <Components.Generic.Menu.Trigger sub={true}>
        <Components.Generic.Menu.Item className="bn-menu-item" subTrigger={true}>
          Turn into
        </Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown
        sub={true}
        className="bn-menu-dropdown bn-drag-handle-turn-into"
      >
        {items.map((item) => {
          const typesMatch = item.type === first.type;
          const propsMatch =
            Object.entries(item.props || {}).filter(
              ([name, value]) => value !== (first.props as Record<string, unknown>)[name],
            ).length === 0;
          return (
            <Components.Generic.Menu.Item
              key={`${item.type}:${JSON.stringify(item.props ?? {})}`}
              className="bn-menu-item"
              checked={typesMatch && propsMatch ? true : false}
              onClick={() => {
                editor.focus();
                editor.transact(() => {
                  for (const target of targets) {
                    editor.updateBlock(target, {
                      type: item.type as any,
                      props: item.props as any,
                    });
                  }
                });
              }}
            >
              {item.label}
            </Components.Generic.Menu.Item>
          );
        })}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}

function InsertItem({
  placement,
  label,
}: {
  placement: "before" | "after";
  label: string;
}) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const block = useHandleBlock();

  if (block === undefined) return null;

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => {
        const blocks = getHandleTargetBlocks(editor, block);
        const reference =
          placement === "before" ? blocks[0]! : blocks[blocks.length - 1]!;
        const inserted = editor.insertBlocks(
          [{ type: "paragraph" }],
          reference,
          placement,
        )[0];
        if (inserted) editor.setTextCursorPosition(inserted);
        editor.focus();
      }}
    >
      {label}
    </Components.Generic.Menu.Item>
  );
}

function CutCopyItem({ action }: { action: "cut" | "copy" }) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const block = useHandleBlock();

  if (block === undefined) return null;

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => {
        const copied = copyHandleBlocks(editor, block);
        if (!copied) return;
        if (action === "cut") {
          editor.removeBlocks(getHandleTargetBlocks(editor, block));
        }
      }}
    >
      {action === "cut" ? "Cut" : "Copy"}
    </Components.Generic.Menu.Item>
  );
}

export function NoteDragHandleMenu() {
  const dict = useDictionary();

  return (
    <DragHandleMenu>
      <TurnIntoItem />
      <InsertItem placement="before" label="Insert above" />
      <InsertItem placement="after" label="Insert below" />
      <MenuDivider />
      <CutCopyItem action="cut" />
      <CutCopyItem action="copy" />
      <MenuDivider />
      <BlockColorsItem>{dict.drag_handle.colors_menuitem}</BlockColorsItem>
      <RemoveBlockItem>{dict.drag_handle.delete_menuitem}</RemoveBlockItem>
      <TableRowHeaderItem>
        {dict.drag_handle.header_row_menuitem}
      </TableRowHeaderItem>
      <TableColumnHeaderItem>
        {dict.drag_handle.header_column_menuitem}
      </TableColumnHeaderItem>
    </DragHandleMenu>
  );
}

export function NoteSideMenu() {
  return <SideMenu dragHandleMenu={NoteDragHandleMenu} />;
}
