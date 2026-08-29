/** Localize catalog genres (OMDb English / Kinopoisk Russian) to the profile native language. */

import type { NativeLanguageId } from "../settings/types";
import { isNativeLanguageId } from "../settings/types";

/** Canonical keys match common OMDb Genre values (lowercase). */
type GenreKey =
  | "action"
  | "adventure"
  | "animation"
  | "biography"
  | "comedy"
  | "crime"
  | "documentary"
  | "drama"
  | "family"
  | "fantasy"
  | "film-noir"
  | "game-show"
  | "history"
  | "horror"
  | "music"
  | "musical"
  | "mystery"
  | "news"
  | "reality-tv"
  | "romance"
  | "sci-fi"
  | "short"
  | "sport"
  | "talk-show"
  | "thriller"
  | "war"
  | "western"
  | "adult"
  | "anime"
  | "children"
  | "concert";

const LABELS: Record<GenreKey, Partial<Record<NativeLanguageId, string>> & { en: string }> = {
  action: {
    en: "Action",
    ru: "боевик",
    uk: "бойовик",
    de: "Action",
    fr: "Action",
    es: "Acción",
    it: "Azione",
    pt: "Ação",
    pl: "Akcja",
    ka: "მძაფრსიუჟეტიანი",
    zh: "动作",
    ja: "アクション",
    ko: "액션",
  },
  adventure: {
    en: "Adventure",
    ru: "приключения",
    uk: "пригоди",
    de: "Abenteuer",
    fr: "Aventure",
    es: "Aventura",
    it: "Avventura",
    pt: "Aventura",
    pl: "Przygodowy",
    ka: "სათავგადასავლო",
    zh: "冒险",
    ja: "アドベンチャー",
    ko: "모험",
  },
  animation: {
    en: "Animation",
    ru: "мультфильм",
    uk: "мультфільм",
    de: "Animation",
    fr: "Animation",
    es: "Animación",
    it: "Animazione",
    pt: "Animação",
    pl: "Animacja",
    ka: "ანიმაცია",
    zh: "动画",
    ja: "アニメーション",
    ko: "애니메이션",
  },
  biography: {
    en: "Biography",
    ru: "биография",
    uk: "біографія",
    de: "Biografie",
    fr: "Biographie",
    es: "Biografía",
    it: "Biografico",
    pt: "Biografia",
    pl: "Biograficzny",
    ka: "ბიოგრაფია",
    zh: "传记",
    ja: "伝記",
    ko: "전기",
  },
  comedy: {
    en: "Comedy",
    ru: "комедия",
    uk: "комедія",
    de: "Komödie",
    fr: "Comédie",
    es: "Comedia",
    it: "Commedia",
    pt: "Comédia",
    pl: "Komedia",
    ka: "კომედია",
    zh: "喜剧",
    ja: "コメディ",
    ko: "코미디",
  },
  crime: {
    en: "Crime",
    ru: "криминал",
    uk: "кримінал",
    de: "Krimi",
    fr: "Crime",
    es: "Crimen",
    it: "Crime",
    pt: "Crime",
    pl: "Kryminał",
    ka: "კრიმინალური",
    zh: "犯罪",
    ja: "犯罪",
    ko: "범죄",
  },
  documentary: {
    en: "Documentary",
    ru: "документальный",
    uk: "документальний",
    de: "Dokumentarfilm",
    fr: "Documentaire",
    es: "Documental",
    it: "Documentario",
    pt: "Documentário",
    pl: "Dokumentalny",
    ka: "დოკუმენტური",
    zh: "纪录片",
    ja: "ドキュメンタリー",
    ko: "다큐멘터리",
  },
  drama: {
    en: "Drama",
    ru: "драма",
    uk: "драма",
    de: "Drama",
    fr: "Drame",
    es: "Drama",
    it: "Drammatico",
    pt: "Drama",
    pl: "Dramat",
    ka: "დრამა",
    zh: "剧情",
    ja: "ドラマ",
    ko: "드라마",
  },
  family: {
    en: "Family",
    ru: "семейный",
    uk: "сімейний",
    de: "Familie",
    fr: "Familial",
    es: "Familiar",
    it: "Familiare",
    pt: "Família",
    pl: "Familijny",
    ka: "საოჯახო",
    zh: "家庭",
    ja: "ファミリー",
    ko: "가족",
  },
  fantasy: {
    en: "Fantasy",
    ru: "фэнтези",
    uk: "фентезі",
    de: "Fantasy",
    fr: "Fantastique",
    es: "Fantasía",
    it: "Fantasy",
    pt: "Fantasia",
    pl: "Fantasy",
    ka: "ფენტეზი",
    zh: "奇幻",
    ja: "ファンタジー",
    ko: "판타지",
  },
  "film-noir": {
    en: "Film-Noir",
    ru: "фильм-нуар",
    uk: "фільм-нуар",
    de: "Film Noir",
    fr: "Film noir",
    es: "Cine negro",
    it: "Film noir",
    pt: "Film noir",
    pl: "Film noir",
    ka: "ფილმ-ნუარი",
    zh: "黑色电影",
    ja: "フィルム・ノワール",
    ko: "필름 누아르",
  },
  "game-show": {
    en: "Game-Show",
    ru: "игра",
    uk: "гра",
    de: "Spielshow",
    fr: "Jeu télévisé",
    es: "Concurso",
    it: "Game show",
    pt: "Game show",
    pl: "Teleturniej",
    ka: "თამაში",
    zh: "游戏节目",
    ja: "ゲームショー",
    ko: "게임 쇼",
  },
  history: {
    en: "History",
    ru: "история",
    uk: "історія",
    de: "Historie",
    fr: "Histoire",
    es: "Historia",
    it: "Storico",
    pt: "História",
    pl: "Historyczny",
    ka: "ისტორიული",
    zh: "历史",
    ja: "歴史",
    ko: "역사",
  },
  horror: {
    en: "Horror",
    ru: "ужасы",
    uk: "жахи",
    de: "Horror",
    fr: "Horreur",
    es: "Terror",
    it: "Horror",
    pt: "Terror",
    pl: "Horror",
    ka: "საშინელებათა",
    zh: "恐怖",
    ja: "ホラー",
    ko: "공포",
  },
  music: {
    en: "Music",
    ru: "музыка",
    uk: "музика",
    de: "Musik",
    fr: "Musique",
    es: "Música",
    it: "Musica",
    pt: "Música",
    pl: "Muzyka",
    ka: "მუსიკა",
    zh: "音乐",
    ja: "音楽",
    ko: "음악",
  },
  musical: {
    en: "Musical",
    ru: "мюзикл",
    uk: "мюзикл",
    de: "Musical",
    fr: "Comédie musicale",
    es: "Musical",
    it: "Musical",
    pt: "Musical",
    pl: "Musical",
    ka: "მიუზიკლი",
    zh: "音乐剧",
    ja: "ミュージカル",
    ko: "뮤지컬",
  },
  mystery: {
    en: "Mystery",
    ru: "детектив",
    uk: "детектив",
    de: "Mystery",
    fr: "Mystère",
    es: "Misterio",
    it: "Mistero",
    pt: "Mistério",
    pl: "Kryminał",
    ka: "დეტექტივი",
    zh: "悬疑",
    ja: "ミステリー",
    ko: "미스터리",
  },
  news: {
    en: "News",
    ru: "новости",
    uk: "новини",
    de: "Nachrichten",
    fr: "Actualités",
    es: "Noticias",
    it: "News",
    pt: "Notícias",
    pl: "Wiadomości",
    ka: "სიახლეები",
    zh: "新闻",
    ja: "ニュース",
    ko: "뉴스",
  },
  "reality-tv": {
    en: "Reality-TV",
    ru: "реальное ТВ",
    uk: "реаліті-шоу",
    de: "Reality-TV",
    fr: "Télé-réalité",
    es: "Reality",
    it: "Reality",
    pt: "Reality",
    pl: "Reality show",
    ka: "რეალითი",
    zh: "真人秀",
    ja: "リアリティ番組",
    ko: "리얼리티",
  },
  romance: {
    en: "Romance",
    ru: "мелодрама",
    uk: "мелодрама",
    de: "Romance",
    fr: "Romance",
    es: "Romance",
    it: "Romantico",
    pt: "Romance",
    pl: "Romans",
    ka: "მელოდრამა",
    zh: "爱情",
    ja: "ロマンス",
    ko: "로맨스",
  },
  "sci-fi": {
    en: "Sci-Fi",
    ru: "фантастика",
    uk: "фантастика",
    de: "Science-Fiction",
    fr: "Science-fiction",
    es: "Ciencia ficción",
    it: "Fantascienza",
    pt: "Ficção científica",
    pl: "Sci-Fi",
    ka: "ფანტასტიკა",
    zh: "科幻",
    ja: "SF",
    ko: "SF",
  },
  short: {
    en: "Short",
    ru: "короткометражка",
    uk: "короткометражка",
    de: "Kurzfilm",
    fr: "Court métrage",
    es: "Cortometraje",
    it: "Cortometraggio",
    pt: "Curta-metragem",
    pl: "Krótkometrażowy",
    ka: "მოკლემეტრაჟიანი",
    zh: "短片",
    ja: "短編",
    ko: "단편",
  },
  sport: {
    en: "Sport",
    ru: "спорт",
    uk: "спорт",
    de: "Sport",
    fr: "Sport",
    es: "Deporte",
    it: "Sport",
    pt: "Esporte",
    pl: "Sportowy",
    ka: "სპორტი",
    zh: "运动",
    ja: "スポーツ",
    ko: "스포츠",
  },
  "talk-show": {
    en: "Talk-Show",
    ru: "ток-шоу",
    uk: "ток-шоу",
    de: "Talkshow",
    fr: "Talk-show",
    es: "Talk show",
    it: "Talk show",
    pt: "Talk show",
    pl: "Talk-show",
    ka: "თॉक-შოუ",
    zh: "脱口秀",
    ja: "トークショー",
    ko: "토크쇼",
  },
  thriller: {
    en: "Thriller",
    ru: "триллер",
    uk: "трилер",
    de: "Thriller",
    fr: "Thriller",
    es: "Suspense",
    it: "Thriller",
    pt: "Thriller",
    pl: "Thriller",
    ka: "თრილერი",
    zh: "惊悚",
    ja: "スリラー",
    ko: "스릴러",
  },
  war: {
    en: "War",
    ru: "военный",
    uk: "воєнний",
    de: "Krieg",
    fr: "Guerre",
    es: "Bélico",
    it: "Guerra",
    pt: "Guerra",
    pl: "Wojenny",
    ka: "სამხედრო",
    zh: "战争",
    ja: "戦争",
    ko: "전쟁",
  },
  western: {
    en: "Western",
    ru: "вестерн",
    uk: "вестерн",
    de: "Western",
    fr: "Western",
    es: "Western",
    it: "Western",
    pt: "Faroeste",
    pl: "Western",
    ka: "ვესტერნი",
    zh: "西部",
    ja: "西部劇",
    ko: "서부",
  },
  adult: {
    en: "Adult",
    ru: "для взрослых",
    uk: "для дорослих",
    de: "Erwachsen",
    fr: "Adulte",
    es: "Adultos",
    it: "Per adulti",
    pt: "Adulto",
    pl: "Dla dorosłych",
    ka: "მოზრდილებისთვის",
    zh: "成人",
    ja: "成人向け",
    ko: "성인",
  },
  anime: {
    en: "Anime",
    ru: "аниме",
    uk: "аніме",
    de: "Anime",
    fr: "Anime",
    es: "Anime",
    it: "Anime",
    pt: "Anime",
    pl: "Anime",
    ka: "ანიმე",
    zh: "动漫",
    ja: "アニメ",
    ko: "애니메",
  },
  children: {
    en: "Children",
    ru: "детский",
    uk: "дитячий",
    de: "Kinder",
    fr: "Enfants",
    es: "Infantil",
    it: "Bambini",
    pt: "Infantil",
    pl: "Dziecięcy",
    ka: "საბავშვო",
    zh: "儿童",
    ja: "子供向け",
    ko: "어린이",
  },
  concert: {
    en: "Concert",
    ru: "концерт",
    uk: "концерт",
    de: "Konzert",
    fr: "Concert",
    es: "Concierto",
    it: "Concerto",
    pt: "Concerto",
    pl: "Koncert",
    ka: "კონცერტი",
    zh: "音乐会",
    ja: "コンサート",
    ko: "콘서트",
  },
};

/** Normalize raw catalog genre → canonical key (OMDb English + Kinopoisk Russian aliases). */
const ALIASES: Record<string, GenreKey> = (() => {
  const map: Record<string, GenreKey> = {};
  const add = (alias: string, key: GenreKey) => {
    const k = alias.trim().toLowerCase();
    if (k) map[k] = key;
  };
  for (const [key, labels] of Object.entries(LABELS) as [GenreKey, (typeof LABELS)[GenreKey]][]) {
    add(key, key);
    add(labels.en, key);
    for (const v of Object.values(labels)) {
      if (typeof v === "string") add(v, key);
    }
  }
  // Extra OMDb / Kinopoisk spellings
  add("sci fi", "sci-fi");
  add("scifi", "sci-fi");
  add("science fiction", "sci-fi");
  add("film noir", "film-noir");
  add("noir", "film-noir");
  add("reality tv", "reality-tv");
  add("reality", "reality-tv");
  add("talk show", "talk-show");
  add("game show", "game-show");
  add("short film", "short");
  add("shorts", "short");
  add("war film", "war");
  add("мелодрама", "romance");
  add("romantika", "romance");
  add("романтический", "romance");
  add("фантастика", "sci-fi");
  add("фэнтези", "fantasy");
  add("фентези", "fantasy");
  add("мультфильм", "animation");
  add("мультфильмы", "animation");
  add("детский", "children");
  add("для взрослых", "adult");
  add("реальное тв", "reality-tv");
  add("ток-шоу", "talk-show");
  add("короткометражка", "short");
  add("фильм-нуар", "film-noir");
  return map;
})();

function resolveGenreKey(raw: string): GenreKey | null {
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  return ALIASES[key] ?? null;
}

function labelFor(
  key: GenreKey,
  lang: NativeLanguageId,
): string {
  const row = LABELS[key];
  return row[lang] ?? row.en;
}

/**
 * Rewrite catalog genres into the user's native language.
 * Unknown names are left as-is (trimmed). Dedupes by localized label.
 */
export function localizeMovieGenres(
  genres: string[],
  nativeLanguage: NativeLanguageId | string,
): string[] {
  const lang: NativeLanguageId = isNativeLanguageId(nativeLanguage)
    ? nativeLanguage
    : "en";
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of genres) {
    const name = raw.trim();
    if (!name) continue;
    const key = resolveGenreKey(name);
    const localized = key ? labelFor(key, lang) : name;
    const dedupe = localized.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push(localized);
  }
  return out;
}
