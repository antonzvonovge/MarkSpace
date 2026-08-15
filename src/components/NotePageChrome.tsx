import { PageDayMarker } from "./PageDayMarker";
import { PageTags } from "./PageTags";

type Props = {
  path: string;
  content: string;
  onChange: (markdown: string) => void;
};

export function NotePageChrome({ path, content, onChange }: Props) {
  return (
    <div className="note-page-chrome">
      <PageDayMarker path={path} content={content} onChange={onChange} />
      <PageTags content={content} onChange={onChange} />
    </div>
  );
}
