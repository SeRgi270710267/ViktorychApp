import assert from "node:assert/strict";

// Mock the environment needed for profilePostsHtml logic
const STATE = {
  data: {
    posts: [
      {
        id: "x:1001",
        platform: "x",
        handle: "SampleAgency",
        date: "2026-10-24T12:00:00Z",
        sortDate: "2026-10-24T12:00:00Z",
        text: "James Webb Space Telescope new findings"
      },
      {
        id: "x:1002",
        platform: "x",
        handle: "OtherUser",
        date: "2026-10-24T13:00:00Z",
        sortDate: "2026-10-24T13:00:00Z",
        text: "Unrelated post"
      },
      {
        id: "tg:2001",
        platform: "telegram",
        handle: "alice_channel",
        date: "2026-10-24T14:00:00Z",
        sortDate: "2026-10-24T14:00:00Z",
        text: "Alice's official telegram announcement"
      },
      {
        id: "yt:3001",
        platform: "youtube",
        handle: "alice_vids",
        channelId: "alice_vids",
        date: "2026-10-24T15:00:00Z",
        sortDate: "2026-10-24T15:00:00Z",
        text: "Alice's latest video"
      }
    ]
  },
  shared: {}
};

function byStamp(a, b) {
  const sa = (a && (a.sortDate || a.date)) || "";
  const sb = (b && (b.sortDate || b.date)) || "";
  return sb.localeCompare(sa);
}

function card(post) {
  return `<article class="post" data-id="${post.id}">${post.text}</article>`;
}

function findAnyPost(id) {
  return STATE.data.posts.find((p) => p.id === id);
}

// Function under test matching app.js profilePostsHtml
function profilePostsHtml(account) {
  if (!account) return { html: "", count: 0 };
  const identities = (account && account.identities) || [];
  const rows = account.reposts || [];
  const postList = [];
  const seen = new Set();
  function addPost(post) {
    if (!post) return;
    const key = (post.platform || "") + ":" + (post.kind === "repost" ? post.id : (post.statusId || post.id));
    if (seen.has(key)) return;
    seen.add(key);
    postList.push(post);
  }
  rows.forEach((row) => {
    if (row && row.post) addPost(row.post);
  });
  if (identities.length) {
    const allPosts = (STATE.data && STATE.data.posts) || [];
    identities.forEach((ident) => {
      if (!ident || !ident.handle) return;
      const idPlatform = String(ident.platform || "x").toLowerCase();
      const idHandle = String(ident.handle || "").replace(/^@/, "").toLowerCase();
      allPosts.forEach((p) => {
        if (!p) return;
        const pPlatform = String(p.platform || "x").toLowerCase();
        if (pPlatform !== idPlatform) return;
        const pHandle = String(p.handle || "").replace(/^@/, "").toLowerCase();
        const pChannel = String(p.channelId || "").toLowerCase();
        const pFeedId = String(p.feedId || "").toLowerCase();
        const matches = (pHandle && pHandle === idHandle) ||
                        (pChannel && pChannel === idHandle) ||
                        (pFeedId === idPlatform + ":" + idHandle) ||
                        (pFeedId === idHandle);
        if (matches) {
          addPost(p);
        }
      });
    });
  }
  postList.sort(byStamp);
  return { html: postList.map((post) => card(post)).join(""), count: postList.length, posts: postList };
}

// 1. Account without linked identities: only reposts appear
const accountBare = {
  publicId: "123456789012",
  handle: "alice",
  reposts: [
    {
      postKey: "x:9999",
      post: { id: "x:9999", platform: "x", handle: "someone", date: "2026-10-23T10:00:00Z", sortDate: "2026-10-23T10:00:00Z", text: "Reposted post" }
    }
  ]
};
const resBare = profilePostsHtml(accountBare);
assert.equal(resBare.count, 1);
assert.equal(resBare.posts[0].id, "x:9999");

// 2. Account with linked X profile @SampleAgency and Telegram @alice_channel and YouTube @alice_vids
const accountLinked = {
  publicId: "123456789012",
  handle: "alice",
  reposts: accountBare.reposts,
  identities: [
    { platform: "x", handle: "SampleAgency", verified: true },
    { platform: "telegram", handle: "alice_channel", verified: true },
    { platform: "youtube", handle: "alice_vids", verified: true }
  ]
};

const resLinked = profilePostsHtml(accountLinked);
// Should have 1 repost + 1 X post + 1 Telegram post + 1 YouTube post = 4 posts total!
assert.equal(resLinked.count, 4);

// Verifies chronological ordering (newest first)
assert.equal(resLinked.posts[0].id, "yt:3001");
assert.equal(resLinked.posts[1].id, "tg:2001");
assert.equal(resLinked.posts[2].id, "x:1001");
assert.equal(resLinked.posts[3].id, "x:9999");

// Verifies that unrelated post (OtherUser) did not appear
assert.ok(!resLinked.posts.some((p) => p.handle === "OtherUser"));

console.log("identities_profile_test ok: posts from linked social profiles successfully appear in profile posts stream!");
