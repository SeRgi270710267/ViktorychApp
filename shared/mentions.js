/* @handle extraction for internal posts.
   Bios are not passed here. Code spans and URLs are blanked before the
   scan so a handle inside them is not a mention. Matching is
   case-insensitive and de-duplicated on the handle skeleton, which is
   also how a renamed handle still resolves to the same account. */

import { inspectHandle } from "./handle-skeleton.js";

const FENCE = /```[\s\S]*?```/g;
const FENCE_OPEN = /```[\s\S]*$/g;
const INLINE = /`[^`\n]*`/g;
const URL = /\b(?:https?:\/\/|www\.)[^\s<>()]+/gi;
const HANDLE = /(^|[^A-Za-z0-9_\u0400-\u04FF])@([A-Za-z0-9_\u0400-\u04FF]{1,15})/g;

function blank(text, pattern) {
  return text.replace(pattern, (match) => " ".repeat(match.length));
}

export function extractMentions(value) {
  let text = String(value == null ? "" : value);
  if (!text) return [];
  text = blank(text, FENCE);
  text = blank(text, FENCE_OPEN);
  text = blank(text, INLINE);
  text = blank(text, URL);
  const seen = new Set();
  const out = [];
  HANDLE.lastIndex = 0;
  let match = HANDLE.exec(text);
  while (match) {
    const checked = inspectHandle(match[2]);
    if (checked.ok && checked.skeleton && !seen.has(checked.skeleton)) {
      seen.add(checked.skeleton);
      out.push({ handle: checked.handle, skeleton: checked.skeleton });
    }
    match = HANDLE.exec(text);
  }
  return out;
}
