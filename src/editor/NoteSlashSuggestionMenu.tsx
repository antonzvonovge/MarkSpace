import { mergeCSSClasses } from "@blocknote/core";
import {
  useComponentsContext,
  useDictionary,
  type DefaultReactSuggestionItem,
  type SuggestionMenuProps,
} from "@blocknote/react";
import { useMemo, type JSX } from "react";

/**
 * Same as BlockNote's SuggestionMenu, but labels get unique keys so React
 * doesn't reuse/duplicate group headers when the filtered list changes.
 */
export function NoteSlashSuggestionMenu(
  props: SuggestionMenuProps<DefaultReactSuggestionItem>,
) {
  const Components = useComponentsContext()!;
  const dict = useDictionary();
  const { items, loadingState, selectedIndex, onItemClick } = props;

  const loader =
    loadingState === "loading-initial" || loadingState === "loading" ? (
      <Components.SuggestionMenu.Loader
        className="bn-suggestion-menu-loader"
      />
    ) : null;

  const renderedItems = useMemo(() => {
    let currentGroup: string | undefined;
    const out: JSX.Element[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.group !== currentGroup) {
        currentGroup = item.group;
        out.push(
          <Components.SuggestionMenu.Label
            className="bn-suggestion-menu-label"
            key={`label-${currentGroup}-${i}`}
          >
            {currentGroup}
          </Components.SuggestionMenu.Label>,
        );
      }

      const tip = item.subtext
        ? `${item.title} — ${item.subtext}`
        : item.title;
      out.push(
        <div
          key={`item-${item.title}-${i}`}
          className="bn-slash-item-tip"
          title={tip}
        >
          <Components.SuggestionMenu.Item
            className={mergeCSSClasses(
              "bn-suggestion-menu-item",
              item.size === "small" ? "bn-suggestion-menu-item-small" : "",
            )}
            item={item}
            id={`bn-suggestion-menu-item-${i}`}
            isSelected={i === selectedIndex}
            onClick={() => onItemClick?.(item)}
          />
        </div>,
      );
    }

    return out;
  }, [Components, items, onItemClick, selectedIndex]);

  return (
    <Components.SuggestionMenu.Root
      id="bn-suggestion-menu"
      className="bn-suggestion-menu"
    >
      {renderedItems}
      {renderedItems.length === 0 &&
        (loadingState === "loading" || loadingState === "loaded") && (
          <Components.SuggestionMenu.EmptyItem className="bn-suggestion-menu-item">
            {dict.suggestion_menu.no_items_title}
          </Components.SuggestionMenu.EmptyItem>
        )}
      {loader}
    </Components.SuggestionMenu.Root>
  );
}
