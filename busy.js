/* Busy accounts. Some sources post hundreds of times a day, mostly replies
   to other people. Everything here runs on the device, from posts it already
   has, so it works offline and costs no request:

   - stats():  posts per day and the share that are replies to other people,
               per account, from the newest 48 hours in the local cache.
   - shape():  the Home timeline with each account's choice applied. Busy
               accounts default to "auto": no replies to other people (X shows
               those only on the profile) and at most CAP posts per WINDOW;
               the rest fold into one "+N more" row that is only rendered
               (media, previews, reactions) when the reader opens it.
   - interleave(): no single account takes more than SHARE of a screen.

   Per-account choices live in settings.busyPrefs and sync with the account:
   auto (the default), all, originals, top, digest, plus a timed mute.
   serverRules() lists the hashed-key rules the server may use to drop
   replies before they are sent, only for accounts the reader set to
   "originals" and only while busyPrefs.server is not false. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViktorychBusy = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var HOUR = 3600000;
  var DAY = 24 * HOUR;
  var RULES = {
    span: 48 * HOUR,     // how far back the rate looks
    minSpan: 12 * HOUR,  // a short burst is not read as a whole day's pace
    minPosts: 8,         // fewer posts than this is never busy
    perDay: 30,          // busy at this many posts a day
    replyPerDay: 12,     // or at this many when most of them are replies
    replyShare: 0.5,
    cap: 3,              // posts shown per account per window
    window: 2 * HOUR,
    share: 0.2,          // of one screen
    screen: 10,          // posts in one screen
    maxDefer: 15         // a post is never pushed down further than this
  };
  var MODES = ["auto", "all", "originals", "top", "digest"];
  var MAX_KEYS = 500;

  function norm(value) {
    return String(value == null ? "" : value).replace(/^@/, "").trim().toLowerCase();
  }

  /* The account a post counts against: its feed, else platform:handle. The
     same key the muted-accounts list and the profile menu use. */
  function keyOf(post) {
    if (!post || typeof post !== "object") return "";
    if (post.feedId) return String(post.feedId);
    if (post.appPost && post.authorId) return "app:" + String(post.authorId);
    var handle = norm(post.handle);
    return handle ? (post.platform || "x") + ":" + handle : "";
  }

  function isReply(post) {
    return !!(post && (post.kind === "reply" || post.parentId || (post.replyingTo && post.replyingTo.id && post.kind !== "post" && post.kind !== "quote" && post.kind !== "repost")));
  }

  /* A reply to someone else. Replies to oneself are threads and stay. */
  function replyToOther(post) {
    if (!isReply(post)) return false;
    var to = post.replyingTo || {};
    var who = norm(to.handle);
    if (who && who === norm(post.handle)) return false;
    if (to.authorId && post.authorId && String(to.authorId) === String(post.authorId)) return false;
    return true;
  }

  function timeOf(post) {
    var t = Date.parse((post && (post.sortDate || post.date)) || "");
    if (!isFinite(t)) t = Number(post && post.createdAt) || 0;
    return t;
  }

  function heat(post) {
    var s = (post && post.stats) || {};
    return (Number(s.likes) || 0) + 2 * (Number(s.reposts) || 0) + (Number(s.replies) || 0) + 2 * (Number(s.quotes) || 0)
      + (Number(post && post.likes) || 0) + (Number(post && post.replyCount) || 0);
  }

  /* One pass over the cache. The clock is the newest post seen, not the
     wall clock, so an old offline cache still reads the pace it had. */
  function stats(posts, opts) {
    var o = opts || {};
    var list = Array.isArray(posts) ? posts : [];
    var ref = 0;
    for (var i = 0; i < list.length; i++) { var t0 = timeOf(list[i]); if (t0 > ref) ref = t0; }
    if (o.now && (!ref || o.now < ref)) ref = o.now;
    var from = ref - RULES.span;
    var acc = {};
    var seen = {};
    for (var j = 0; j < list.length; j++) {
      var post = list[j];
      var t = timeOf(post);
      if (!t || t < from || t > ref + HOUR) continue;
      var id = String((post && (post.statusId || post.id)) || "");
      var key = keyOf(post);
      if (!key || (id && seen[key + "|" + id])) continue;
      if (id) seen[key + "|" + id] = 1;
      var row = acc[key] || (acc[key] = { n: 0, replies: 0, oldest: t });
      row.n += 1;
      if (replyToOther(post)) row.replies += 1;
      if (t < row.oldest) row.oldest = t;
    }
    var out = {};
    Object.keys(acc).forEach(function (key) {
      var row = acc[key];
      var span = Math.max(ref - row.oldest, RULES.minSpan) / DAY;
      var perDay = row.n / span;
      var share = row.n ? row.replies / row.n : 0;
      out[key] = {
        n: row.n,
        perDay: Math.round(perDay * 10) / 10,
        replyShare: Math.round(share * 100) / 100,
        busy: row.n >= RULES.minPosts && (perDay >= RULES.perDay || (perDay >= RULES.replyPerDay && share >= RULES.replyShare))
      };
    });
    return out;
  }

  /* The same pass in slices, so a large cache never holds the main thread.
     Calls back with the result; returns a cancel function. */
  function statsLater(posts, opts, done) {
    var list = Array.isArray(posts) ? posts.slice() : [];
    var cancelled = false;
    var idle = (typeof requestIdleCallback === "function") ? requestIdleCallback : function (fn) { return setTimeout(function () { fn({ timeRemaining: function () { return 8; } }); }, 16); };
    // Sort-free: only posts within the span matter, so filter in slices first.
    var keep = [];
    var at = 0;
    var ref = 0;
    function step(deadline) {
      if (cancelled) return;
      var stop = at + 400;
      for (; at < list.length && at < stop; at++) {
        var t = timeOf(list[at]);
        if (t > ref) ref = t;
        keep.push(list[at]);
        if (deadline && deadline.timeRemaining && deadline.timeRemaining() < 1) { at++; break; }
      }
      if (at < list.length) { idle(step, { timeout: 500 }); return; }
      var from = ref - RULES.span;
      done(stats(keep.filter(function (p) { return timeOf(p) >= from; }), opts));
    }
    idle(step, { timeout: 500 });
    return function () { cancelled = true; };
  }

  function cleanPrefs(raw) {
    var src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    var modes = {};
    var mutes = {};
    var m = src.modes && typeof src.modes === "object" && !Array.isArray(src.modes) ? src.modes : {};
    Object.keys(m).slice(-MAX_KEYS).forEach(function (key) {
      if (key && key.length <= 200 && MODES.indexOf(m[key]) > 0) modes[key] = m[key];
    });
    var u = src.mutes && typeof src.mutes === "object" && !Array.isArray(src.mutes) ? src.mutes : {};
    var now = Date.now();
    Object.keys(u).slice(-MAX_KEYS).forEach(function (key) {
      var until = Number(u[key]) || 0;
      if (key && key.length <= 200 && until > now) mutes[key] = until;
    });
    return { at: Number(src.at) || 0, modes: modes, mutes: mutes, server: src.server !== false };
  }

  function setMode(prefs, key, mode) {
    var p = cleanPrefs(prefs);
    if (!key) return p;
    if (mode === "auto" || MODES.indexOf(mode) < 0) delete p.modes[key];
    else p.modes[key] = mode;
    p.at = Date.now();
    return p;
  }

  function mute(prefs, key, until) {
    var p = cleanPrefs(prefs);
    if (!key) return p;
    if (until && until > Date.now()) p.mutes[key] = until;
    else delete p.mutes[key];
    p.at = Date.now();
    return p;
  }

  /* "muted", "all", "originals", "top", "digest", or "auto" (busy only). */
  function modeFor(prefs, key, busy, now) {
    var p = prefs || {};
    var until = p.mutes && p.mutes[key];
    if (until && until > (now || Date.now())) return "muted";
    var chosen = p.modes && p.modes[key];
    if (chosen && chosen !== "auto") return chosen;
    return busy ? "auto" : "all";
  }

  function dayOf(t) {
    var d = new Date(t);
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  /* The timeline with every account's choice applied. Rows come back as the
     posts themselves, or as one group object { busyGroup, kind, id, key,
     posts } in place of the posts it folds. A group the reader opened comes
     back as its posts. Nothing is fetched or rendered for folded posts. */
  function shape(list, ctx) {
    var c = ctx || {};
    var prefs = c.prefs || {};
    var busy = c.busy || {};
    var open = c.open || {};
    var now = c.now || Date.now();
    var cap = c.cap || RULES.cap;
    var win = c.window || RULES.window;
    var src = Array.isArray(list) ? list : [];
    var out = [];
    var groups = {};
    var shown = {};
    var counts = { hidden: 0, folded: 0, muted: 0, digest: 0 };
    var top = null;

    function topSet() {
      if (top) return top;
      top = {};
      var by = {};
      src.forEach(function (post) {
        var key = keyOf(post);
        if (key && modeFor(prefs, key, !!(busy[key] && busy[key].busy), now) === "top") (by[key] || (by[key] = [])).push(post);
      });
      Object.keys(by).forEach(function (key) {
        var rows = by[key].slice().sort(function (a, b) { return heat(b) - heat(a); });
        var keep = Math.max(1, Math.ceil(rows.length / 4));
        top[key] = new Set(rows.slice(0, keep));
      });
      return top;
    }
    function group(kind, id, key, post, at) {
      var g = groups[id];
      if (!g) {
        g = { busyGroup: true, kind: kind, id: id, key: key, posts: [], sortDate: post.sortDate || post.date || "", date: post.date || "", feedId: post.feedId || "", handle: post.handle || "", platform: post.platform || "", author: post.author || post.name || "", avatar: post.avatar || "" };
        groups[id] = g;
        out.splice(at == null ? out.length : at, 0, g);
      }
      g.posts.push(post);
      return g;
    }

    for (var i = 0; i < src.length; i++) {
      var post = src[i];
      if (!post || post.busyGroup) { if (post) out.push(post); continue; }
      var key = keyOf(post);
      if (!key) { out.push(post); continue; }
      var mode = modeFor(prefs, key, !!(busy[key] && busy[key].busy), now);
      if (mode === "all") { out.push(post); continue; }
      if (mode === "muted") { counts.muted += 1; continue; }
      if (mode === "originals" ? isReply(post) : (mode === "auto" && replyToOther(post))) { counts.hidden += 1; continue; }
      var t = timeOf(post);
      if (mode === "digest") {
        counts.digest += 1;
        group("digest", "d|" + key + "|" + dayOf(t), key, post);
        continue;
      }
      if (mode === "top") {
        if (topSet()[key] && topSet()[key].has(post)) { out.push(post); continue; }
        counts.folded += 1;
        group("more", "t|" + key + "|" + dayOf(t), key, post);
        continue;
      }
      // auto: CAP posts per account per window, the rest folded.
      var bucket = key + "|" + Math.floor(t / win);
      if ((shown[bucket] || 0) < cap) {
        shown[bucket] = (shown[bucket] || 0) + 1;
        out.push(post);
        continue;
      }
      counts.folded += 1;
      group("more", "m|" + bucket, key, post);
    }
    // Open groups turn back into their posts, in place.
    var final = [];
    out.forEach(function (row) {
      if (row && row.busyGroup && open[row.id]) {
        row.posts.forEach(function (p) { final.push(p); });
        return;
      }
      if (row && row.busyGroup && row.kind === "more" && row.posts.length === 1 && !c.keepSingles) {
        // One extra post is cheaper to show than a row about it.
        final.push(row.posts[0]);
        counts.folded -= 1;
        return;
      }
      final.push(row);
    });
    final.counts = counts;
    return final;
  }

  /* Reorder so no account holds more than SHARE of any SCREEN-long run.
     Each slot takes the earliest post, within the next LOOK posts, whose
     account still has room; an account's own posts keep their order. When
     nothing nearby has room (one account left), the earliest post goes. */
  function interleave(list, opts) {
    var o = opts || {};
    var screen = o.screen || RULES.screen;
    var per = Math.max(1, Math.floor(screen * (o.share || RULES.share)));
    var look = o.look || RULES.maxDefer * 2;
    var keyFn = o.keyOf || keyOf;
    var src = Array.isArray(list) ? list : [];
    var queue = src.map(function (item) { return { item: item, key: keyFn(item) }; });
    var out = [];
    var recent = [];
    var count = {};
    function push(row) {
      out.push(row.item);
      recent.push(row.key);
      if (row.key) count[row.key] = (count[row.key] || 0) + 1;
      if (recent.length >= screen) {
        var old = recent.shift();
        if (old) count[old] -= 1;
      }
    }
    var head = 0;
    var taken = new Uint8Array(queue.length);
    while (head < queue.length) {
      while (head < queue.length && taken[head]) head++;
      if (head >= queue.length) break;
      var pick = -1;
      var blocked = {};
      for (var i = head, seen = 0; i < queue.length && seen < look; i++) {
        if (taken[i]) continue;
        seen++;
        var key = queue[i].key;
        if (key && blocked[key]) continue;
        if (!key || (count[key] || 0) < per) { pick = i; break; }
        blocked[key] = true;
      }
      if (pick < 0) pick = head;
      taken[pick] = 1;
      push(queue[pick]);
    }
    if (src.counts) out.counts = src.counts;
    return out;
  }

  /* Typed keys (as in shared/blocklist.js) for replies the server may drop
     before sending: only accounts set to "originals", only with server help on. */
  function serverRules(prefs) {
    var p = cleanPrefs(prefs);
    if (!p.server) return [];
    return Object.keys(p.modes).filter(function (key) { return p.modes[key] === "originals"; }).map(function (key) { return "r|" + norm(key); });
  }

  return {
    RULES: RULES, MODES: MODES, keyOf: keyOf, isReply: isReply, replyToOther: replyToOther, timeOf: timeOf, heat: heat,
    stats: stats, statsLater: statsLater, cleanPrefs: cleanPrefs, setMode: setMode, mute: mute, modeFor: modeFor,
    shape: shape, interleave: interleave, serverRules: serverRules
  };
});
