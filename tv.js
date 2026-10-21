/* TV mode for Feeds. ES2017, no optional chaining, for Tizen and webOS browsers.
   Remote: arrows, Enter/OK, Back (Escape, Backspace, 10009, 461),
   media keys, and color keys 403-406. */
(function () {
  var KEY = "rss-feeds-settings-v1";
  var TV = {
    on: false,
    attached: false,
    data: null,
    people: [],
    settings: null,
    stack: [],
    shelfMemory: {},
    pageMemory: {},
    rowSpecs: {},
    shelfOrder: [],
    menu: null,
    player: null,
    previewTimer: 0,
    hold: 0,
    holdFired: false,
    query: "",
    muted: false,
    toastTimer: 0,
    scrolls: {},
    stageScroll: 0,
    loading: false
  };

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function loadSettings() {
    var parsed = null;
    try { parsed = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (err) { parsed = null; }
    if (!parsed || typeof parsed !== "object") parsed = {};
    if (!parsed.tvMode) parsed.tvMode = "auto";
    if (!parsed.appearance) parsed.appearance = "lightsout";
    if (!Array.isArray(parsed.follows)) parsed.follows = [];
    if (!Array.isArray(parsed.lists)) parsed.lists = [];
    if (!Array.isArray(parsed.groups)) parsed.groups = [];
    if (!parsed.likes || typeof parsed.likes !== "object") parsed.likes = {};
    if (!parsed.bookmarks || typeof parsed.bookmarks !== "object") parsed.bookmarks = {};
    if (!parsed.autoplay) parsed.autoplay = "all";
    return parsed;
  }

  function patchSettings(mutator) {
    var current = loadSettings();
    mutator(current);
    TV.settings = current;
    try { localStorage.setItem(KEY, JSON.stringify(current)); } catch (err) { /* private mode */ }
  }

  function queryFlag() {
    var blob = String(location.search || "") + "&" + String(location.hash || "");
    if (/[?&]tv=0(?:&|$)/.test(blob)) return "off";
    if (/[?&]tv=1(?:&|$)/.test(blob)) return "on";
    return "";
  }

  function isTvUa() {
    var ua = String(navigator.userAgent || "");
    return /Tizen|Web0S|webOS|SMART-TV|SmartTV|Smart-TV|BRAVIA|Bravia|CrKey|AFT[A-Z0-9]|Android TV|GoogleTV|HbbTV|Viera|NetCast|TV Bro|Fire TV|FireTV|AppleTV|Apple TV|Roku|VIDAA|Hisense|SmartHub|LivingRoom|Maple/i.test(ua);
  }

  function coarseLarge() {
    var w = window.innerWidth || 0;
    var h = window.innerHeight || 0;
    if (w < 960 || h < 520) return false;
    var touch = (navigator.maxTouchPoints || 0) > 0;
    var fine = false;
    try { fine = window.matchMedia("(pointer: fine)").matches; } catch (err) { fine = false; }
    return !touch && !fine;
  }

  function shouldEnable() {
    var flag = queryFlag();
    if (flag === "on") return true;
    if (flag === "off") return false;
    var mode = (TV.settings && TV.settings.tvMode) || "auto";
    if (mode === "on") return true;
    if (mode === "off") return false;
    return isTvUa() || coarseLarge();
  }

  function settingsHtml() {
    var settings = TV.settings || loadSettings();
    var on = !!(TV.on || settings.tvMode === "on");
    return '<h2>Display</h2><p class="phandle">TV mode is the 10-foot layout for a remote. It turns on by itself on Tizen, webOS, Android TV, and Fire TV. Add ?tv=1 to force it.</p><div class="theme-row"><button class="outline' + (on ? " on" : "") + '" type="button" data-tv-toggle="1" aria-pressed="' + (on ? "true" : "false") + '">TV mode</button></div>';
  }

  function icon(name) {
    var paths = {
      home: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z",
      subs: "M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm5 2.5v7l6-3.5z",
      search: "M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zm5.4 10.5 3.6 3.6",
      bell: "M12 3a6 6 0 0 0-6 6v3.2L4.4 15h15.2L18 12.2V9a6 6 0 0 0-6-6zm0 18a2.4 2.4 0 0 0 2.3-2h-4.6A2.4 2.4 0 0 0 12 21z",
      mail: "M3 6h18v12H3zM3 7l9 7 9-7",
      user: "M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-7 8a7 7 0 0 1 14 0",
      gear: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm8.5 4-1.8-.6.2-1.8-1.5-1.2-1.6.8-1.4-1.2.4-1.8H11.2l.4 1.8-1.4 1.2-1.6-.8-1.5 1.2.2 1.8L5.5 12l1.8.6-.2 1.8 1.5 1.2 1.6-.8 1.4 1.2-.4 1.8h3.6l-.4-1.8 1.4-1.2 1.6.8 1.5-1.2-.2-1.8z"
    };
    var d = paths[name] || paths.home;
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>';
  }

  var NAV = [
    { id: "home", href: "#/", label: "Home", icon: "home" },
    { id: "subs", href: "#/subscriptions", label: "Subscriptions", icon: "subs" },
    { id: "search", href: "#/explore", label: "Search", icon: "search" },
    { id: "notes", href: "#/notifications", label: "Notifications", icon: "bell" },
    { id: "mail", href: "#/messages", label: "Messages", icon: "mail" },
    { id: "profile", href: "#/you", label: "Profile", icon: "user" },
    { id: "settings", href: "#/settings", label: "Settings", icon: "gear" }
  ];

  function ensureRoot() {
    var root = document.getElementById("tv-root");
    if (root) return root;
    root = document.createElement("div");
    root.id = "tv-root";
    root.hidden = true;
    root.innerHTML = '<nav class="tv-rail" id="tv-rail" aria-label="Sections"></nav><div class="tv-stage" id="tv-stage"></div><div class="tv-menu" id="tv-menu" hidden></div><div class="tv-player" id="tv-player" hidden></div><div class="tv-toast" id="tv-toast" hidden></div><div class="tv-legend" id="tv-legend" hidden></div>';
    document.body.appendChild(root);
    return root;
  }

  function posts() { return (TV.data && TV.data.posts) || []; }
  function feedList() { return (TV.data && TV.data.feeds) || []; }

  function findPostById(id) {
    var list = posts();
    var wanted = String(id || "");
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === wanted || String(list[i].statusId || "") === wanted) return list[i];
    }
    return null;
  }

  function findStatus(platform, handle, id) {
    var list = posts();
    var wanted = String(id || "");
    var who = String(handle || "").toLowerCase();
    for (var i = 0; i < list.length; i++) {
      var post = list[i];
      if ((post.platform || "x") !== platform) continue;
      if (String(post.statusId || post.id) !== wanted && String(post.id) !== wanted) continue;
      if (who && String(post.handle || "").toLowerCase() !== who) continue;
      return post;
    }
    return findPostById(id);
  }

  function feedById(id) {
    var list = feedList();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function stamp(post) { return (post && (post.sortDate || post.date)) || ""; }

  function byNewest(a, b) {
    if (stamp(a) < stamp(b)) return 1;
    if (stamp(a) > stamp(b)) return -1;
    return 0;
  }

  function youtubeId(post) {
    var media = (post && post.media) || [];
    var blob = "";
    for (var i = 0; i < media.length; i++) {
      blob += " " + ((media[i] && (media[i].videoId || media[i].url)) || "");
    }
    blob += " " + ((post && post.url) || "") + " " + ((post && post.statusId) || "") + " " + ((post && post.id) || "");
    var match = blob.match(/(?:embed\/|watch\?v=|youtu\.be\/|shorts\/|[?&]v=)([A-Za-z0-9_-]{11})/);
    if (match) return match[1];
    if (post && post.platform === "youtube" && post.kind !== "community") {
      var id = String(post.statusId || post.id || "");
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }
    return "";
  }

  function videoMedia(post) {
    var media = (post && post.media) || [];
    for (var i = 0; i < media.length; i++) {
      if (media[i] && (media[i].type === "video" || media[i].type === "animated_gif")) return media[i];
    }
    return null;
  }

  function isVideoPost(post) {
    if (!post || post.kind === "reply" || post.kind === "community") return false;
    if (post.platform === "youtube" && post.kind !== "community") return true;
    return !!videoMedia(post);
  }

  function isLive(post) {
    if (!post) return false;
    if (post.live || post.isLive) return true;
    var media = post.media || [];
    for (var i = 0; i < media.length; i++) if (media[i] && media[i].live) return true;
    var blob = String(post.url || "") + " " + String(post.title || "") + " " + String(post.text || "");
    if (/\/live(\/|$|\?)/i.test(blob)) return true;
    var when = Date.parse(post.date || "");
    if (/youtube/i.test(post.platform || "") && /\blive now\b|\bis live\b/i.test(blob) && when && (Date.now() - when) < 12 * 3600 * 1000) return true;
    return false;
  }

  function followedIds() {
    var ids = (TV.settings && TV.settings.follows) || [];
    if (ids.length) return ids;
    var list = feedList();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id && list[i].configured !== false) out.push(list[i].id);
    }
    return out;
  }

  function isFollowedPost(post) {
    var ids = followedIds();
    if (ids.indexOf(post.feedId) >= 0) return true;
    return ids.indexOf((post.platform || "x") + ":" + (post.handle || "")) >= 0;
  }

  function memberOf(group, post) {
    var members = (group && group.members) || [];
    if (members.indexOf(post.feedId) >= 0) return true;
    return members.indexOf((post.platform || "x") + ":" + (post.handle || "")) >= 0;
  }

  function formatDur(value) {
    var n = Number(value);
    if (!isFinite(n) || n <= 0) return "";
    if (n > 100000) n = Math.round(n / 1000);
    n = Math.round(n);
    var h = Math.floor(n / 3600);
    var m = Math.floor((n % 3600) / 60);
    var s = n % 60;
    function pad(x) { return (x < 10 ? "0" : "") + x; }
    if (h) return h + ":" + pad(m) + ":" + pad(s);
    return m + ":" + pad(s);
  }

  function clock(value) {
    var n = Math.max(0, Math.floor(Number(value) || 0));
    var m = Math.floor(n / 60);
    var s = n % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function relTime(iso) {
    var then = Date.parse(iso || "");
    if (!then) return "";
    var delta = Math.max(0, Date.now() - then);
    var min = Math.floor(delta / 60000);
    if (min < 1) return "now";
    if (min < 60) return min + "m";
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + "h";
    var day = Math.floor(hr / 24);
    if (day < 7) return day + "d";
    try {
      return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch (err) {
      return "";
    }
  }

  function platformLabel(platform) {
    var names = { x: "X", threads: "Threads", instagram: "Instagram", rss: "RSS", youtube: "YouTube", vk: "VK", discord: "Discord", telegram: "Telegram" };
    return names[platform] || platform || "";
  }

  function clip(text, max) {
    var value = String(text || "").replace(/\s+/g, " ").trim();
    if (value.length <= max) return value;
    return value.slice(0, max - 1) + "…";
  }

  function posterOf(post) {
    var media = (post && post.media) || [];
    for (var i = 0; i < media.length; i++) {
      if (!media[i]) continue;
      if (media[i].poster) return media[i].poster;
      if (media[i].type === "photo" && media[i].url) return media[i].url;
    }
    var yt = youtubeId(post);
    if (yt) return "https://i.ytimg.com/vi/" + yt + "/hqdefault.jpg";
    if (post && post.images && post.images.length) return post.images[0];
    return "";
  }

  function durationOf(post) {
    var media = videoMedia(post);
    if (media && media.duration) return formatDur(media.duration);
    if (post && post.duration) return formatDur(post.duration);
    return "";
  }

  function streamOf(post) {
    var media = videoMedia(post) || ((post && post.media) || [])[0] || null;
    if (media && media.stream) return media.stream;
    if (media && media.type === "video" && media.url && !/youtube/i.test(media.url)) return media.url;
    return "";
  }

  function profileHash(post) {
    var platform = (post && post.platform) || "x";
    var handle = (post && post.handle) || "";
    if (platform === "x") return "#/@" + encodeURIComponent(handle);
    return "#/" + platform + "/" + encodeURIComponent(handle);
  }

  function statusHash(post) {
    var platform = (post && post.platform) || "x";
    var handle = (post && post.handle) || "";
    var id = (post && (post.statusId || post.id)) || "";
    if (platform === "x") return "#/@" + encodeURIComponent(handle) + "/status/" + encodeURIComponent(id);
    return "#/" + platform + "/" + encodeURIComponent(handle) + "/status/" + encodeURIComponent(id);
  }

  function watchHash(post) {
    return "#/watch/" + ((post && post.platform) || "youtube") + ":" + encodeURIComponent((post && (post.statusId || post.id)) || "");
  }

  function parseRoute() {
    var hash = location.hash || "#/";
    var qAt = hash.indexOf("?");
    var query = {};
    if (qAt >= 0) {
      var bits = hash.slice(qAt + 1).split("&");
      for (var q = 0; q < bits.length; q++) {
        var pair = bits[q].split("=");
        try {
          query[decodeURIComponent(pair[0] || "")] = decodeURIComponent((pair[1] || "").replace(/\+/g, " "));
        } catch (err) { /* ignore a bad query */ }
      }
      hash = hash.slice(0, qAt);
    }
    var parts = hash.replace(/^#/, "").split("/").filter(function (part) { return !!part; });
    for (var i = 0; i < parts.length; i++) {
      try { parts[i] = decodeURIComponent(parts[i]); } catch (err) { /* keep raw */ }
    }
    if (!parts.length || parts[0] === "home") return { name: "home", query: query };
    if (parts[0] === "following") return { name: "home", jump: "following", query: query };
    if (parts[0] === "tab" && parts[1]) return { name: "home", jump: "list-" + parts[1], query: query };
    if (parts[0] === "subscriptions") return { name: "subs", query: query };
    if (parts[0] === "explore") return { name: "search", query: query };
    if (parts[0] === "notifications") return { name: "notes", query: query };
    if (parts[0] === "messages") return { name: "messages", query: query };
    if (parts[0] === "settings") return { name: "settings", query: query };
    if (parts[0] === "you") return { name: "you", query: query };
    if (parts[0] === "p" && parts[1]) return { name: "person", slug: parts[1], query: query };
    if (parts[0] === "watch") {
      var spec = parts.slice(1).join("/");
      var cut = spec.indexOf(":");
      return { name: "watch", platform: cut > 0 ? spec.slice(0, cut) : "youtube", id: cut > 0 ? spec.slice(cut + 1) : spec, query: query };
    }
    if (parts[0].charAt(0) === "@") {
      var handle = parts[0].slice(1);
      if (parts[1] === "status" && parts[2]) return { name: "status", platform: "x", handle: handle, id: parts.slice(2).join("/"), query: query };
      return { name: "profile", platform: "x", handle: handle, query: query };
    }
    var known = { x: 1, threads: 1, instagram: 1, rss: 1, youtube: 1, vk: 1, discord: 1, telegram: 1 };
    if (known[parts[0]] && parts[1]) {
      if (parts[2] === "status" && parts[3]) return { name: "status", platform: parts[0], handle: parts[1], id: parts.slice(3).join("/"), query: query };
      return { name: "profile", platform: parts[0], handle: parts[1], query: query };
    }
    return { name: "home", query: query };
  }

  function pageKey(route) {
    route = route || parseRoute();
    if (route.name === "home") return "home";
    if (route.name === "profile") return "profile:" + route.platform + ":" + route.handle;
    if (route.name === "person") return "person:" + route.slug;
    if (route.name === "status") return "status:" + route.platform + ":" + route.id;
    if (route.name === "watch") return "watch:" + route.platform + ":" + route.id;
    return route.name;
  }

  function cardMetrics(kind) {
    var narrow = (window.innerWidth || 1920) < 1400;
    if (kind === "video") return { cardW: narrow ? 360 : 420, gap: 28, rowClass: "videos" };
    if (kind === "account") return { cardW: narrow ? 300 : 360, gap: 24, rowClass: "accounts" };
    return { cardW: narrow ? 440 : 520, gap: 28, rowClass: "posts" };
  }

  function sorted(list) {
    return list.slice().sort(byNewest);
  }

  function homeShelves() {
    var list = sorted(posts());
    var shelves = [];
    shelves.push({ id: "foryou", title: "For You", items: list, kind: "post" });
    shelves.push({ id: "following", title: "Following", items: list.filter(isFollowedPost), kind: "post" });
    var lists = (TV.settings && TV.settings.lists) || [];
    for (var i = 0; i < lists.length; i++) {
      if (!lists[i] || !lists[i].pinned) continue;
      var members = lists[i].members || [];
      shelves.push({
        id: "list-" + lists[i].id,
        title: lists[i].name || "List",
        items: list.filter(function (post) { return members.indexOf(post.feedId) >= 0; }),
        kind: "post"
      });
    }
    var groups = (TV.settings && TV.settings.groups) || [];
    for (var g = 0; g < groups.length; g++) {
      shelves.push({
        id: "group-" + (groups[g].id || g),
        title: groups[g].name || "Group",
        items: list.filter(function (post) { return memberOf(groups[g], post); }),
        kind: "post"
      });
    }
    shelves.push({ id: "subs", title: "Subscriptions", items: list.filter(isVideoPost), kind: "video" });
    shelves.push({ id: "live", title: "Live now", items: list.filter(isLive), kind: "video", empty: "Nothing live right now" });
    var platforms = ["youtube", "x", "instagram", "threads", "vk", "discord", "telegram", "rss"];
    for (var p = 0; p < platforms.length; p++) {
      var name = platforms[p];
      var items = list.filter(function (post) { return post.platform === name; });
      if (!items.length) continue;
      var videos = 0;
      for (var n = 0; n < items.length; n++) if (isVideoPost(items[n])) videos++;
      shelves.push({ id: "plat-" + name, title: platformLabel(name), items: items, kind: videos === items.length ? "video" : "post" });
    }
    return shelves.filter(function (shelf) { return shelf.items.length || shelf.empty; });
  }

  function subsShelves() {
    var list = sorted(posts().filter(isVideoPost));
    var map = {};
    var order = [];
    for (var i = 0; i < list.length; i++) {
      var id = list[i].feedId || ((list[i].platform || "x") + ":" + (list[i].handle || ""));
      if (!map[id]) { map[id] = []; order.push(id); }
      map[id].push(list[i]);
    }
    return order.map(function (id) {
      var sample = map[id][0];
      return {
        id: "ch-" + String(id).replace(/[^a-zA-Z0-9_-]/g, "_"),
        title: sample.author || sample.handle || "Channel",
        items: map[id],
        kind: "video"
      };
    });
  }

  function personBySlug(slug) {
    var people = TV.people || [];
    var wanted = String(slug || "").toLowerCase();
    for (var i = 0; i < people.length; i++) {
      if (String(people[i].id || "").toLowerCase() === wanted) return people[i];
    }
    return null;
  }

  function personFor(platform, handle) {
    var people = TV.people || [];
    var who = String(handle || "").toLowerCase();
    for (var i = 0; i < people.length; i++) {
      var accounts = people[i].accounts || [];
      for (var j = 0; j < accounts.length; j++) {
        if (accounts[j].platform === platform && String(accounts[j].handle || "").toLowerCase() === who) return people[i];
      }
    }
    return null;
  }

  function accountPosts(account) {
    var id = account.feedId || ((account.platform || "") + ":" + (account.handle || ""));
    return sorted(posts().filter(function (post) {
      if (post.feedId && post.feedId === id) return true;
      return post.platform === account.platform && String(post.handle || "").toLowerCase() === String(account.handle || "").toLowerCase();
    }));
  }

  function repliesFor(post) {
    var id = String((post && (post.statusId || post.id)) || "");
    return sorted(posts().filter(function (item) {
      if (!item || item.id === post.id) return false;
      var to = item.replyingTo || {};
      return String(to.id || "") === id;
    }));
  }

  function navOn(route, item) {
    if (item.id === "home") return route.name === "home" || route.name === "watch";
    if (item.id === "subs") return route.name === "subs";
    if (item.id === "search") return route.name === "search";
    if (item.id === "notes") return route.name === "notes";
    if (item.id === "mail") return route.name === "messages";
    if (item.id === "profile") return route.name === "you" || route.name === "profile" || route.name === "person" || route.name === "status";
    if (item.id === "settings") return route.name === "settings";
    return false;
  }

  function paintNav(route) {
    var rail = document.getElementById("tv-rail");
    if (!rail) return;
    var html = "";
    for (var i = 0; i < NAV.length; i++) {
      var item = NAV[i];
      html += '<button type="button" class="tv-nav-btn' + (navOn(route, item) ? " is-on" : "") + '" data-tv="1" data-zone="nav" data-tv-id="nav-' + item.id + '" data-act="nav" data-href="' + esc(item.href) + '" aria-label="' + esc(item.label) + '"><span class="tv-ico">' + icon(item.icon) + '</span><span class="tv-label">' + esc(item.label) + '</span></button>';
    }
    rail.innerHTML = html;
  }

  function shelfHtml(shelf) {
    var metrics = cardMetrics(shelf.kind);
    var items = shelf.items || [];
    if (!items.length && shelf.empty) {
      items = [{ empty: true, key: "empty", text: shelf.empty }];
    }
    TV.rowSpecs[shelf.id] = {
      id: shelf.id,
      items: items,
      kind: shelf.kind,
      cardW: metrics.cardW,
      gap: metrics.gap,
      focusIndex: 0
    };
    var memory = TV.shelfMemory[shelf.id];
    if (memory) {
      for (var i = 0; i < items.length; i++) if (items[i].key === memory || items[i].id === memory) TV.rowSpecs[shelf.id].focusIndex = i;
    }
    TV.shelfOrder.push(shelf.id);
    return '<section class="tv-shelf" id="shelf-' + esc(shelf.id) + '"><h2 class="tv-shelf-title">' + esc(shelf.title) + '</h2><div class="tv-row ' + metrics.rowClass + '" id="row-' + esc(shelf.id) + '" data-shelf="' + esc(shelf.id) + '"><div class="tv-track"></div></div></section>';
  }

  function shelvesHtml(shelves) {
    TV.rowSpecs = {};
    TV.shelfOrder = [];
    var html = "";
    for (var i = 0; i < shelves.length; i++) html += shelfHtml(shelves[i]);
    return html;
  }

  function cardButton(item, spec, index, left) {
    var style = ' style="width:' + spec.cardW + 'px;left:' + left + 'px"';
    var id = "c-" + spec.id + "-" + index;
    if (item.empty) {
      return '<button type="button" class="tv-card tv-empty-card" data-tv="1" data-zone="card" data-shelf="' + esc(spec.id) + '" data-index="' + index + '" data-tv-id="' + id + '" data-key="empty"' + style + '>' + esc(item.text) + '</button>';
    }
    if (spec.kind === "account") {
      return '<button type="button" class="tv-account" data-tv="1" data-zone="card" data-shelf="' + esc(spec.id) + '" data-index="' + index + '" data-tv-id="' + id + '" data-key="' + esc(item.key) + '" data-act="open" data-href="' + esc(item.href) + '"' + style + '>' + avatar(item.avatar, item.name) + '<span><span class="tv-name">' + esc(item.name || "") + '</span><span class="tv-handle"> ' + esc(item.meta || "") + '</span></span></button>';
    }
    var post = item;
    var video = spec.kind === "video" || isVideoPost(post);
    var thumb = posterOf(post);
    var dur = durationOf(post);
    var live = isLive(post);
    var yt = youtubeId(post);
    var stream = streamOf(post);
    var attrs = ' data-tv="1" data-zone="card" data-shelf="' + esc(spec.id) + '" data-index="' + index + '" data-tv-id="' + id + '" data-key="' + esc(post.id) + '" data-post="' + esc(post.id) + '" data-act="card"';
    if (video) attrs += ' data-video="1"';
    if (yt) attrs += ' data-yt="' + esc(yt) + '"';
    if (stream) attrs += ' data-stream="' + esc(stream) + '"';
    if (video && spec.kind === "video") {
      return '<button type="button" class="tv-card video" ' + attrs + style + '><div class="tv-thumb">' + (thumb ? '<img alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="' + esc(thumb) + '">' : '') + (live ? '<span class="tv-live">LIVE</span>' : '') + (dur ? '<span class="tv-dur">' + esc(dur) + '</span>' : '') + '</div><div class="tv-title">' + esc(post.title || post.text || "Video") + '</div><div class="tv-by">' + avatar(post.avatar, post.author) + '<span class="tv-name">' + esc(post.author || post.handle || "") + '</span></div></button>';
    }
    var media = thumb ? '<div class="tv-media"><img alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="' + esc(thumb) + '">' + (dur ? '<span class="tv-dur">' + esc(dur) + '</span>' : '') + '</div>' : '';
    return '<button type="button" class="tv-card post' + (thumb ? "" : " no-media") + '" ' + attrs + style + '>' + media + '<div class="tv-card-body"><div class="tv-by">' + avatar(post.avatar, post.author) + '<span class="tv-name">' + esc(post.author || post.handle || "Post") + '</span><span class="tv-handle">' + (post.handle ? "@" + esc(post.handle) : "") + '</span><span class="tv-chip">' + esc(platformLabel(post.platform)) + '</span></div><div class="tv-text">' + esc(clip(post.text || post.title || "", 220)) + '</div><div class="tv-meta">' + esc(relTime(post.date)) + '</div></div></button>';
  }

  function avatar(src, name) {
    if (!src) return '<span class="tv-ava" aria-hidden="true"></span>';
    return '<img class="tv-ava" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="' + esc(src) + '">';
  }

  function paintRow(row) {
    if (!row) return;
    var spec = TV.rowSpecs[row.getAttribute("data-shelf")];
    if (!spec) return;
    var step = spec.cardW + spec.gap;
    var scroll = row.scrollLeft || 0;
    var width = row.clientWidth || 900;
    var start = Math.max(0, Math.floor(scroll / step) - 2);
    var end = Math.min(spec.items.length, Math.ceil((scroll + width) / step) + 3);
    if (spec.focusIndex < start) start = spec.focusIndex;
    if (spec.focusIndex >= end) end = Math.min(spec.items.length, spec.focusIndex + 1);
    if (end < start) end = start;
    var signature = start + ":" + end + ":" + spec.items.length + ":" + spec.cardW;
    if (row._sig === signature) return;
    row._sig = signature;
    var activeId = "";
    var active = document.activeElement;
    if (active && row.contains(active)) activeId = active.getAttribute("data-tv-id") || "";
    var html = "";
    for (var i = start; i < end; i++) html += cardButton(spec.items[i], spec, i, i * step);
    var track = row.querySelector(".tv-track");
    if (!track) return;
    track.style.width = Math.max(step, spec.items.length * step) + "px";
    track.innerHTML = html;
    if (activeId) {
      var again = row.querySelector('[data-tv-id="' + cssEscape(activeId) + '"]');
      if (again) {
        again.classList.add("tv-focus");
        try { again.focus(); } catch (err) { /* the row is moving */ }
      }
    }
  }

  function mountRows() {
    var rows = document.querySelectorAll("#tv-stage .tv-row");
    for (var i = 0; i < rows.length; i++) {
      (function (row) {
        if (row._bound) return;
        row._bound = true;
        row.addEventListener("scroll", function () {
          if (row._lock) return;
          paintRow(row);
        });
      })(rows[i]);
      paintRow(rows[i]);
    }
  }

  function action(label, act, extra) {
    extra = extra || "";
    var idAttr = extra.indexOf("data-tv-id") >= 0 ? "" : ' data-tv-id="act-' + esc(act) + '"';
    return '<button type="button" class="tv-action" data-tv="1" data-zone="ui"' + idAttr + ' data-act="' + esc(act) + '"' + extra + '>' + esc(label) + '</button>';
  }

  function detailHtml(post) {
    if (!post) return '<div class="tv-empty-page">That post is not in this snapshot.</div>';
    var thumb = posterOf(post);
    var replies = repliesFor(post);
    var liked = TV.settings && TV.settings.likes && TV.settings.likes[post.id];
    var saved = TV.settings && TV.settings.bookmarks && TV.settings.bookmarks[post.id];
    var quote = "";
    if (post.quoted && (post.quoted.text || post.quoted.author)) {
      quote = '<div class="tv-reply"><div><div class="tv-name">' + esc(post.quoted.author || "") + '</div><div class="tv-text">' + esc(post.quoted.text || "") + '</div></div></div>';
    }
    var replyHtml = "";
    if (!replies.length) replyHtml = '<p class="tv-meta">No replies in this snapshot.</p>';
    for (var i = 0; i < replies.length; i++) {
      var reply = replies[i];
      replyHtml += '<button type="button" class="tv-reply" data-tv="1" data-zone="ui" data-tv-id="reply-' + i + '" data-act="open" data-href="' + esc(statusHash(reply)) + '" data-post="' + esc(reply.id) + '">' + avatar(reply.avatar, reply.author) + '<span><span class="tv-name">' + esc(reply.author || reply.handle || "") + '</span> <span class="tv-meta">' + esc(relTime(reply.date)) + '</span><span class="tv-text">' + esc(reply.text || "") + '</span></span></button>';
    }
    return '<article class="tv-detail"><button type="button" class="tv-by" data-tv="1" data-zone="ui" data-tv-id="detail-author" data-act="open" data-href="' + esc(profileHash(post)) + '">' + avatar(post.avatar, post.author) + '<span class="tv-name">' + esc(post.author || "") + '</span><span class="tv-handle">' + (post.handle ? "@" + esc(post.handle) : "") + '</span><span class="tv-chip">' + esc(platformLabel(post.platform)) + '</span></button>' + (thumb ? '<div class="tv-hero"><img alt="" src="' + esc(thumb) + '" referrerpolicy="no-referrer"></div>' : '') + '<div class="tv-text-full">' + esc(post.text || post.title || "") + '</div>' + quote + '<div class="tv-meta">' + esc(relTime(post.date)) + (post.stats && post.stats.likes ? " · " + esc(String(post.stats.likes)) + " likes" : "") + '</div><div class="tv-actions">' + (isVideoPost(post) || youtubeId(post) ? action("Play", "play", ' data-post="' + esc(post.id) + '"') : "") + action(liked ? "Liked" : "Like", "like", ' data-post="' + esc(post.id) + '"') + action(saved ? "Saved" : "Save", "save", ' data-post="' + esc(post.id) + '"') + '</div><section class="tv-replies" id="tv-replies"><h2 class="tv-shelf-title">Replies</h2>' + replyHtml + '</section></article>';
  }

  function profileHtml(feed, postsForFeed) {
    if (!feed) return '<div class="tv-empty-page">That profile is not in this snapshot.</div>';
    var person = personFor(feed.platform, feed.handle);
    var followed = followedIds().indexOf(feed.id) >= 0;
    var banner = feed.banner ? ' style="background-image:url(' + esc(feed.banner) + ')"' : "";
    var link = person ? action("All platforms", "open", ' data-href="#/p/' + esc(person.id) + '" data-tv-id="act-person"') : "";
    return '<div class="tv-profile-banner"' + banner + '></div><div class="tv-profile-head">' + avatar(feed.avatar, feed.name) + '<div><h1>' + esc(feed.name || feed.handle || "") + '</h1><div class="tv-handle">' + (feed.handle ? "@" + esc(feed.handle) + " · " : "") + esc(platformLabel(feed.platform)) + '</div></div></div><div class="tv-bio">' + esc(feed.bio || "") + '</div><div class="tv-actions">' + action(followed ? "Following" : "Follow", "follow", ' data-feed="' + esc(feed.id) + '"') + link + '</div>' + shelvesHtml([{ id: "profile-posts", title: "Posts", items: postsForFeed, kind: postsForFeed.length && postsForFeed.every ? (allVideos(postsForFeed) ? "video" : "post") : "post", empty: "No posts in this snapshot" }]);
  }

  function allVideos(list) {
    if (!list.length) return false;
    for (var i = 0; i < list.length; i++) if (!isVideoPost(list[i])) return false;
    return true;
  }

  function feedFor(platform, handle) {
    var list = feedList();
    var who = String(handle || "").toLowerCase();
    for (var i = 0; i < list.length; i++) {
      if (list[i].platform === platform && String(list[i].handle || "").toLowerCase() === who) return list[i];
      if (platform === "youtube" && String(list[i].channelId || "") === handle) return list[i];
    }
    return {
      id: platform + ":" + handle,
      platform: platform,
      handle: handle,
      name: handle,
      avatar: ""
    };
  }

  function personHtml(person) {
    if (!person) return '<div class="tv-empty-page">That person is not in people.json.</div>';
    var accounts = person.accounts || [];
    var shelves = [];
    var all = [];
    for (var i = 0; i < accounts.length; i++) {
      var items = accountPosts(accounts[i]);
      for (var j = 0; j < items.length; j++) all.push(items[j]);
      shelves.push({
        id: "acct-" + (accounts[i].platform || "x") + "-" + i,
        title: platformLabel(accounts[i].platform) + (accounts[i].handle ? " · @" + accounts[i].handle : ""),
        items: items,
        kind: allVideos(items) ? "video" : "post",
        empty: "No posts yet"
      });
    }
    all.sort(byNewest);
    var seen = {};
    var unique = [];
    for (var n = 0; n < all.length; n++) {
      if (seen[all[n].id]) continue;
      seen[all[n].id] = true;
      unique.push(all[n]);
    }
    shelves.unshift({ id: "person-all", title: "All", items: unique, kind: "post" });
    return '<div class="tv-profile-banner"' + (person.banner ? ' style="background-image:url(' + esc(person.banner) + ')"' : "") + '></div><div class="tv-profile-head">' + avatar(person.avatar, person.name) + '<div><h1>' + esc(person.name || person.id) + '</h1><div class="tv-handle">All platforms</div></div></div><div class="tv-bio">' + esc(person.bio || "") + '</div>' + shelvesHtml(shelves);
  }

  function youHtml() {
    var savedIds = (TV.settings && TV.settings.bookmarks) || {};
    var saved = sorted(posts().filter(function (post) { return savedIds[post.id]; }));
    var ids = followedIds();
    var accounts = [];
    var list = feedList();
    for (var i = 0; i < list.length; i++) {
      if (ids.indexOf(list[i].id) < 0) continue;
      accounts.push({
        key: list[i].id,
        name: list[i].name || list[i].handle,
        avatar: list[i].avatar,
        meta: platformLabel(list[i].platform),
        href: profileHash(list[i])
      });
    }
    return '<h1 class="tv-page-title">You</h1><p class="tv-bio">Likes, bookmarks, and follows stay on this TV.</p>' + shelvesHtml([
      { id: "you-saved", title: "Saved", items: saved, kind: "post", empty: "Save a post from its menu" },
      { id: "you-following", title: "Following", items: accounts, kind: "account", empty: "Follow accounts to see them here" }
    ]);
  }

  function searchHtml(route) {
    var q = TV.query || (route.query && route.query.q) || "";
    TV.query = q;
    var keys = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    var board = "";
    for (var i = 0; i < keys.length; i++) {
      board += '<button type="button" class="tv-key" data-tv="1" data-zone="ui" data-tv-id="key-' + keys[i] + '" data-act="key" data-key="' + keys[i] + '">' + keys[i] + '</button>';
    }
    board += '<button type="button" class="tv-key wide" data-tv="1" data-zone="ui" data-tv-id="key-space" data-act="key" data-key="space">space</button>';
    board += '<button type="button" class="tv-key wide" data-tv="1" data-zone="ui" data-tv-id="key-back" data-act="key" data-key="back">delete</button>';
    board += '<button type="button" class="tv-key wide" data-tv="1" data-zone="ui" data-tv-id="key-clear" data-act="key" data-key="clear">clear</button>';
    return '<h1 class="tv-page-title">Search</h1><input id="tv-q" class="tv-search-input" data-tv="1" data-zone="ui" data-tv-id="search-input" type="text" autocomplete="off" aria-label="Search" value="' + esc(q) + '"><div class="tv-keys" id="tv-keys">' + board + '</div><div id="tv-results">' + resultsHtml(q) + '</div>';
  }

  function resultsHtml(q) {
    var query = String(q || "").trim().toLowerCase();
    if (!query) {
      TV.rowSpecs = {};
      TV.shelfOrder = [];
      return '<p class="tv-meta">Type with the on-screen keys, or press OK here and use a keyboard if the TV has one.</p>';
    }
    var accounts = [];
    var list = feedList();
    for (var i = 0; i < list.length; i++) {
      var hay = ((list[i].name || "") + " " + (list[i].handle || "") + " " + (list[i].platform || "")).toLowerCase();
      if (hay.indexOf(query) < 0) continue;
      accounts.push({ key: list[i].id, name: list[i].name || list[i].handle, avatar: list[i].avatar, meta: "@" + (list[i].handle || "") + " · " + platformLabel(list[i].platform), href: profileHash(list[i]) });
    }
    var matched = sorted(posts().filter(function (post) {
      var blob = ((post.text || "") + " " + (post.title || "") + " " + (post.author || "") + " " + (post.handle || "")).toLowerCase();
      return blob.indexOf(query) >= 0;
    }));
    var videos = matched.filter(isVideoPost);
    var texts = matched.filter(function (post) { return !isVideoPost(post); });
    return shelvesHtml([
      { id: "search-accounts", title: "Accounts", items: accounts, kind: "account", empty: "No accounts" },
      { id: "search-videos", title: "Videos", items: videos, kind: "video", empty: "No videos" },
      { id: "search-posts", title: "Posts", items: texts, kind: "post", empty: "No posts" }
    ]);
  }

  function notesHtml(title, body) {
    return '<h1 class="tv-page-title">' + esc(title) + '</h1><p class="tv-bio">' + esc(body) + '</p>' + action("Home", "open", ' data-href="#/" data-tv-id="act-home"');
  }

  function guideHtml() {
    return '<div class="tv-help" id="tv-guide"><h2 class="tv-shelf-title">How to use this on a TV</h2><p>Arrows move. OK opens. Hold OK on a post for Like, Save, and Profile. Back leaves a page, a menu, or the player. From the left edge of a shelf, left opens the nav rail and it expands while it is focused.</p><p>In a video, left and right jump 10 seconds. OK pauses. Play, pause, fast-forward, and rewind on the remote do the same. Red likes, green saves, yellow opens search, and blue mutes.</p><p>Samsung Tizen: open Internet, then this site. Bookmark it. Choose Add to Home when the browser menu offers it.</p><p>LG webOS: open the Browser app. Use Add to Home from the browser menu when it is shown. Otherwise keep the bookmark.</p><p>Android TV and Google TV: open Chrome or TV Bro. In Chrome, use the menu and Add to Home screen when it is offered. The installable app uses this site’s manifest.</p><p>Fire TV: open Silk and bookmark the page. Use Add to Home if Silk shows it.</p><p>On a computer, open Settings, then Display, then TV mode, or add ?tv=1 to the address. ?tv=0 turns it off.</p></div>';
  }

  function settingsPage() {
    var appearance = (TV.settings && TV.settings.appearance) || "lightsout";
    function theme(id, label) {
      return '<button type="button" class="tv-choice' + (appearance === id ? " is-on" : "") + '" data-tv="1" data-zone="ui" data-tv-id="theme-' + id + '" data-act="theme" data-theme="' + id + '">' + esc(label) + '</button>';
    }
    var on = !!TV.on;
    return '<h1 class="tv-page-title">Settings</h1><h2 class="tv-shelf-title">Display</h2><div class="tv-actions"><button type="button" class="tv-choice' + (on ? " is-on" : "") + '" data-tv="1" data-zone="ui" data-tv-id="tv-toggle" data-tv-toggle="1" aria-pressed="' + (on ? "true" : "false") + '">TV mode</button></div><h2 class="tv-shelf-title">Theme</h2><div class="tv-actions">' + theme("lightsout", "Lights out") + theme("dim", "Dim") + theme("default", "Default") + '</div>' + guideHtml();
  }

  function stageHtml(route) {
    TV.rowSpecs = {};
    TV.shelfOrder = [];
    if (!TV.data) return '<div class="tv-loading">Loading feeds…</div>';
    if (route.name === "home" || route.name === "watch") return shelvesHtml(homeShelves());
    if (route.name === "subs") return '<h1 class="tv-page-title">Subscriptions</h1>' + shelvesHtml(subsShelves());
    if (route.name === "search") return searchHtml(route);
    if (route.name === "notes") return notesHtml("Notifications", "From likes to reposts, this is where alerts will show. Nothing new right now.");
    if (route.name === "messages") return notesHtml("Messages", "Private conversations are not part of this reader.");
    if (route.name === "you") return youHtml();
    if (route.name === "settings") return settingsPage();
    if (route.name === "person") return personHtml(personBySlug(route.slug));
    if (route.name === "profile") {
      var feed = feedFor(route.platform, route.handle);
      var items = sorted(posts().filter(function (post) {
        if (feed.id && post.feedId === feed.id) return true;
        return post.platform === route.platform && String(post.handle || "").toLowerCase() === String(route.handle || "").toLowerCase();
      }));
      return profileHtml(feed, items);
    }
    if (route.name === "status") return detailHtml(findStatus(route.platform, route.handle, route.id));
    return shelvesHtml(homeShelves());
  }

  function saveScroll() {
    TV.scrolls = {};
    var rows = document.querySelectorAll("#tv-stage .tv-row");
    for (var i = 0; i < rows.length; i++) TV.scrolls[rows[i].id] = rows[i].scrollLeft;
    var stage = document.getElementById("tv-stage");
    if (stage) TV.stageScroll = stage.scrollTop;
  }

  function restoreScroll() {
    var rows = document.querySelectorAll("#tv-stage .tv-row");
    for (var i = 0; i < rows.length; i++) {
      if (TV.scrolls[rows[i].id]) rows[i].scrollLeft = TV.scrolls[rows[i].id];
    }
    var stage = document.getElementById("tv-stage");
    if (stage && TV.stageScroll) stage.scrollTop = TV.stageScroll;
  }

  function render() {
    if (!TV.on) return;
    try { renderNow(); } catch (err) {
      var stage = document.getElementById("tv-stage");
      if (stage) stage.textContent = "TV layout failed: " + (err && err.message ? err.message : "error");
      if (window.console && console.error) console.error(err);
    }
  }

  function renderNow() {
    stopPreview();
    TV.settings = loadSettings();
    applyTheme(TV.settings.appearance);
    var route = parseRoute();
    var root = ensureRoot();
    root.hidden = false;
    paintNav(route);
    var stage = document.getElementById("tv-stage");
    if (stage) stage.innerHTML = stageHtml(route);
    mountRows();
    restoreScroll();
    var legend = document.getElementById("tv-legend");
    if (legend) {
      var showLegend = isTvUa() || TV.sawColor;
      legend.hidden = !showLegend;
      if (showLegend) legend.innerHTML = '<span><i class="red"></i>Like</span><span><i class="green"></i>Save</span><span><i class="yellow"></i>Search</span><span><i class="blue"></i>Mute</span>';
    }
    if (route.name === "watch") openPlayer(route);
    else closePlayerDom();
    if (TV.menu) paintMenu();
    var ready = document.documentElement;
    ready.setAttribute("data-tv-ready", "0");
    requestAnimationFrame(function () {
      mountRows();
      restoreFocus(route);
      ready.setAttribute("data-tv-ready", "1");
    });
  }

  function currentFocus() {
    var el = document.activeElement;
    if (el && el.closest && el.closest("#tv-root") && el.hasAttribute("data-tv")) return el;
    var marked = document.querySelector("#tv-root .tv-focus");
    return marked || null;
  }

  function setFocus(el) {
    if (!el) return;
    var prev = document.querySelectorAll("#tv-root .tv-focus");
    for (var i = 0; i < prev.length; i++) prev[i].classList.remove("tv-focus");
    el.classList.add("tv-focus");
    try { el.focus(); } catch (err) { /* not focusable yet */ }
    var rail = document.getElementById("tv-rail");
    if (rail) {
      if (el.closest && el.closest("#tv-rail")) rail.classList.add("is-open");
      else rail.classList.remove("is-open");
    }
    var id = el.getAttribute("data-tv-id") || "";
    TV.focusId = id;
    TV.pageMemory[pageKey()] = id;
    if (el.getAttribute("data-zone") === "card") {
      var shelf = el.getAttribute("data-shelf");
      var key = el.getAttribute("data-key");
      if (shelf && key) TV.shelfMemory[shelf] = key;
    }
    schedulePreview(el);
    if (!el.closest || !el.closest(".tv-row")) scrollStage(el);
  }

  function scrollStage(el) {
    var stage = document.getElementById("tv-stage");
    if (!stage || !el || !el.getBoundingClientRect) return;
    var er = el.getBoundingClientRect();
    var sr = stage.getBoundingClientRect();
    var next = stage.scrollTop;
    if (er.top < sr.top + 8) next -= (sr.top + 8 - er.top);
    else if (er.bottom > sr.bottom - 8) next += (er.bottom - (sr.bottom - 8));
    if (next === stage.scrollTop) return;
    if (stage.scrollTo) {
      try { stage.scrollTo({ top: next, behavior: "smooth" }); return; } catch (err) { /* older webview */ }
    }
    stage.scrollTop = next;
  }

  function focusCard(shelf, index) {
    var spec = TV.rowSpecs[shelf];
    var row = document.getElementById("row-" + shelf);
    if (!spec || !row || !spec.items.length) return;
    if (index < 0) index = 0;
    if (index >= spec.items.length) index = spec.items.length - 1;
    spec.focusIndex = index;
    var item = spec.items[index];
    if (item) TV.shelfMemory[shelf] = item.key || item.id || "";
    var step = spec.cardW + spec.gap;
    var view = row.clientWidth || 800;
    var left = index * step;
    var pad = 36;
    var target = row.scrollLeft;
    if (left < row.scrollLeft + pad) target = Math.max(0, left - pad);
    else if (left + spec.cardW > row.scrollLeft + view - pad) target = left + spec.cardW - view + pad;
    row._sig = "";
    paintRow(row);
    if (target !== row.scrollLeft) {
      row._lock = true;
      if (row.scrollTo) {
        try { row.scrollTo({ left: target, behavior: "smooth" }); } catch (err) { row.scrollLeft = target; }
      } else row.scrollLeft = target;
      row._lock = false;
    }
    var el = row.querySelector('[data-index="' + index + '"]');
    if (el) setFocus(el);
    var section = document.getElementById("shelf-" + shelf);
    if (section) scrollStage(section);
  }

  function focusNav(id) {
    var el = document.querySelector('#tv-rail [data-tv-id="nav-' + id + '"]') || document.querySelector("#tv-rail [data-tv]");
    if (el) setFocus(el);
  }

  function focusNavCurrent() {
    var on = document.querySelector("#tv-rail .is-on") || document.querySelector("#tv-rail [data-tv]");
    if (on) setFocus(on);
  }

  function enterContent() {
    var saved = TV.pageMemory[pageKey()];
    if (saved && saved.indexOf("c-") === 0) {
      var parts = saved.split("-");
      var index = Number(parts.pop());
      var shelf = parts.slice(1).join("-");
      if (TV.rowSpecs[shelf]) { focusCard(shelf, index); return; }
    }
    if (saved) {
      var el = document.querySelector('#tv-root [data-tv-id="' + cssEscape(saved) + '"]');
      if (el && (!el.closest || !el.closest("#tv-rail"))) { setFocus(el); return; }
    }
    if (TV.shelfOrder.length && document.getElementById("row-" + TV.shelfOrder[0])) {
      focusCard(TV.shelfOrder[0], (TV.rowSpecs[TV.shelfOrder[0]] && TV.rowSpecs[TV.shelfOrder[0]].focusIndex) || 0);
      return;
    }
    var first = document.querySelector("#tv-stage [data-tv]");
    if (first) setFocus(first);
  }

  function restoreFocus(route) {
    if (TV.menu) {
      var menuBtn = document.querySelector("#tv-menu [data-tv]");
      if (menuBtn) setFocus(menuBtn);
      return;
    }
    if (route.name === "watch") {
      var stage = document.querySelector('[data-tv-id="player-stage"]');
      if (stage) setFocus(stage);
      return;
    }
    if (route.jump && TV.rowSpecs[route.jump]) {
      focusCard(route.jump, 0);
      return;
    }
    enterContent();
  }

  function moveShelf(shelf, delta) {
    var order = TV.shelfOrder || [];
    var at = order.indexOf(shelf);
    if (at < 0) return false;
    var spec = TV.rowSpecs[shelf];
    var index = spec ? spec.focusIndex : 0;
    if (spec && spec.items[index]) TV.shelfMemory[shelf] = spec.items[index].key || spec.items[index].id || "";
    var nextId = order[at + delta];
    if (!nextId) {
      if (delta < 0) {
        var lifted = spatial("ArrowUp", "#tv-stage [data-zone='ui']");
        if (!lifted) focusNavCurrent();
      }
      return true;
    }
    var next = TV.rowSpecs[nextId];
    if (!next || !next.items.length) return true;
    var memory = TV.shelfMemory[nextId];
    var nextIndex = Math.min(index, next.items.length - 1);
    if (memory) {
      for (var i = 0; i < next.items.length; i++) {
        if (next.items[i].key === memory || next.items[i].id === memory) nextIndex = i;
      }
    }
    focusCard(nextId, nextIndex);
    return true;
  }

  function spatial(direction, selector) {
    var current = currentFocus();
    var nodes = document.querySelectorAll(selector);
    var list = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.disabled) continue;
      var rect = node.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      list.push(node);
    }
    if (!current) {
      if (list[0]) setFocus(list[0]);
      return !!list[0];
    }
    var cr = current.getBoundingClientRect();
    var cx = cr.left + cr.width / 2;
    var cy = cr.top + cr.height / 2;
    var best = null;
    var bestScore = 1e15;
    for (var j = 0; j < list.length; j++) {
      var el = list[j];
      if (el === current) continue;
      var r = el.getBoundingClientRect();
      var dx = (r.left + r.width / 2) - cx;
      var dy = (r.top + r.height / 2) - cy;
      if (direction === "ArrowLeft" && dx >= -4) continue;
      if (direction === "ArrowRight" && dx <= 4) continue;
      if (direction === "ArrowUp" && dy >= -4) continue;
      if (direction === "ArrowDown" && dy <= 4) continue;
      var primary = direction === "ArrowLeft" || direction === "ArrowRight" ? Math.abs(dx) : Math.abs(dy);
      var secondary = direction === "ArrowLeft" || direction === "ArrowRight" ? Math.abs(dy) : Math.abs(dx);
      if (secondary > primary * 2.6 + 90) continue;
      var score = primary + secondary * 2.1;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (!best) return false;
    if (best.getAttribute("data-zone") === "card") focusCard(best.getAttribute("data-shelf"), Number(best.getAttribute("data-index") || 0));
    else setFocus(best);
    return true;
  }

  function move(direction) {
    var el = currentFocus();
    if (TV.menu) {
      var moved = spatial(direction, "#tv-menu [data-tv]");
      if (!moved && direction === "ArrowLeft") closeMenu();
      return;
    }
    if (!el) {
      if (direction === "ArrowLeft") focusNavCurrent();
      else enterContent();
      return;
    }
    var zone = el.getAttribute("data-zone") || "";
    if (zone === "nav") {
      if (direction === "ArrowUp" || direction === "ArrowDown") {
        spatial(direction, "#tv-rail [data-tv]");
        return;
      }
      if (direction === "ArrowRight") enterContent();
      return;
    }
    if (zone === "card") {
      var shelf = el.getAttribute("data-shelf");
      var index = Number(el.getAttribute("data-index") || 0);
      var spec = TV.rowSpecs[shelf];
      if (direction === "ArrowLeft") {
        if (index > 0) focusCard(shelf, index - 1);
        else focusNavCurrent();
        return;
      }
      if (direction === "ArrowRight") {
        if (spec && index < spec.items.length - 1) focusCard(shelf, index + 1);
        return;
      }
      if (direction === "ArrowUp" || direction === "ArrowDown") {
        moveShelf(shelf, direction === "ArrowDown" ? 1 : -1);
        return;
      }
    }
    var hit = spatial(direction, "#tv-stage [data-tv], #tv-player [data-tv]");
    if (!hit && direction === "ArrowLeft") focusNavCurrent();
  }

  function typing() {
    var el = document.activeElement;
    if (!el) return false;
    var tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA";
  }

  function caretInside(direction) {
    var el = document.activeElement;
    if (!el || el.tagName !== "INPUT") return false;
    var start = el.selectionStart;
    var end = el.selectionEnd;
    if (start == null) return false;
    if (direction === "ArrowLeft") return start > 0;
    if (direction === "ArrowRight") return end < String(el.value || "").length;
    return false;
  }

  function navigate(hash) {
    var here = location.hash || "#/";
    var bare = here.split("?")[0];
    var nextBare = String(hash || "").split("?")[0];
    if (here === hash) return;
    if (TV.stack.length && TV.stack[TV.stack.length - 1] === hash) {
      TV.stack.pop();
    } else if (bare !== nextBare) {
      TV.stack.push(here);
      if (TV.stack.length > 40) TV.stack.shift();
    }
    location.hash = hash;
  }

  function atHome() {
    var hash = (location.hash || "#/").split("?")[0];
    return hash === "#/" || hash === "#/home" || hash === "";
  }

  function goBack() {
    if (TV.menu) { closeMenu(); return; }
    if (parseRoute().name === "watch" || TV.player) {
      var backTo = TV.stack.length ? TV.stack.pop() : "#/";
      if (!backTo || backTo.indexOf("#/watch/") === 0) backTo = "#/";
      location.hash = backTo;
      return;
    }
    if (TV.stack.length) {
      location.hash = TV.stack.pop();
      return;
    }
    if (!atHome()) location.hash = "#/";
  }

  function activate(el) {
    if (!el || !TV.on) return;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
    if (el.hasAttribute("data-tv-toggle")) {
      setTvMode("off");
      return;
    }
    var act = el.getAttribute("data-act") || "";
    if (act === "nav" || act === "open") {
      navigate(el.getAttribute("data-href") || "#/");
      return;
    }
    if (act === "card") {
      var post = findPostById(el.getAttribute("data-post"));
      if (!post) return;
      if (el.getAttribute("data-video") === "1") navigate(watchHash(post));
      else navigate(statusHash(post));
      return;
    }
    if (act === "key") { typeKey(el.getAttribute("data-key")); return; }
    if (act === "theme") { setTheme(el.getAttribute("data-theme")); return; }
    if (act === "play") {
      var playing = findPostById(el.getAttribute("data-post"));
      if (playing) navigate(watchHash(playing));
      return;
    }
    if (act === "like" || act === "menu-like") { colorLike(); return; }
    if (act === "save" || act === "menu-save") { colorSave(); return; }
    if (act === "follow") { toggleFollow(el.getAttribute("data-feed")); return; }
    if (act === "menu-profile") {
      var who = focusedPost() || (TV.menu && TV.menu.post);
      closeMenu();
      if (who) navigate(profileHash(who));
      return;
    }
    if (act === "menu-open") {
      var item = (TV.menu && TV.menu.post) || focusedPost();
      closeMenu();
      if (item) navigate(isVideoPost(item) ? watchHash(item) : statusHash(item));
      return;
    }
    if (act === "close-menu") { closeMenu(); return; }
    if (act === "player-play") { togglePlay(); return; }
    if (act === "player-cc") { toggleCaptions(); return; }
    if (act === "player-quality") { toggleQuality(); return; }
    if (act === "player-channel") {
      if (TV.player && TV.player.post) navigate(profileHash(TV.player.post));
      return;
    }
  }

  function typeKey(key) {
    var input = document.getElementById("tv-q");
    if (!input) return;
    if (key === "back") input.value = input.value.slice(0, -1);
    else if (key === "clear") input.value = "";
    else if (key === "space") input.value += " ";
    else input.value += key;
    TV.query = input.value;
    var box = document.getElementById("tv-results");
    if (box) box.innerHTML = resultsHtml(TV.query);
    mountRows();
    var next = "#/explore" + (TV.query ? "?q=" + encodeURIComponent(TV.query) : "");
    if ((location.hash || "") !== next) history.replaceState(null, "", location.pathname + location.search + next);
  }

  function focusedPost() {
    var el = currentFocus();
    if (el && el.getAttribute("data-post")) return findPostById(el.getAttribute("data-post"));
    if (TV.player && TV.player.post) return TV.player.post;
    if (TV.menu && TV.menu.post) return TV.menu.post;
    var route = parseRoute();
    if (route.name === "status") return findStatus(route.platform, route.handle, route.id);
    return null;
  }

  function toast(text) {
    var el = document.getElementById("tv-toast");
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(TV.toastTimer);
    TV.toastTimer = setTimeout(function () { el.hidden = true; }, 1400);
  }

  function colorLike() {
    var post = focusedPost();
    if (!post) return;
    patchSettings(function (s) {
      if (s.likes[post.id]) delete s.likes[post.id];
      else s.likes[post.id] = true;
    });
    toast(TV.settings.likes[post.id] ? "Liked" : "Like removed");
  }

  function colorSave() {
    var post = focusedPost();
    if (!post) return;
    patchSettings(function (s) {
      if (s.bookmarks[post.id]) delete s.bookmarks[post.id];
      else s.bookmarks[post.id] = true;
    });
    toast(TV.settings.bookmarks[post.id] ? "Saved" : "Removed");
  }

  function toggleFollow(id) {
    if (!id) return;
    patchSettings(function (s) {
      var at = s.follows.indexOf(id);
      if (at >= 0) s.follows.splice(at, 1);
      else s.follows.push(id);
    });
    toast(followedIds().indexOf(id) >= 0 ? "Following" : "Unfollowed");
    render();
  }

  function setTheme(mode) {
    patchSettings(function (s) { s.appearance = mode || "lightsout"; });
    applyTheme(mode);
    render();
  }

  function applyTheme(mode) {
    var resolved = mode || "lightsout";
    if (resolved === "auto") {
      var light = false;
      try { light = window.matchMedia("(prefers-color-scheme: light)").matches; } catch (err) { light = false; }
      resolved = light ? "default" : "lightsout";
    }
    if (resolved !== "default" && resolved !== "dim" && resolved !== "lightsout") resolved = "lightsout";
    document.documentElement.setAttribute("data-theme", resolved);
  }

  function openMenuForFocus() {
    var el = currentFocus();
    if (!el || el.getAttribute("data-zone") !== "card" || !el.getAttribute("data-post")) return;
    var post = findPostById(el.getAttribute("data-post"));
    if (!post) return;
    var rect = el.getBoundingClientRect();
    TV.menu = { post: post, returnId: el.getAttribute("data-tv-id"), top: Math.max(80, rect.top), left: Math.max(80, rect.left) };
    paintMenu();
    var first = document.querySelector("#tv-menu [data-tv]");
    if (first) setFocus(first);
  }

  function paintMenu() {
    var box = document.getElementById("tv-menu");
    if (!box || !TV.menu) return;
    var post = TV.menu.post;
    var liked = TV.settings && TV.settings.likes && TV.settings.likes[post.id];
    var saved = TV.settings && TV.settings.bookmarks && TV.settings.bookmarks[post.id];
    box.hidden = false;
    box.style.top = TV.menu.top + "px";
    box.style.left = TV.menu.left + "px";
    box.innerHTML = '<button type="button" data-tv="1" data-zone="ui" data-tv-id="menu-like" data-act="menu-like">' + (liked ? "Unlike" : "Like") + '</button><button type="button" data-tv="1" data-zone="ui" data-tv-id="menu-save" data-act="menu-save">' + (saved ? "Remove save" : "Save") + '</button><button type="button" data-tv="1" data-zone="ui" data-tv-id="menu-profile" data-act="menu-profile">Profile</button><button type="button" data-tv="1" data-zone="ui" data-tv-id="menu-open" data-act="menu-open">Open</button><button type="button" data-tv="1" data-zone="ui" data-tv-id="menu-close" data-act="close-menu">Close</button>';
  }

  function closeMenu() {
    var back = TV.menu && TV.menu.returnId;
    TV.menu = null;
    var box = document.getElementById("tv-menu");
    if (box) { box.hidden = true; box.innerHTML = ""; }
    if (back) {
      var el = document.querySelector('#tv-root [data-tv-id="' + cssEscape(back) + '"]');
      if (el) { setFocus(el); return; }
    }
    enterContent();
  }

  function schedulePreview(el) {
    clearTimeout(TV.previewTimer);
    stopPreview();
    if (!el || el.getAttribute("data-video") !== "1") return;
    if (TV.player) return;
    var autoplay = (TV.settings && TV.settings.autoplay) || "all";
    if (autoplay === "never") return;
    TV.previewTimer = setTimeout(function () {
      if (!el.classList.contains("tv-focus")) return;
      var box = el.querySelector(".tv-thumb, .tv-media");
      if (!box) return;
      var yt = el.getAttribute("data-yt");
      var src = el.getAttribute("data-stream");
      var node = null;
      if (src && !yt) {
        node = document.createElement("video");
        node.muted = true;
        node.autoplay = true;
        node.loop = true;
        node.setAttribute("playsinline", "");
        node.src = src;
      } else if (yt) {
        node = document.createElement("iframe");
        node.setAttribute("allow", "autoplay; encrypted-media");
        node.title = "Preview";
        node.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(yt) + "?autoplay=1&mute=1&controls=0&modestbranding=1&playsinline=1&rel=0&start=8&enablejsapi=1";
      }
      if (!node) return;
      node.className = "tv-preview";
      node.setAttribute("data-preview-node", "1");
      box.appendChild(node);
      if (node.play) node.play().catch(function () {});
    }, 1000);
  }

  function stopPreview() {
    var nodes = document.querySelectorAll("[data-preview-node]");
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.pause) {
        try { node.pause(); node.removeAttribute("src"); node.load(); } catch (err) { /* already gone */ }
      }
      if (node.parentNode) node.parentNode.removeChild(node);
    }
  }

  function ytPost(frame, payload) {
    if (!frame || !frame.contentWindow) return;
    try { frame.contentWindow.postMessage(JSON.stringify(payload), "*"); } catch (err) { /* the frame may be closed */ }
  }

  function ytCmd(func, args) {
    var frame = document.querySelector("#tv-player iframe");
    if (!frame) return;
    ytPost(frame, { event: "command", func: func, args: args || [], id: frame.id || "tvplayer", channel: "widget" });
  }

  function ytHandshake(frame) {
    ytPost(frame, { event: "listening", id: frame.id || "tvplayer", channel: "widget" });
    ytCmd("addEventListener", ["onReady"]);
    ytCmd("addEventListener", ["onStateChange"]);
    ytCmd("addEventListener", ["onError"]);
  }

  function openPlayer(route) {
    var post = findStatus(route.platform, "", route.id) || findPostById(route.id);
    if (!post) {
      closePlayerDom();
      var stage = document.getElementById("tv-stage");
      if (stage) stage.innerHTML = '<div class="tv-empty-page">That video is not in this snapshot.</div>';
      return;
    }
    stopPreview();
    TV.player = TV.player && TV.player.post && TV.player.post.id === post.id ? TV.player : {
      post: post,
      time: 0,
      duration: Number((videoMedia(post) || {}).duration) || 0,
      playing: true,
      captions: false,
      quality: "auto"
    };
    TV.player.post = post;
    paintPlayer();
  }

  function paintPlayer() {
    var root = document.getElementById("tv-player");
    var player = TV.player;
    if (!root || !player) return;
    root.hidden = false;
    var post = player.post;
    var yt = youtubeId(post);
    var stream = streamOf(post);
    var useStream = player.quality === "360p" && stream;
    var media = "";
    if (yt && !useStream) {
      var origin = "";
      try { origin = "&origin=" + encodeURIComponent(location.origin); } catch (err) { origin = ""; }
      var cc = player.captions ? "&cc_load_policy=1&cc_lang_pref=en" : "&cc_load_policy=0";
      media = '<iframe id="tvplayer" title="' + esc(post.title || post.text || "Video") + '" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen src="https://www.youtube-nocookie.com/embed/' + esc(yt) + '?enablejsapi=1&autoplay=1&rel=0&modestbranding=1&playsinline=1&controls=0' + cc + origin + '"></iframe>';
    } else if (stream || (videoMedia(post) && videoMedia(post).url && !yt)) {
      var src = stream || videoMedia(post).url;
      media = '<video id="tv-direct" src="' + esc(src) + '" autoplay playsinline' + (posterOf(post) ? ' poster="' + esc(posterOf(post)) + '"' : "") + '></video>';
    } else {
      media = '<div class="tv-empty-page">No playable video in this snapshot.</div>';
    }
    var title = post.title || post.text || "Video";
    root.innerHTML = '<div class="tv-player-stage" data-tv="1" data-zone="player" data-tv-id="player-stage" tabindex="0" data-post="' + esc(post.id) + '"></div><div class="tv-player-chrome"><div class="tv-player-title">' + esc(clip(title, 140)) + '</div><button type="button" class="tv-progress" data-tv="1" data-zone="player" data-tv-id="player-progress" data-act="player-progress" aria-label="Seek"><span id="tv-progress-bar"></span></button><div class="tv-player-controls"><div class="tv-player-side"><button type="button" data-tv="1" data-zone="player" data-tv-id="player-channel" data-act="player-channel">' + esc(post.author || post.handle || "Channel") + '</button></div><div class="tv-player-mid"><button type="button" data-tv="1" data-zone="player" data-tv-id="player-play" data-act="player-play" id="tv-play">' + (player.playing ? "Pause" : "Play") + '</button><span class="tv-time" id="tv-time" data-time="' + String(Math.floor(player.time || 0)) + '">' + clock(player.time) + (player.duration ? " / " + clock(player.duration) : "") + '</span></div><div class="tv-player-side tv-player-end"><button type="button" data-tv="1" data-zone="player" data-tv-id="player-cc" data-act="player-cc" aria-pressed="' + (player.captions ? "true" : "false") + '">Captions</button><button type="button" data-tv="1" data-zone="player" data-tv-id="player-quality" data-act="player-quality">Quality ' + esc(player.quality === "360p" ? "360p" : "Auto") + '</button></div></div></div>';
    var stage = root.querySelector(".tv-player-stage");
    if (stage) stage.innerHTML = media;
    var frame = root.querySelector("iframe");
    if (frame) {
      frame.addEventListener("load", function () { ytHandshake(frame); });
    }
    var video = root.querySelector("video");
    if (video) {
      video.muted = !!TV.muted;
      if (player.time) video.currentTime = player.time;
      video.play().catch(function () {
        video.muted = true;
        video.play().catch(function () {});
      });
    }
    paintProgress();
    if (TV.playerTimer) clearInterval(TV.playerTimer);
    TV.playerTimer = setInterval(pollPlayer, 500);
    if (navigator.mediaSession) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: title, artist: post.author || "" });
        navigator.mediaSession.playbackState = player.playing ? "playing" : "paused";
      } catch (err) { /* metadata is optional */ }
    }
  }

  function paintProgress() {
    var player = TV.player;
    if (!player) return;
    var bar = document.getElementById("tv-progress-bar");
    var label = document.getElementById("tv-time");
    var ratio = player.duration ? Math.max(0, Math.min(1, player.time / player.duration)) : 0;
    if (bar) bar.style.width = (ratio * 100) + "%";
    if (label) {
      label.setAttribute("data-time", String(Math.floor(player.time || 0)));
      label.textContent = clock(player.time) + (player.duration ? " / " + clock(player.duration) : "");
    }
    var play = document.getElementById("tv-play");
    if (play) play.textContent = player.playing ? "Pause" : "Play";
  }

  function pollPlayer() {
    if (!TV.player) return;
    var video = document.querySelector("#tv-player video");
    if (video) {
      TV.player.time = video.currentTime || 0;
      if (video.duration && isFinite(video.duration)) TV.player.duration = video.duration;
      TV.player.playing = !video.paused;
      paintProgress();
      return;
    }
    ytCmd("getCurrentTime", []);
    ytCmd("getDuration", []);
    ytCmd("getPlayerState", []);
  }

  function closePlayerDom() {
    TV.player = null;
    if (TV.playerTimer) clearInterval(TV.playerTimer);
    TV.playerTimer = 0;
    var root = document.getElementById("tv-player");
    if (!root) return;
    var video = root.querySelector("video");
    if (video) {
      try { video.pause(); video.removeAttribute("src"); video.load(); } catch (err) { /* closing */ }
    }
    root.hidden = true;
    root.innerHTML = "";
  }

  function seekBy(delta) {
    if (!TV.player) return;
    var video = document.querySelector("#tv-player video");
    var next = Math.max(0, (video ? video.currentTime : TV.player.time) + delta);
    if (TV.player.duration) next = Math.min(TV.player.duration, next);
    TV.player.time = next;
    if (video) video.currentTime = next;
    else ytCmd("seekTo", [next, true]);
    paintProgress();
  }

  function togglePlay() {
    if (!TV.player) return;
    var video = document.querySelector("#tv-player video");
    if (video) {
      if (video.paused) video.play().catch(function () {});
      else video.pause();
      TV.player.playing = video.paused === false;
      paintProgress();
      return;
    }
    TV.player.playing = !TV.player.playing;
    ytCmd(TV.player.playing ? "playVideo" : "pauseVideo", []);
    paintProgress();
  }

  function toggleCaptions() {
    if (!TV.player) return;
    TV.player.captions = !TV.player.captions;
    if (document.querySelector("#tv-player iframe")) {
      if (TV.player.captions) {
        ytCmd("loadModule", ["captions"]);
        ytCmd("setOption", ["captions", "track", { languageCode: "en" }]);
      } else ytCmd("unloadModule", ["captions"]);
    }
    var video = document.querySelector("#tv-player video");
    if (video && video.textTracks) {
      for (var i = 0; i < video.textTracks.length; i++) video.textTracks[i].mode = TV.player.captions ? "showing" : "hidden";
    }
    var button = document.querySelector('[data-tv-id="player-cc"]');
    if (button) button.setAttribute("aria-pressed", TV.player.captions ? "true" : "false");
    toast(TV.player.captions ? "Captions on" : "Captions off");
  }

  function toggleQuality() {
    if (!TV.player) return;
    var post = TV.player.post;
    if (!streamOf(post)) { toast("Auto"); return; }
    TV.player.quality = TV.player.quality === "360p" ? "auto" : "360p";
    paintPlayer();
    var stage = document.querySelector('[data-tv-id="player-stage"]');
    if (stage) setFocus(stage);
  }

  function toggleMute() {
    TV.muted = !TV.muted;
    var video = document.querySelector("#tv-player video");
    if (video) video.muted = TV.muted;
    if (document.querySelector("#tv-player iframe")) ytCmd(TV.muted ? "mute" : "unMute", []);
    toast(TV.muted ? "Muted" : "Sound on");
  }

  function onPlayerMessage(event) {
    if (!TV.player) return;
    var host = String(event.origin || "");
    if (host.indexOf("youtube") < 0) return;
    var data = event.data;
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch (err) { return; }
    }
    if (!data || typeof data !== "object") return;
    var info = data.info;
    if (typeof info === "number" && data.event === "infoDelivery") {
      if (info > 5 && (!TV.player.duration || info > TV.player.duration - 1)) TV.player.duration = info;
      else TV.player.time = info;
    }
    if (info && typeof info === "object") {
      if (info.currentTime != null) TV.player.time = Number(info.currentTime) || 0;
      if (info.duration != null && Number(info.duration) > 0) TV.player.duration = Number(info.duration);
      if (info.playerState != null) TV.player.playing = Number(info.playerState) === 1;
    }
    if (data.event === "onStateChange") {
      var state = typeof info === "number" ? info : (info && info.playerState);
      if (state === 1) TV.player.playing = true;
      if (state === 2 || state === 0) TV.player.playing = false;
    }
    paintProgress();
  }

  function isBack(event) {
    var key = event.key || "";
    var code = event.keyCode || event.which || 0;
    if (key === "Escape" || key === "BrowserBack" || key === "XF86Back" || key === "GoBack" || key === "Back") return true;
    if (code === 10009 || code === 461) return true;
    if (key === "Backspace" && !typing()) return true;
    return false;
  }

  function isPlay(event) {
    var key = event.key || "";
    var code = event.keyCode || event.which || 0;
    return key === "MediaPlayPause" || key === "MediaPlay" || key === "MediaPause" || code === 179 || code === 415 || code === 19;
  }

  function onKeyDown(event) {
    if (!TV.on) return;
    var key = event.key || "";
    var code = event.keyCode || event.which || 0;
    if (isBack(event)) {
      if (atHome() && !TV.menu && !(TV.player || parseRoute().name === "watch")) return;
      event.preventDefault();
      event.stopPropagation();
      goBack();
      return;
    }
    if (isPlay(event)) {
      event.preventDefault();
      event.stopPropagation();
      if (TV.player) togglePlay();
      return;
    }
    if (key === "MediaFastForward" || code === 417) {
      event.preventDefault();
      event.stopPropagation();
      if (TV.player) seekBy(10);
      return;
    }
    if (key === "MediaRewind" || code === 412) {
      event.preventDefault();
      event.stopPropagation();
      if (TV.player) seekBy(-10);
      return;
    }
    if (code === 403 || key === "ColorF0Red") { TV.sawColor = true; event.preventDefault(); event.stopPropagation(); colorLike(); return; }
    if (code === 404 || key === "ColorF1Green") { TV.sawColor = true; event.preventDefault(); event.stopPropagation(); colorSave(); return; }
    if (code === 405 || key === "ColorF2Yellow") { TV.sawColor = true; event.preventDefault(); event.stopPropagation(); navigate("#/explore"); return; }
    if (code === 406 || key === "ColorF3Blue") { TV.sawColor = true; event.preventDefault(); event.stopPropagation(); toggleMute(); return; }

    if (TV.player && playerKey(event)) return;

    if (key === "Enter" || key === "NumpadEnter" || key === "Accept" || code === 13) {
      if (event.repeat) { event.preventDefault(); event.stopPropagation(); return; }
      event.preventDefault();
      event.stopPropagation();
      TV.holdFired = false;
      clearTimeout(TV.hold);
      var target = currentFocus();
      if (target && target.getAttribute("data-zone") === "card" && target.getAttribute("data-post")) {
        TV.hold = setTimeout(function () {
          TV.holdFired = true;
          openMenuForFocus();
        }, 550);
      }
      return;
    }
    if (key === " " && !typing()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (typing() && (key === "ArrowLeft" || key === "ArrowRight") && caretInside(key)) return;
    if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      move(key);
    }
  }

  function playerKey(event) {
    var key = event.key || "";
    var el = currentFocus();
    var id = el ? (el.getAttribute("data-tv-id") || "") : "";
    var seekTarget = !el || id === "player-stage" || id === "player-progress";
    if ((key === "ArrowLeft" || key === "ArrowRight") && seekTarget) {
      event.preventDefault();
      event.stopPropagation();
      seekBy(key === "ArrowLeft" ? -10 : 10);
      return true;
    }
    if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      spatial(key, "#tv-player [data-tv]");
      return true;
    }
    if ((key === "Enter" || key === " ") && (!el || id === "player-stage")) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) togglePlay();
      return true;
    }
    return false;
  }

  function onKeyUp(event) {
    if (!TV.on) return;
    var key = event.key || "";
    var code = event.keyCode || event.which || 0;
    if (key !== "Enter" && key !== "NumpadEnter" && key !== " " && key !== "Accept" && code !== 13) return;
    if (TV.player && currentFocus() && currentFocus().getAttribute("data-tv-id") === "player-stage") return;
    clearTimeout(TV.hold);
    if (TV.holdFired) {
      TV.holdFired = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (key === " " && typing()) return;
    event.preventDefault();
    event.stopPropagation();
    activate(currentFocus());
  }

  function onClick(event) {
    var toggle = event.target && event.target.closest && event.target.closest("[data-tv-toggle]");
    if (toggle) {
      event.preventDefault();
      event.stopPropagation();
      setTvMode(TV.on ? "off" : "on");
      return;
    }
    if (!TV.on) return;
    var el = event.target && event.target.closest && event.target.closest("#tv-root [data-tv]");
    if (!el) return;
    if (el.tagName === "INPUT") return;
    event.preventDefault();
    event.stopPropagation();
    setFocus(el);
    activate(el);
  }

  function onSearchInput(event) {
    if (!TV.on || !event.target || event.target.id !== "tv-q") return;
    TV.query = event.target.value || "";
    var box = document.getElementById("tv-results");
    if (box) box.innerHTML = resultsHtml(TV.query);
    mountRows();
  }

  function setTvMode(mode) {
    patchSettings(function (s) { s.tvMode = mode; });
    applyMode();
  }

  function plainTransition(update) {
    try { if (typeof update === "function") update(); } catch (err) { /* keep the route */ }
    var done = Promise.resolve();
    return { finished: done, ready: done, updateCallbackDone: done, skipTransition: function () {} };
  }

  function setTransitions(on) {
    if (!document.startViewTransition) return;
    if (on) {
      if (TV.viewTransition) return;
      TV.viewTransition = document.startViewTransition.bind(document);
      document.startViewTransition = plainTransition;
      return;
    }
    if (TV.viewTransition) {
      document.startViewTransition = TV.viewTransition;
      TV.viewTransition = null;
    }
  }

  function enter() {
    TV.on = true;
    setTransitions(true);
    document.documentElement.classList.add("tv-on");
    var root = ensureRoot();
    root.hidden = false;
    if (!TV.data && !TV.loading) {
      TV.loading = true;
      var stage = document.getElementById("tv-stage");
      paintNav(parseRoute());
      if (stage) stage.innerHTML = '<div class="tv-loading">Loading feeds…</div>';
      loadData();
    } else render();
  }

  function exit() {
    TV.on = false;
    setTransitions(false);
    stopPreview();
    closePlayerDom();
    closeMenu();
    document.documentElement.classList.remove("tv-on");
    document.documentElement.setAttribute("data-tv-ready", "0");
    var root = document.getElementById("tv-root");
    if (root) root.hidden = true;
  }

  function applyMode() {
    if (shouldEnable()) enter();
    else exit();
  }

  function loadData() {
    var feeds = fetch("feeds.json", { credentials: "same-origin" }).then(function (res) { return res.json(); });
    var people = fetch("people.json", { credentials: "same-origin" }).then(function (res) { return res.json(); }).catch(function () { return { people: [] }; });
    return Promise.all([feeds, people]).then(function (pair) {
      TV.data = pair[0] || { posts: [], feeds: [] };
      TV.people = (pair[1] && pair[1].people) || [];
      TV.loading = false;
      if (TV.on) render();
    }).catch(function () {
      TV.loading = false;
      TV.data = TV.data || { posts: [], feeds: [] };
      if (TV.on) render();
    });
  }

  function attach() {
    if (TV.attached) {
      applyMode();
      return;
    }
    TV.attached = true;
    TV.settings = loadSettings();
    ensureRoot();
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("input", onSearchInput, true);
    window.addEventListener("message", onPlayerMessage);
    window.addEventListener("hashchange", function () {
      if (!TV.on) return;
      saveScroll();
      render();
    });
    applyMode();
  }

  window.FeedsTV = {
    settingsHtml: settingsHtml,
    attach: attach,
    enabled: function () { return TV.on; }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attach);
  else attach();
})();
