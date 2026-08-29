import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { RiLink } from "react-icons/ri";
import type { NoteEditor } from "../schema";

export type WikiLinkPickerOpenOpts = {
  initialLabel: string;
  from: number;
  to: number;
};

export function insertWikiLinkItem(
  editor: NoteEditor,
  openPicker: (opts: WikiLinkPickerOpenOpts) => void,
): DefaultReactSuggestionItem {
  return {
    title: "Insert note link",
    subtext: "Link to a vault note, folder, or document",
    aliases: ["link", "wiki", "note", "wikilink", "ссылка"],
    group: "Links",
    icon: <RiLink size={18} />,
    onItemClick: () => {
      const { from, to } = editor.prosemirrorView.state.selection;
      const initialLabel = editor.getSelectedText()?.trim() ?? "";
      // Let the slash/suggestion menu finish closing before opening the dialog
      // (sync open from Ctrl+Space often loses the state update / selection).
      window.setTimeout(() => {
        openPicker({ initialLabel, from, to });
      }, 0);
    },
  };
}
