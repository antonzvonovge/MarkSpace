import { invoke } from "@tauri-apps/api/core";

type HttpFetchResponse = {
  status: number;
  body: string;
};

async function nativeFetch(url: string): Promise<HttpFetchResponse> {
  return invoke<HttpFetchResponse>("http_fetch", {
    req: {
      url,
      method: "GET",
      headers: { Accept: "application/json" },
      body: null,
      timeoutSecs: 30,
    },
  });
}

export function parseTwitterStatusUrl(
  url: string,
): { screenName: string | null; statusId: string } | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "x.com" && host !== "twitter.com" && host !== "mobile.twitter.com") {
      return null;
    }
    const parts = u.pathname.split("/").filter(Boolean);
    // /{user}/status/{id} or /i/status/{id} or /status/{id}
    const statusIdx = parts.indexOf("status");
    if (statusIdx < 0 || !parts[statusIdx + 1]) return null;
    const statusId = parts[statusIdx + 1]!.replace(/[^0-9]/g, "");
    if (!statusId) return null;
    const screenName =
      statusIdx > 0 && parts[statusIdx - 1] && parts[statusIdx - 1] !== "i"
        ? parts[statusIdx - 1]!
        : null;
    return { screenName, statusId };
  } catch {
    return null;
  }
}

type FxMediaInfo = {
  __typename?: string;
  original_img_url?: string;
};

type FxMediaEntity = {
  media_id?: string | number;
  media_info?: FxMediaInfo;
};

type FxEntityValue = {
  type?: string;
  data?: {
    markdown?: string;
    mediaItems?: Array<{ mediaId?: string | number }>;
  };
};

type FxBlock = {
  type?: string;
  text?: string;
  entityRanges?: Array<{ key?: number | string }>;
};

type FxArticle = {
  title?: string;
  preview_text?: string;
  cover_media?: { media_info?: FxMediaInfo };
  media_entities?: FxMediaEntity[];
  content?: {
    blocks?: FxBlock[];
    entityMap?: Array<{ key?: string | number; value?: FxEntityValue }> | Record<
      string,
      FxEntityValue
    >;
  };
};

type FxTweet = {
  url?: string;
  text?: string;
  raw_text?: { text?: string };
  article?: FxArticle | null;
  author?: { name?: string; screen_name?: string };
  media?: {
    photos?: Array<{ url?: string }>;
  };
};

export type TwitterClipPage = {
  url: string;
  content: string;
  truncated: boolean;
  imageUrls: string[];
};

function buildEntityMap(
  raw: FxArticle["content"],
): Map<string, FxEntityValue> {
  const out = new Map<string, FxEntityValue>();
  const em = raw?.entityMap;
  if (Array.isArray(em)) {
    for (const item of em) {
      if (item?.key == null || !item.value) continue;
      out.set(String(item.key), item.value);
    }
  } else if (em && typeof em === "object") {
    for (const [k, v] of Object.entries(em)) out.set(k, v);
  }
  return out;
}

function mediaUrlById(entities: FxMediaEntity[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const ent of entities ?? []) {
    const id = ent.media_id != null ? String(ent.media_id) : "";
    const url = ent.media_info?.original_img_url?.trim();
    if (id && url?.startsWith("http")) map.set(id, url);
  }
  return map;
}

function articleToMarkdown(article: FxArticle, pageUrl: string): {
  title: string;
  markdown: string;
  imageUrls: string[];
} {
  const title =
    article.title?.trim() ||
    article.preview_text?.trim()?.split("\n")[0]?.trim() ||
    "Tweet";
  const entityMap = buildEntityMap(article.content);
  const mediaById = mediaUrlById(article.media_entities);
  const imageUrls: string[] = [];
  const seen = new Set<string>();
  const pushImage = (url: string | undefined) => {
    const u = url?.trim();
    if (!u?.startsWith("http") || seen.has(u)) return;
    seen.add(u);
    imageUrls.push(u);
  };

  const cover = article.cover_media?.media_info?.original_img_url;
  pushImage(cover);

  const lines: string[] = [];
  let listBuf: string[] = [];
  const flushList = () => {
    if (!listBuf.length) return;
    lines.push(listBuf.join("\n"));
    listBuf = [];
  };

  for (const block of article.content?.blocks ?? []) {
    const type = block.type ?? "unstyled";
    const text = (block.text ?? "").replace(/\s+$/g, "");

    if (type === "unordered-list-item") {
      listBuf.push(`- ${text}`);
      continue;
    }
    if (type === "ordered-list-item") {
      listBuf.push(`1. ${text}`);
      continue;
    }
    flushList();

    if (type === "atomic") {
      const key = block.entityRanges?.[0]?.key;
      const ent = key == null ? null : entityMap.get(String(key));
      if (!ent) continue;
      if (ent.type === "DIVIDER") {
        lines.push("---");
        continue;
      }
      if (ent.type === "MARKDOWN" && ent.data?.markdown?.trim()) {
        lines.push(ent.data.markdown.trim());
        continue;
      }
      if (ent.type === "MEDIA") {
        for (const item of ent.data?.mediaItems ?? []) {
          const id = item.mediaId != null ? String(item.mediaId) : "";
          const url = mediaById.get(id);
          if (url) {
            pushImage(url);
            lines.push(`![image](${url})`);
          }
        }
      }
      continue;
    }

    if (type === "header-one") {
      lines.push(`# ${text}`);
      continue;
    }
    if (type === "header-two") {
      lines.push(`## ${text}`);
      continue;
    }
    if (type === "header-three") {
      lines.push(`### ${text}`);
      continue;
    }
    if (type === "blockquote") {
      lines.push(
        text
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n"),
      );
      continue;
    }
    if (text) lines.push(text);
  }
  flushList();

  // Any media not referenced inline — still keep for download.
  for (const url of mediaById.values()) pushImage(url);

  const body = lines
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const markdown = [
    `Title: ${title}`,
    "",
    body,
    "",
    `Source: ${pageUrl}`,
  ].join("\n");

  return { title, markdown, imageUrls };
}

/**
 * Fetch an X/Twitter status (including long-form Articles) via FxTwitter.
 * Firecrawl/Tavily often return over-escaped text and zero images for these URLs.
 */
export async function fetchTwitterStatusForClip(
  url: string,
): Promise<TwitterClipPage | null> {
  const parsed = parseTwitterStatusUrl(url);
  if (!parsed) return null;

  const endpoints = [
    parsed.screenName
      ? `https://api.fxtwitter.com/${encodeURIComponent(parsed.screenName)}/status/${parsed.statusId}`
      : null,
    `https://api.fxtwitter.com/status/${parsed.statusId}`,
  ].filter(Boolean) as string[];

  let tweet: FxTweet | null = null;
  let finalUrl = url;
  for (const endpoint of endpoints) {
    const res = await nativeFetch(endpoint);
    if (res.status < 200 || res.status >= 300) continue;
    try {
      const data = JSON.parse(res.body) as {
        code?: number;
        tweet?: FxTweet;
      };
      if (data.tweet) {
        tweet = data.tweet;
        finalUrl = data.tweet.url?.trim() || url;
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (!tweet) return null;

  if (tweet.article) {
    const { markdown, imageUrls } = articleToMarkdown(tweet.article, finalUrl);
    return {
      url: finalUrl,
      content: markdown,
      truncated: false,
      imageUrls,
    };
  }

  const text =
    tweet.text?.trim() ||
    tweet.raw_text?.text?.trim() ||
    "";
  const author =
    tweet.author?.name || tweet.author?.screen_name
      ? `${tweet.author?.name ?? ""}${tweet.author?.screen_name ? ` (@${tweet.author.screen_name})` : ""}`.trim()
      : "";
  const imageUrls = (tweet.media?.photos ?? [])
    .map((p) => p.url?.trim())
    .filter((u): u is string => !!u?.startsWith("http"));
  const imageBlock = imageUrls
    .map((u, i) => `![image ${i + 1}](${u})`)
    .join("\n\n");
  const title = text.split("\n")[0]?.slice(0, 120) || "Tweet";
  const content = [
    `Title: ${title}`,
    "",
    author ? `Author: ${author}` : "",
    text,
    imageBlock,
    "",
    `Source: ${finalUrl}`,
  ]
    .filter((l) => l !== "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  return {
    url: finalUrl,
    content,
    truncated: false,
    imageUrls,
  };
}
