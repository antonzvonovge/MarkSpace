import { mergeCSSClasses } from "@blocknote/core";
import {
  useComponentsContext,
  useDictionary,
  type DefaultReactSuggestionItem,
  type SuggestionMenuProps,
} from "@blocknote/react";
import { useMemo, type JSX } from "react";

/**
 * Compact tag suggestion list (no group headers; small rows).
 */
export function TagSuggestionMenu(
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
    const out: JSX.Element[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      out.push(
        <Components.SuggestionMenu.Item
          className={mergeCSSClasses(
            "bn-suggestion-menu-item",
            "bn-suggestion-menu-item-small",
            "bn-tag-suggestion-item",
          )}
          item={item}
          id={`bn-suggestion-menu-item-${i}`}
          isSelected={i === selectedIndex}
          key={`item-${item.title}-${i}`}
          onClick={() => onItemClick?.(item)}
        />,
      );
    }
    return out;
  }, [Components, items, onItemClick, selectedIndex]);

  return (
    <Components.SuggestionMenu.Root
      id="bn-suggestion-menu"
      className="bn-suggestion-menu bn-tag-suggestion-menu"
    >
      {renderedItems}
      {renderedItems.length === 0 &&
        (loadingState === "loading" || loadingState === "loaded") && (
          <Components.SuggestionMenu.EmptyItem className="bn-suggestion-menu-item bn-suggestion-menu-item-small">
            {dict.suggestion_menu.no_items_title}
          </Components.SuggestionMenu.EmptyItem>
        )}
      {loader}
    </Components.SuggestionMenu.Root>
  );
}
