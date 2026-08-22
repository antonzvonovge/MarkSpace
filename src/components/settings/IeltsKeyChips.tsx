import type { IeltsChip } from "../../ai/ieltsFit";
import { ieltsChipTooltip } from "../../ai/ieltsFit";

export function IeltsKeyChips({
  chips,
  keyFilled,
}: {
  chips: IeltsChip[];
  keyFilled: boolean;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="ielts-key-chips" aria-label="IELTS practice fit">
      {chips.map((chip) => {
        const label =
          chip.skill === "web"
            ? "Web find"
            : `IELTS ${chip.skill}`;
        return (
          <span
            key={chip.skill}
            className={`ielts-key-chip fit-${chip.fit}${keyFilled ? "" : " is-empty"}`}
            title={ieltsChipTooltip(chip, keyFilled)}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}
