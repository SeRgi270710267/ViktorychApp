/* Home timeline freshness. The page paints the saved snapshot first, then
   merges newer rows as each source returns. A row lands at the top on the
   first look. After the reader has scrolled or opened a post, it waits
   behind the new-posts pill so the list does not jump.
   Periodic sync is registered at 15 minutes where the browser offers it.
   Chrome and Edge actually run it only for an installed app, and they
   stretch that hint to hours. Brave on Android does not ship the API.
   Safari and Firefox do not either. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.HomeFresh = api;
})(typeof self !== "undefined" ? self : this, function () {
  var STALE_MS = 2 * 60 * 1000;
  var VISIBLE_MS = 60 * 1000;
  var PERIODIC_MIN_MS = 15 * 60 * 1000;
  var SCROLL_PX = 40;

  function savedAt(doc) {
    if (!doc) return 0;
    var n = Number(doc.savedAt);
    if (n > 1e11) return n;
    var parsed = Date.parse(doc.savedAt || doc.updated || "");
    return isFinite(parsed) ? parsed : 0;
  }

  function stale(doc, now) {
    var at = savedAt(doc);
    if (!at) return true;
    return (now == null ? Date.now() : now) - at > STALE_MS;
  }

  function newer(a, b) {
    return savedAt(a) > savedAt(b);
  }

  function showBar(doc, now, settled) {
    if (settled) return false;
    return stale(doc, now);
  }

  function arrival(opts) {
    var scrollY = opts && Number(opts.scrollY) || 0;
    if (scrollY >= SCROLL_PX || (opts && opts.read)) return "pill";
    return "insert";
  }

  function orderMs(post, now) {
    var api = (typeof globalThis !== "undefined" && globalThis.FeedOrder) || null;
    if (api && api.orderMs) return api.orderMs(post, now);
    var fields = post && post.kind === "repost" ? ["sortDate", "date"] : ["date", "sortDate"];
    var clock = now == null ? Date.now() : now;
    for (var i = 0; i < fields.length; i++) {
      var ms = Date.parse(post && post[fields[i]] || "");
      if (!isFinite(ms) || ms <= 0) continue;
      if (ms > clock + 10 * 60 * 1000) continue;
      return ms;
    }
    return 0;
  }

  function byTime(a, b, now) {
    var am = orderMs(a, now);
    var bm = orderMs(b, now);
    if (am !== bm) return bm - am;
    var aid = String((a && a.id) || "");
    var bid = String((b && b.id) || "");
    return aid < bid ? 1 : aid > bid ? -1 : 0;
  }

  function mergePosts(known, incoming, now) {
    var posts = (known || []).slice();
    var index = {};
    posts.forEach(function (post, i) {
      if (post && post.id != null) index[String(post.id)] = i;
    });
    var added = [];
    (incoming || []).forEach(function (post) {
      if (!post || post.id == null) return;
      var id = String(post.id);
      if (Object.prototype.hasOwnProperty.call(index, id)) return;
      index[id] = posts.length;
      posts.push(post);
      added.push(post);
    });
    posts.sort(function (a, b) { return byTime(a, b, now); });
    added.sort(function (a, b) { return byTime(a, b, now); });
    return { posts: posts, added: added };
  }

  function place(known, incoming, opts) {
    var now = opts && opts.now != null ? opts.now : Date.now();
    var mode = arrival(opts || {});
    var merged = mergePosts(known, incoming, now);
    if (mode === "pill") {
      return {
        mode: mode,
        posts: (known || []).slice(),
        pending: merged.added,
        pill: merged.added.length > 0
      };
    }
    return { mode: mode, posts: merged.posts, pending: [], pill: false };
  }

  function activeTab(hash) {
    var path = String(hash || "").split("?")[0];
    if (path === "#/following" || path.indexOf("#/following/") === 0) return "following";
    if (path.indexOf("#/tab/") === 0) {
      try { return "list:" + decodeURIComponent(path.slice(6)); }
      catch (err) { return "list:" + path.slice(6); }
    }
    if (path.indexOf("#/cat/") === 0) {
      try { return "cat:" + decodeURIComponent(path.slice(6)); }
      catch (err) { return "cat:" + path.slice(6); }
    }
    return "foryou";
  }

  function tabsToRefresh(active, pinned) {
    var out = [];
    var seen = {};
    function add(id) {
      var key = String(id || "");
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(key);
    }
    add(active || "foryou");
    (pinned || []).forEach(add);
    return out;
  }

  function slimDoc(doc, now) {
    var posts = ((doc && doc.posts) || []).slice(0, 40).map(function (post) {
      if (!post || post.id == null) return null;
      return {
        id: post.id,
        statusId: post.statusId || post.id,
        platform: post.platform || "",
        feedId: post.feedId || "",
        kind: post.kind || "post",
        date: post.date || "",
        sortDate: post.sortDate || "",
        text: post.text || "",
        title: post.title || "",
        author: post.author || "",
        handle: post.handle || "",
        avatar: post.avatar || ""
      };
    }).filter(Boolean);
    posts.sort(function (a, b) { return byTime(a, b, now || Date.now()); });
    return {
      savedAt: now || Date.now(),
      updated: (doc && doc.updated) || "",
      posts: posts.slice(0, 40),
      feeds: (doc && doc.feeds) || []
    };
  }

  function videoUrl(url, type) {
    var path = "";
    var host = "";
    try {
      var parsed = new URL(String(url || ""), "https://viktorychapp.local");
      path = parsed.pathname || "";
      host = parsed.hostname || "";
    } catch (err) {
      path = String(url || "");
    }
    if (/(^|\.)video\.twimg\.com$/i.test(host)) return true;
    if (/\.(?:mp4|m4s|webm|m3u8|m4v|mov|ts)(?:$|\?)/i.test(path)) return true;
    if (/^video\//i.test(String(type || ""))) return true;
    return false;
  }

  function cacheMode(reason) {
    if (reason === "boot" || reason === "refresh" || reason === "sync" || reason === "push") return "revalidate";
    return "swr";
  }

  function periodicSupport() {
    return {
      minIntervalMs: PERIODIC_MIN_MS,
      chromeInstalled: "runs",
      edgeInstalled: "runs",
      chromeTab: "absent",
      braveAndroid: "absent",
      safari: "absent",
      firefox: "absent"
    };
  }

  return {
    STALE_MS: STALE_MS,
    VISIBLE_MS: VISIBLE_MS,
    PERIODIC_MIN_MS: PERIODIC_MIN_MS,
    SCROLL_PX: SCROLL_PX,
    savedAt: savedAt,
    stale: stale,
    newer: newer,
    showBar: showBar,
    arrival: arrival,
    orderMs: orderMs,
    mergePosts: mergePosts,
    place: place,
    activeTab: activeTab,
    tabsToRefresh: tabsToRefresh,
    slimDoc: slimDoc,
    videoUrl: videoUrl,
    cacheMode: cacheMode,
    periodicSupport: periodicSupport
  };
});
