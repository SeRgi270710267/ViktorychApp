/* Following and Followers lists of external accounts, read live.

   Bluesky (public AppView), Mastodon and the rest of the fediverse (each
   server's public API) and Nostr (kind 3 contact lists on the relays) are
   read straight from this device. X goes through our Worker pool, which
   reads public Nitter-style mirrors; YouTube subscriptions go through the
   Worker too because the Data API key stays on the server. Threads,
   Instagram, TikTok and the rest only show these lists to signed-in users,
   so they report "none" and the page shows a calm empty state.

   Pages are kept in memory for five minutes only. Nothing is written to
   storage, the repo or the server. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViktorychFollowLists = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  var TTL = 5 * 60 * 1000;
  var BSKY = "https://public.api.bsky.app/xrpc/";
  var NOSTR_PAGE = 40;
  var memory = {};
  var deps = {
    fetch: function (url, init) { return root.fetch(url, init); },
    call: function (path) {
      var A = root.ViktorychAccounts;
      return A && A.call ? A.call(path) : Promise.resolve({ status: 503 });
    },
    nostr: function () { return root.ViktorychNostr && root.ViktorychNostr.enabled && root.ViktorychNostr.enabled() ? root.ViktorychNostr : null; }
  };

  function setDeps(next) { Object.keys(next || {}).forEach(function (k) { deps[k] = next[k]; }); }

  /* What each platform can show without signing in. */
  var SUPPORT = {
    x: { following: true, followers: true },
    bsky: { following: true, followers: true },
    bluesky: { following: true, followers: true },
    mastodon: { following: true, followers: true },
    nostr: { following: true, followers: true },
    youtube: { following: true, followers: false }
  };

  function supports(platform, tab) {
    var row = SUPPORT[String(platform || "x")];
    return !!(row && row[tab === "followers" ? "followers" : "following"]);
  }

  function getJson(url) {
    var hit = memory[url];
    if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.value);
    return Promise.resolve(deps.fetch(url, { credentials: "omit", headers: { accept: "application/json" } })).then(function (res) {
      if (!res || !res.ok) {
        var err = new Error("http_" + (res ? res.status : 0));
        err.status = res ? res.status : 0;
        throw err;
      }
      var link = res.headers && res.headers.get ? res.headers.get("link") || "" : "";
      return res.json().then(function (body) {
        var value = { body: body, link: link };
        memory[url] = { at: Date.now(), value: value };
        return value;
      });
    });
  }

  function textOf(html) {
    var raw = String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p[^>]*>/gi, "\n\n");
    if (root.DOMParser) {
      try { return String(new root.DOMParser().parseFromString(raw, "text/html").body.textContent || "").trim(); } catch (err) { /* below */ }
    }
    return raw.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").trim();
  }

  /* ---------- Bluesky ---------- */
  function bskyRow(a) {
    if (!a || !a.handle) return null;
    return { id: "bsky:" + a.handle, platform: "bsky", handle: a.handle, name: a.displayName || a.handle, avatar: a.avatar || "", bio: a.description || "", did: a.did || "" };
  }
  function bskyPage(subject, tab, cursor) {
    var method = tab === "followers" ? "app.bsky.graph.getFollowers" : "app.bsky.graph.getFollows";
    var url = BSKY + method + "?actor=" + encodeURIComponent(subject.handle) + "&limit=50" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
    return getJson(url).then(function (got) {
      var body = got.body || {};
      var list = (tab === "followers" ? body.followers : body.follows) || [];
      var out = { items: list.map(bskyRow).filter(Boolean), cursor: body.cursor || "" };
      if (body.subject && tab === "following" && body.subject.followsCount != null) out.count = body.subject.followsCount;
      if (body.subject && tab === "followers" && body.subject.followersCount != null) out.count = body.subject.followersCount;
      return out;
    });
  }
  /* Which of these accounts follow the subject (public getRelationships). */
  function bskyFollowersAmong(subject, handles) {
    var list = (handles || []).filter(Boolean).slice(0, 30);
    if (!list.length) return Promise.resolve([]);
    var url = BSKY + "app.bsky.graph.getRelationships?actor=" + encodeURIComponent(subject.handle) + list.map(function (h) { return "&others=" + encodeURIComponent(h); }).join("");
    return getJson(url).then(function (got) {
      var rels = (got.body && got.body.relationships) || [];
      var dids = rels.filter(function (r) { return r && r.followedBy; }).map(function (r) { return r.did; });
      if (!dids.length) return [];
      var url2 = BSKY + "app.bsky.actor.getProfiles?" + dids.slice(0, 25).map(function (d) { return "actors=" + encodeURIComponent(d); }).join("&");
      return getJson(url2).then(function (g) { return ((g.body && g.body.profiles) || []).map(bskyRow).filter(Boolean); });
    }).catch(function () { return []; });
  }

  /* ---------- Mastodon and the fediverse ---------- */
  function nextLink(link) {
    var m = String(link || "").match(/<([^>]+)>\s*;\s*rel="next"/);
    return m ? m[1] : "";
  }
  function fediRow(a, instance) {
    if (!a || !a.acct) return null;
    var acct = String(a.acct);
    var full = acct.indexOf("@") > 0 ? acct : acct + "@" + instance;
    return { id: "mastodon:" + full, platform: "mastodon", handle: full, name: a.display_name || a.username || acct, avatar: a.avatar_static || a.avatar || "", bio: textOf(a.note).slice(0, 400) };
  }
  function mastodonPage(subject, tab, cursor) {
    if (!subject.instance || !subject.remoteId) return Promise.resolve({ items: [], cursor: "", unavailable: "lookup" });
    var base = "https://" + subject.instance + "/api/v1/accounts/" + encodeURIComponent(subject.remoteId) + "/" + (tab === "followers" ? "followers" : "following") + "?limit=40";
    var url = cursor && cursor.indexOf("https://" + subject.instance + "/") === 0 ? cursor : base;
    return getJson(url).then(function (got) {
      var list = Array.isArray(got.body) ? got.body : [];
      var out = { items: list.map(function (a) { return fediRow(a, subject.instance); }).filter(Boolean), cursor: list.length ? nextLink(got.link) : "" };
      var count = tab === "followers" ? subject.followers : subject.following;
      // A server that hides this account's lists answers with nothing.
      if (!cursor && !list.length && Number(count) > 0) out.hidden = true;
      return out;
    }, function (err) {
      if (err && (err.status === 401 || err.status === 403)) return { items: [], cursor: "", hidden: true };
      throw err;
    });
  }

  /* ---------- Nostr ---------- */
  function nostrRows(N, pubkeys) {
    if (!pubkeys.length) return Promise.resolve([]);
    return N.query([{ kinds: [0], authors: pubkeys, limit: pubkeys.length }], { timeout: 4000, max: pubkeys.length * 2 }).then(function (metas) {
      var map = {};
      (metas || []).forEach(function (ev) { if (!map[ev.pubkey]) map[ev.pubkey] = N.profileOf ? N.profileOf(ev) : {}; });
      return pubkeys.map(function (pk) {
        var meta = map[pk] || {};
        var npub = N.npub(pk);
        return { id: "nostr:" + npub, platform: "nostr", handle: npub, displayHandle: meta.nip05 || N.shortNpub(pk), name: meta.name || meta.display_name || meta.nip05 || N.shortNpub(pk), avatar: meta.picture || "", bio: String(meta.about || "").slice(0, 400) };
      });
    });
  }
  function nostrPubkey(N, subject) {
    if (/^[0-9a-f]{64}$/.test(String(subject.pubkey || ""))) return subject.pubkey;
    try {
      var d = N.decode(subject.handle);
      if (d && (d.type === "npub" || d.type === "hex")) return d.data;
      if (d && d.type === "nprofile") return d.data && d.data.pubkey;
    } catch (err) { /* below */ }
    return "";
  }
  function nostrPage(subject, tab, cursor) {
    var N = deps.nostr();
    if (!N) return Promise.resolve({ items: [], cursor: "", unavailable: "nostr_off" });
    var pk = nostrPubkey(N, subject);
    if (!pk) return Promise.resolve({ items: [], cursor: "", unavailable: "lookup" });
    if (tab === "followers") {
      var until = Number(cursor) || 0;
      var filter = { kinds: [3], "#p": [pk], limit: NOSTR_PAGE };
      if (until) filter.until = until;
      return N.query([filter], { timeout: 5000, max: NOSTR_PAGE * 3 }).then(function (evs) {
        var seen = {};
        var keys = [];
        var oldest = 0;
        (evs || []).forEach(function (ev) {
          if (!oldest || ev.created_at < oldest) oldest = ev.created_at;
          if (!seen[ev.pubkey] && ev.pubkey !== pk) { seen[ev.pubkey] = 1; keys.push(ev.pubkey); }
        });
        return nostrRows(N, keys).then(function (items) {
          return { items: items, cursor: evs && evs.length >= NOSTR_PAGE && oldest ? String(oldest - 1) : "" };
        });
      });
    }
    var key = "nostr-contacts:" + pk;
    var held = memory[key];
    var listJob = held && Date.now() - held.at < TTL ? Promise.resolve(held.value) : N.query([{ kinds: [3], authors: [pk], limit: 1 }], { timeout: 5000, max: 1 }).then(function (evs) {
      var ev = evs && evs[0];
      var keys = [];
      var seen = {};
      ((ev && ev.tags) || []).forEach(function (t) {
        if (t && t[0] === "p" && /^[0-9a-f]{64}$/.test(String(t[1] || "")) && !seen[t[1]]) { seen[t[1]] = 1; keys.push(t[1]); }
      });
      memory[key] = { at: Date.now(), value: keys };
      return keys;
    });
    return listJob.then(function (keys) {
      var start = Number(cursor) || 0;
      var slice = keys.slice(start, start + NOSTR_PAGE);
      return nostrRows(N, slice).then(function (items) {
        return { items: items, cursor: start + NOSTR_PAGE < keys.length ? String(start + NOSTR_PAGE) : "", count: keys.length };
      });
    });
  }

  /* ---------- X and YouTube through the Worker pool ---------- */
  function poolPage(path) {
    var hit = memory[path];
    if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.value);
    return Promise.resolve(deps.call(path)).then(function (body) {
      body = body || {};
      if (body.status && body.status >= 400) {
        var err = new Error("http_" + body.status);
        err.status = body.status;
        throw err;
      }
      var out = { items: body.items || [], cursor: body.cursor || "" };
      if (body.hidden) out.hidden = true;
      if (body.missing) out.missing = true;
      if (body.unavailable) out.unavailable = String(body.unavailable);
      if (body.following != null) out.following = body.following;
      if (body.followers != null) out.followers = body.followers;
      if (!out.unavailable) memory[path] = { at: Date.now(), value: out };
      return out;
    });
  }
  function xPage(subject, tab, cursor) {
    var handle = String(subject.handle || "").replace(/^@/, "");
    var path = "/v1/ext-graph/x?handle=" + encodeURIComponent(handle) + "&tab=" + (tab === "followers" ? "followers" : "following") + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
    return poolPage(path).then(function (out) {
      out.items = out.items.map(function (r) {
        return { id: "x:" + r.handle, platform: "x", handle: r.handle, name: r.name || r.handle, avatar: r.avatar || "", bio: r.bio || "", verifiedType: r.verifiedType || "" };
      });
      if (tab === "following" && out.following != null) out.count = out.following;
      if (tab === "followers" && out.followers != null) out.count = out.followers;
      return out;
    });
  }
  function youtubePage(subject, tab, cursor) {
    var channel = String(subject.channelId || subject.handle || "");
    if (!/^UC[A-Za-z0-9_-]{22}$/.test(channel)) return Promise.resolve({ items: [], cursor: "", unavailable: "lookup" });
    return poolPage("/v1/ext-graph/youtube?channel=" + encodeURIComponent(channel) + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "")).then(function (out) {
      out.items = out.items.map(function (r) {
        return { id: "youtube:" + r.channelId, platform: "youtube", handle: r.channelId, name: r.name || r.channelId, avatar: r.avatar || "", bio: r.bio || "" };
      });
      if (out.following != null) out.count = out.following;
      return out;
    });
  }

  function page(platform, subject, tab, cursor) {
    var p = String(platform || "x");
    if (!supports(p, tab)) return Promise.resolve({ items: [], cursor: "", none: true });
    if (p === "bsky" || p === "bluesky") return bskyPage(subject, tab, cursor);
    if (p === "mastodon") return mastodonPage(subject, tab, cursor);
    if (p === "nostr") return nostrPage(subject, tab, cursor);
    if (p === "youtube") return youtubePage(subject, tab, cursor);
    return xPage(subject, tab, cursor);
  }

  /* ---------- the list state the page renders from ---------- */
  var lists = {};
  function keyOf(platform, handle, tab) { return String(platform || "x") + ":" + String(handle || "").toLowerCase() + ":" + tab; }

  function state(platform, handle, tab) {
    var row = lists[keyOf(platform, handle, tab)];
    if (row && row.at && Date.now() - row.at > TTL && !row.loading) {
      delete lists[keyOf(platform, handle, tab)];
      row = null;
    }
    return row || null;
  }

  /* Loads the first page (or the next one with more=true). onChange runs
     after every page so the view can redraw. */
  function load(platform, subject, tab, onChange, more) {
    var key = keyOf(platform, subject.handle, tab);
    var row = state(platform, subject.handle, tab);
    if (row && row.loading) return row;
    if (row && !more) return row;
    if (row && more && (!row.cursor || row.error)) return row;
    if (!row) row = lists[key] = { items: [], cursor: "", seen: {}, at: 0 };
    row.loading = true;
    row.error = false;
    page(platform, subject, tab, more ? row.cursor : "").then(function (out) {
      out = out || {};
      (out.items || []).forEach(function (item) {
        var k = String(item.id || "").toLowerCase();
        if (!k || row.seen[k]) return;
        row.seen[k] = 1;
        row.items.push(item);
      });
      row.cursor = out.cursor && out.cursor !== row.cursor ? out.cursor : "";
      if (out.count != null) row.count = out.count;
      row.hidden = !!out.hidden && !row.items.length;
      row.none = !!out.none;
      row.missing = !!out.missing;
      row.unavailable = out.unavailable && !row.items.length ? out.unavailable : "";
      row.at = Date.now();
    }, function () {
      row.error = true;
      row.at = Date.now();
    }).then(function () {
      row.loading = false;
      if (onChange) onChange();
    });
    return row;
  }

  function retry(platform, handle, tab) { delete lists[keyOf(platform, handle, tab)]; }

  function reset() { memory = {}; lists = {}; }

  return { supports: supports, page: page, load: load, state: state, retry: retry, reset: reset, setDeps: setDeps, bskyFollowersAmong: bskyFollowersAmong, nextLink: nextLink, fediRow: fediRow, bskyRow: bskyRow };
});
