import { learningLanguageFlagSvg } from "../lib/languageFlags";

type Props = {
  language: string | null | undefined;
  className?: string;
};

/** Country flag for a language-learning project (SVG — works on Windows). */
export function LearningLanguageFlag({ language, className }: Props) {
  const Flag = learningLanguageFlagSvg(language);
  if (!Flag) return null;
  return <Flag className={className} aria-hidden />;
}
