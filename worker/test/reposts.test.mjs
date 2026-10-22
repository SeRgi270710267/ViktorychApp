import assert from "node:assert/strict";
import test from "node:test";
import { cleanRepostWrite, snapshotPost, sourceKey, toProfilePost, sortReposts } from "../../shared/reposts.js";

const PLATFORMS = ["x", "threads", "instagram", "rss", "youtube", "vk", "discord", "telegram", "tiktok", "facebook"];

function sample(platform, id) {
  return {
    id: id,
    statusId: id,
    platform: platform,
    handle: "added_" + platform,
    author: "Added " + platform,
    avatar: "https://cdn.example/" + platform + ".jpg",
    text: "hello from " + platform,
    date: "2026-10-22T12:00:00.000Z",
    url: "https://example.com/" + platform + "/" + id,
    feedId: platform + ":added_" + platform,
    kind: "post",
    media: [{ type: "photo", url: "https://cdn.example/" + platform + "/p.jpg", alt: "pic" }],
    stats: { likes: 2, reposts: 3, replies: 1 }
  };
}

test("snapshots keep added-account posts from every platform and an app-account post", () => {
  PLATFORMS.forEach((platform) => {
    const post = snapshotPost(sample(platform, platform + "-1"));
    assert.ok(post, platform);
    assert.equal(post.platform, platform);
    assert.equal(post.handle, "added_" + platform);
    assert.equal(sourceKey(post), platform + ":" + platform + "-1");
    assert.equal(post.media.length, 1);
  });
  const quote = snapshotPost({
    id: "q:x:1:10",
    statusId: "q:x:1:10",
    platform: "app",
    handle: "ada",
    author: "Ada",
    text: "a take",
    kind: "quote",
    quoted: sample("x", "1")
  });
  assert.equal(quote.platform, "app");
  assert.equal(quote.kind, "quote");
  assert.equal(quote.quoted.handle, "added_x");
  assert.equal(snapshotPost({ platform: "nope space", id: "1" }), null);
  assert.equal(snapshotPost({ platform: "x", id: "1", avatar: "javascript:alert(1)" }).avatar, "");
});

test("a repost row becomes a profile post with the account name, and a quote stays the account's post", () => {
  const original = sample("youtube", "abc123xyz01");
  const written = cleanRepostWrite({ kind: "repost", post: original, postKey: "ignore" });
  assert.equal(written.postKey, "r:youtube:abc123xyz01");
  const account = { handle: "ada", displayName: "Ada Lovelace", avatar: "https://cdn.example/ada.jpg", publicId: "123456789012" };
  const card = toProfilePost({ postKey: written.postKey, kind: "repost", comment: "", createdAt: 2000, post: written.post }, account, { self: true });
  assert.equal(card.kind, "repost");
  assert.equal(card.repostedBy.self, true);
  assert.equal(card.repostedBy.name, "Ada Lovelace");
  assert.equal(card.author, "Added youtube");
  assert.equal(card.date, original.date);
  assert.equal(card.sortDate, new Date(2000).toISOString());
  const other = toProfilePost({ postKey: written.postKey, kind: "repost", createdAt: 2000, post: written.post }, account, { self: false });
  assert.equal(other.repostedBy.self, false);
  assert.equal(other.repostedBy.name, "Ada Lovelace");

  const quoteKey = "q:" + sourceKey(original) + ":2000";
  const quoteWrite = cleanRepostWrite({ kind: "quote", postKey: quoteKey, comment: "  my take  ", post: original });
  assert.equal(quoteWrite.comment, "my take");
  const quoteCard = toProfilePost({ postKey: quoteKey, kind: "quote", comment: "my take", createdAt: 3000, post: quoteWrite.post }, account, { self: true });
  assert.equal(quoteCard.kind, "quote");
  assert.equal(quoteCard.platform, "app");
  assert.equal(quoteCard.author, "Ada Lovelace");
  assert.equal(quoteCard.handle, "ada");
  assert.equal(quoteCard.text, "my take");
  assert.equal(quoteCard.quoted.text, original.text);
  assert.equal(cleanRepostWrite({ kind: "quote", postKey: quoteKey, comment: "   ", post: original }).error, "bad_repost");

  const repostedQuote = cleanRepostWrite({ kind: "repost", post: quoteCard });
  assert.equal(repostedQuote.postKey.indexOf("r:app:"), 0);
  const onB = toProfilePost({ postKey: repostedQuote.postKey, kind: "repost", createdAt: 4000, post: repostedQuote.post }, { handle: "bea", displayName: "Bea" }, { self: false });
  assert.equal(onB.kind, "repost");
  assert.equal(onB.repostedBy.name, "Bea");
  assert.equal(onB.text, "my take");
  assert.equal(onB.quoted.text, original.text);

  const ordered = sortReposts([
    { postKey: "r:x:1", createdAt: 10 },
    { postKey: "q:x:1:2", createdAt: 30 },
    { postKey: "r:x:2", createdAt: 20 }
  ]);
  assert.deepEqual(ordered.map((row) => row.postKey), ["q:x:1:2", "r:x:2", "r:x:1"]);
});
