/* Unified profiles. people.json is the only source of linked accounts. */
(function (root) {

  function tr(key, vars) {
    var fn = (typeof window !== "undefined" && window.t) ? window.t : ((typeof self !== "undefined" && self.t) ? self.t : null);
    return fn ? fn(key, vars) : key;
  }
  function trn(key, n, vars) {
    var fn = (typeof window !== "undefined" && window.tn) ? window.tn : ((typeof self !== "undefined" && self.tn) ? self.tn : null);
    return fn ? fn(key, n, vars) : String(n);
  }
  function productName(kind) {
    var api = (typeof SI18n !== "undefined") ? SI18n : ((typeof window !== "undefined" && window.SI18n) ? window.SI18n : ((typeof self !== "undefined" && self.SI18n) ? self.SI18n : null));
    return (api && api.productName) ? api.productName(kind) : "";
  }

  const NET = {
    x: "X",
    threads: "Threads",
    instagram: "Instagram",
    youtube: "YouTube",
    vk: "VK",
    telegram: "Telegram",
    discord: "Discord",
    rss: "RSS"
  };
  let bound = null;
  let people = [];
  const byKey = new Map();

  function hooks() { return bound || {}; }

  function esc(value) {
    const fn = hooks().esc;
    if (fn) return fn(value);
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function lower(value) {
    return String(value || "").replace(/^@/, "").trim().toLowerCase();
  }

  function remember(key, person) {
    const text = String(key || "");
    if (!text || byKey.has(text)) return;
    byKey.set(text, person);
  }

  function ingest(doc) {
    people = (doc && doc.people) || [];
    byKey.clear();
    people.forEach((person) => {
      if (!person || !person.id) return;
      (person.accounts || []).forEach((account) => {
        const platform = account.platform || "x";
        const handle = lower(account.handle);
        if (handle) remember(platform + ":" + handle, person);
        if (account.channelId) {
          remember(platform + ":" + lower(account.channelId), person);
          remember(platform + ":" + account.channelId, person);
        }
        if (account.permanentId) remember(platform + ":" + String(account.permanentId), person);
        if (account.secUid) remember(platform + ":" + String(account.secUid), person);
        if (account.feedId) remember(String(account.feedId).toLowerCase(), person);
      });
    });
    people.forEach((person) => {
      if (!person || !person.id) return;
      (person.accounts || []).forEach((account) => {
        const platform = account.platform || "x";
        (account.previousHandles || []).forEach((item) => {
          const handle = lower(item);
          if (handle) remember(platform + ":" + handle, person);
        });
      });
    });
  }

  function match(platform, handle) {
    const key = lower(handle);
    if (!key) return null;
    const name = platform || "x";
    return byKey.get(name + ":" + key) || byKey.get(key) || null;
  }

  function matchFeed(feed) {
    if (!feed) return null;
    return match(feed.platform, feed.handle) || match(feed.platform, feed.channelId) || match(feed.platform, feed.id) || (feed.id ? byKey.get(String(feed.id).toLowerCase()) : null) || null;
  }

  function byId(id) {
    const key = String(id || "");
    return people.find((person) => person && person.id === key) || null;
  }

  function hashFor(platform, handle) {
    const person = match(platform, handle);
    return person ? "#/p/" + encodeURIComponent(person.id) : "";
  }

  function titleFor(route) {
    if (!route) return "";
    const person = route.name === "person" ? byId(route.id) : match(route.platform, route.handle);
    return person ? (person.name || person.id) : "";
  }

  function accountHandles(account) {
    return [account && account.handle].concat((account && account.previousHandles) || []).map(lower).filter(Boolean);
  }

  function sameAccount(feed, account) {
    if (!feed || !account) return false;
    if ((feed.platform || "x") !== (account.platform || "x")) return false;
    const handle = lower(feed.handle);
    const channel = String(feed.channelId || "");
    const names = accountHandles(account);
    if (handle && names.indexOf(handle) >= 0) return true;
    if (account.channelId && (channel === account.channelId || handle === lower(account.channelId))) return true;
    if (account.permanentId && String(feed.permanentId || "") === String(account.permanentId)) return true;
    if (account.feedId && feed.id === account.feedId) return true;
    return false;
  }

  function catalogIds(person) {
    const list = hooks().feeds ? hooks().feeds() : [];
    const ids = [];
    (person.accounts || []).forEach((account) => {
      list.forEach((feed) => {
        if (feed && feed.id && sameAccount(feed, account) && ids.indexOf(feed.id) < 0) ids.push(feed.id);
      });
      if (account.feedId && ids.indexOf(account.feedId) < 0) {
        const known = list.some((feed) => feed && feed.id === account.feedId);
        if (known) ids.push(account.feedId);
      }
    });
    return ids;
  }

  function followIds(id) {
    const raw = String(id || "");
    const person = byId(raw.replace(/^person:/, "")) || matchFeed({ id: raw, platform: raw.split(":")[0], handle: raw.split(":").slice(1).join(":") });
    if (!person) return raw ? [raw] : [];
    const ids = catalogIds(person);
    return ids.length ? ids : (raw ? [raw] : []);
  }

  function reposterMatch(post, person) {
    const by = post && post.repostedBy;
    if (!post || !person || !by || !(by.handle || by.name || by.feedId)) return false;
    const platform = by.platform || post.platform || "x";
    const handle = lower(by.handle);
    return (person.accounts || []).some((account) => {
      if (by.feedId && account.feedId && by.feedId === account.feedId) return true;
      return (account.platform || "x") === platform && !!handle && accountHandles(account).indexOf(handle) >= 0;
    });
  }

  function authorMatch(post, person) {
    if (!post || !person) return false;
    const platform = post.platform || "x";
    const handle = lower(post.handle);
    if (!handle) return false;
    return (person.accounts || []).some((account) => (account.platform || "x") === platform && accountHandles(account).indexOf(handle) >= 0);
  }

  function countsAsOwn(post, person) {
    if (!post || post.kind === "reply") return false;
    if (reposterMatch(post, person) && !authorMatch(post, person)) return false;
    return true;
  }

  function owns(post, person) {
    if (!post || !person) return false;
    const platform = post.platform || "x";
    const handle = lower(post.handle);
    const channel = String(post.channelId || "");
    return (person.accounts || []).some((account) => {
      if ((account.platform || "x") !== platform) return false;
      if (account.feedId && post.feedId === account.feedId) return true;
      if (handle && accountHandles(account).indexOf(handle) >= 0) return true;
      if (account.permanentId && String(post.permanentId || "") === String(account.permanentId)) return true;
      if (account.channelId && (channel === account.channelId || handle === lower(account.channelId) || post.feedId === (account.platform + ":" + account.channelId))) return true;
      return false;
    }) || catalogIds(person).indexOf(post.feedId) >= 0;
  }

  function stamp(post) { return (post && (post.sortDate || post.date)) || ""; }

  function dedupePosts(rows) {
    const seen = new Set();
    const out = [];
    rows.forEach((post) => {
      if (!post) return;
      const key = (post.platform || "") + ":" + (post.kind === "repost" ? post.id : (post.statusId || post.id));
      if (seen.has(key)) return;
      seen.add(key);
      out.push(post);
    });
    out.sort((a, b) => stamp(a) < stamp(b) ? 1 : stamp(a) > stamp(b) ? -1 : 0);
    return out;
  }

  function isShort(post) {
    if (!post || (post.platform || "x") === "x") return false;
    if (post.short) return true;
    const blob = [post.url, post.statusId, post.id].join(" ");
    if (/\/shorts\//.test(blob)) return true;
    const media = (post.media || [])[0];
    const dur = media && Number(media.duration);
    return !!(media && (media.type === "video" || media.type === "animated_gif") && isFinite(dur) && dur > 0 && dur <= 60);
  }

  function isVideo(post) {
    if (!post || post.kind === "reply" || post.kind === "community" || post.kind === "repost" || isShort(post)) return false;
    if (post.repostedBy && (post.repostedBy.handle || post.repostedBy.name)) return false;
    if (post.platform === "youtube") return true;
    return (post.media || []).some((item) => item && (item.type === "video" || item.type === "animated_gif"));
  }

  function hasMedia(post) {
    return (post.media || []).some((item) => item && (item.type === "photo" || item.type === "video" || item.type === "animated_gif" || item.poster || (item.type !== "link" && item.url)));
  }

  function tabsFor(person, rows) {
    const platforms = {};
    (person.accounts || []).forEach((account) => { platforms[account.platform || "x"] = true; });
    const tabs = [["posts", tr("Posts")]];
    if (platforms.youtube || platforms.x || rows.some(isVideo)) tabs.push(["videos", tr("Videos")]);
    if (platforms.youtube || rows.some(isShort)) tabs.push(["shorts", "Shorts"]);
    if (platforms.youtube || rows.some((post) => post.kind === "community")) tabs.push(["community", tr("Community")]);
    if (platforms.x || platforms.threads || rows.some((post) => post.kind === "reply")) tabs.push(["replies", tr("Replies")]);
    if (platforms.x || platforms.instagram || platforms.threads || platforms.vk || platforms.telegram || platforms.discord || rows.some(hasMedia)) tabs.push(["media", tr("Media")]);
    return tabs;
  }

  function filterTab(rows, tab) {
    if (tab === "videos") return rows.filter(isVideo);
    if (tab === "shorts") return rows.filter(isShort);
    if (tab === "community") return rows.filter((post) => post.kind === "community");
    if (tab === "replies") return rows.filter((post) => post.kind === "reply");
    if (tab === "media") return rows.filter((post) => post.kind !== "reply" && hasMedia(post));
    return rows.filter((post) => post.kind !== "reply");
  }

  function postsFor(person, all) {
    return dedupePosts((all || []).filter((post) => owns(post, person)));
  }

  function external(account) {
    if (!account) return "";
    if (account.url) return account.url;
    const handle = account.handle || "";
    if (account.platform === "x") return "https://x.com/" + handle;
    if (account.platform === "youtube") return account.channelId ? "https://www.youtube.com/channel/" + account.channelId : "https://www.youtube.com/@" + handle;
    if (account.platform === "instagram") return "https://www.instagram.com/" + handle + "/";
    if (account.platform === "threads") return "https://www.threads.com/@" + handle;
    if (account.platform === "vk") return "https://vk.com/" + handle;
    if (account.platform === "telegram") return "https://t.me/" + handle;
    return account.url || "";
  }

  function preferred(person) {
    const accounts = person.accounts || [];
    const rank = { youtube: 0, x: 1, instagram: 2 };
    return accounts.slice().sort((a, b) => (rank[a.platform] == null ? 9 : rank[a.platform]) - (rank[b.platform] == null ? 9 : rank[b.platform]))[0] || null;
  }

  function baseFeed(person) {
    const list = hooks().feeds ? hooks().feeds() : [];
    const order = preferred(person);
    let found = null;
    (person.accounts || []).forEach((account) => {
      if (found) return;
      list.forEach((feed) => {
        if (!found && sameAccount(feed, account)) found = feed;
      });
    });
    if (found) return found;
    const account = order || {};
    return {
      id: account.feedId || ((account.platform || "x") + ":" + (account.handle || person.id)),
      platform: account.platform || "x",
      handle: account.handle || person.id,
      channelId: account.channelId || "",
      name: person.name,
      configured: false
    };
  }

  function decorate(feed, person) {
    const base = baseFeed(person);
    const copy = Object.assign({}, base, {
      name: person.name || base.name,
      avatar: person.avatar || base.avatar,
      banner: person.banner || base.banner,
      bio: person.bio || base.bio,
      aliases: (person.accounts || []).map((account) => account.handle || "").join(" "),
      personId: person.id,
      memberIds: catalogIds(person)
    });
    if (!copy.memberIds.length && feed && feed.id) copy.memberIds = [feed.id];
    return copy;
  }

  function collapse(list) {
    const seen = new Set();
    const out = [];
    (list || []).forEach((feed) => {
      const person = matchFeed(feed);
      if (!person) { out.push(feed); return; }
      if (seen.has(person.id)) return;
      seen.add(person.id);
      out.push(decorate(feed, person));
    });
    return out;
  }

  function suggestions(list, followed) {
    const isOn = typeof followed === "function" ? followed : () => false;
    const seen = new Set();
    const out = [];
    (list || []).forEach((feed) => {
      if (!feed || !feed.id) return;
      const person = matchFeed(feed);
      if (person) {
        if (seen.has(person.id)) return;
        seen.add(person.id);
        const ids = catalogIds(person);
        if (ids.some(isOn) || isOn(feed.id)) return;
        out.push(decorate(feed, person));
        return;
      }
      if (isOn(feed.id)) return;
      out.push(feed);
    });
    out.sort((a, b) => (b.configured ? 1 : 0) - (a.configured ? 1 : 0) || String(a.name || "").localeCompare(String(b.name || "")));
    return out;
  }

  function countHtml(person) {
    const format = hooks().formatCount || ((n) => String(n));
    const hrefFor = hooks().connectHref || (() => "");
    const extraOf = hooks().extraFollowers || (() => 0);
    const ensure = hooks().ensureCounts || (() => {});
    const link = (html, tab) => {
      const href = hrefFor(person, tab);
      return href ? `<a href="${esc(href)}">${html}</a>` : html;
    };
    const followerRows = [];
    let following = null;
    (person.accounts || []).forEach((account) => {
      const id = account.feedId || ((account.platform || "x") + ":" + (account.handle || ""));
      if (id) ensure(id);
      const extra = Number(extraOf(id)) || 0;
      if (account.followers != null || extra) followerRows.push({ platform: account.platform, value: (Number(account.followers) || 0) + extra });
      if (account.following != null && following == null) following = account.following;
    });
    const bits = followerRows.map((row) => {
      const label = followerRows.length > 1
        ? (row.platform === "youtube" ? tr("YouTube subscribers") : tr("{platform} followers", { platform: NET[row.platform] || row.platform || "" }))
        : (row.platform === "youtube" ? tr("Subscribers") : tr("Followers"));
      return link(`<b>${esc(format(row.value))}</b> <span>${esc(label)}</span>`, "followers");
    });
    if (following != null) bits.push(link(`<b>${esc(format(following))}</b> <span>${tr("Following count")}</span>`, "following"));
    return bits.length ? `<div class="counts">${bits.join("")}</div>` : "";
  }

  function chipHtml(person) {
    const badge = hooks().sourceBadge || (() => "");
    return `<div class="pchips">${(person.accounts || []).map((account) => {
      const href = external(account);
      const net = NET[account.platform] || account.platform || "";
      const handle = account.handle ? "@" + account.handle : net;
      return `<a class="pchip" data-act="stop" target="_blank" rel="noopener noreferrer" href="${esc(href)}">${badge(account.platform)}<span class="pchip-net">${esc(net)}</span><span>${esc(handle)}</span></a>`;
    }).join("")}</div>`;
  }

  function mediaGrid(rows) {
    const statusHash = hooks().statusHash;
    const watchHash = hooks().watchHash;
    const cells = rows.map((post) => {
      const media = (post.media || []).find((item) => item && (item.poster || item.type === "photo" || item.type === "video" || item.type === "animated_gif"));
      if (!media) return "";
      const src = media.poster || (media.type === "photo" ? media.url : "");
      if (!src) return "";
      const dest = post.watch && watchHash ? watchHash(post) : (statusHash ? statusHash(post) : "#/");
      return `<a class="pmedia-cell" href="${esc(dest)}"><img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer"></a>`;
    }).filter(Boolean);
    return cells.length ? `<div class="pmedia">${cells.join("")}</div>` : "";
  }

  function emptyCopy(tab) {
    if (tab === "replies") return [tr("No replies yet"), tr("Replies from these accounts will show up here.")];
    if (tab === "media") return [tr("No media yet"), tr("Photos and videos from these accounts will show up here.")];
    if (tab === "videos") return [tr("No videos yet"), tr("YouTube videos and videos from X will show up here.")];
    if (tab === "shorts") return [tr("No Shorts yet"), tr("Short videos from these accounts will show up here.")];
    if (tab === "community") return [tr("No community posts yet"), tr("Community posts from this channel will show up here.")];
    return [tr("No posts yet"), tr("Posts from these accounts will show up here.")];
  }

  function page(route) {
    const person = route && route.name === "person" ? byId(route.id) : match(route && route.platform, route && route.handle);
    if (!person) return null;
    const h = hooks();
    const all = postsFor(person, h.posts ? h.posts() : []);
    all.forEach((post) => { if (h.ensureYtMeta && post.platform === "youtube") h.ensureYtMeta(post); });
    const tabs = tabsFor(person, all);
    const requested = route.query && route.query.get ? (route.query.get("tab") || "") : "";
    const tab = tabs.some((pair) => pair[0] === requested) ? requested : "posts";
    const list = filterTab(all, tab);
    const posted = all.filter((post) => countsAsOwn(post, person)).length;
    const count = (h.formatCount ? h.formatCount(posted) : String(posted)) + " posts";
    const bannerFace = root.ViktorychFaces && root.ViktorychFaces.banner ? root.ViktorychFaces.banner(person.banner, person.bannerFace) : (person.banner ? "photo" : "default");
    const banner = bannerFace === "none" ? "" : (bannerFace === "photo" ? `<img class="pbanner" src="${esc(person.banner)}" alt="">` : `<div class="pbanner"></div>`);
    const base = baseFeed(person);
    const follow = h.followButtonClean ? h.followButtonClean(base.id, true) : "";
    const who = preferred(person) || base;
    const bell = h.bellButton ? h.bellButton(base.id, who.handle || base.handle || "") : "";
    const shareId = base.id || ("person:" + person.id);
    const hrefFor = (id) => "#/p/" + encodeURIComponent(person.id) + (id === "posts" ? "" : "?tab=" + id);
    const tabHtml = tabs.map((pair) => `<a class="tab${tab === pair[0] ? " on" : ""}" role="tab" aria-selected="${tab === pair[0] ? "true" : "false"}" href="${esc(hrefFor(pair[0]))}"><span>${esc(pair[1])}</span></a>`).join("");
    let avatar = h.avatar ? h.avatar(person.avatar, person.name, "pava") : "";
    if (root.Spaces && root.Spaces.avatar) {
      (person.accounts || []).forEach((account) => {
        avatar = root.Spaces.avatar(avatar, account && account.platform, account && account.handle);
      });
    }
    const bio = h.bioBlock ? h.bioBlock({
      id: "person:" + person.id,
      platform: (preferred(person) || {}).platform || "x",
      handle: (preferred(person) || {}).handle || "",
      bio: person.bio || "",
      kind: "bio"
    }) : (person.bio ? `<div class="bio">${esc(person.bio)}</div>` : "");
    const icon = h.icon || (() => "");
    let body = "";
    if (tab === "media") body = mediaGrid(list);
    else if (list.length && h.card) body = list.map((post) => h.card(post, reposterMatch(post, person) ? "" : "author")).join("");
    if (!body) {
      const copy = emptyCopy(tab);
      body = h.emptyBlock ? h.emptyBlock(copy[0], copy[1]) : "";
    }
    const tail = h.archiveSentinel ? h.archiveSentinel() : "";
    let liveCard = "";
    if (root.Spaces && root.Spaces.profileCard) {
      (person.accounts || []).some((account) => {
        liveCard = root.Spaces.profileCard(account && account.platform, account && account.handle) || "";
        return !!liveCard;
      });
    }
    return `<div class="topbar profile-bar">
      <div class="page-head">
        <button class="icon-btn" data-act="back" aria-label="${tr("Back")}">${icon("back")}</button>
        <div class="head-text"><div class="pt-name">${esc(person.name || person.id)}</div><div class="pt-count">${esc(count)}</div></div>
      </div>
    </div>
    ${banner}
    <div class="pinfo" data-person="${esc(person.id)}">
      <div class="pava-row">
        ${avatar}
        <div class="pactions">
          <button class="icon-btn" type="button" data-act="share" data-kind="profile" data-id="${esc(shareId)}" aria-label="${tr("Share")}">${icon("share")}</button>
          ${bell}
          ${follow}
        </div>
      </div>
      <h1 class="pname">${esc(person.name || person.id)}</h1>
      ${chipHtml(person)}
      ${bio}
      ${countHtml(person)}
    </div>
    ${liveCard}
    <div class="tabs ptabs" role="tablist" aria-label="${tr("Profile")}">${tabHtml}</div>
    ${body}${tail}`;
  }

  function start() {
    const load = root.fetch ? root.fetch("people.json", { cache: "no-cache" }) : Promise.reject();
    return Promise.resolve(load).then((res) => (res && res.ok ? res.json() : null)).then((doc) => {
      if (!doc) return;
      ingest(doc);
      if (hooks().render) hooks().render();
    }).catch(() => {});
  }

  function bind(next) { bound = next || null; }

  function use(doc) { ingest(doc || { people: [] }); }

  root.FeedsPeople = {
    bind: bind,
    start: start,
    use: use,
    match: match,
    byId: byId,
    hashFor: hashFor,
    titleFor: titleFor,
    page: page,
    collapse: collapse,
    suggestions: suggestions,
    followIds: followIds,
    postsFor: postsFor,
    tabsFor: tabsFor,
    filterTab: filterTab
  };
})(typeof window !== "undefined" ? window : globalThis);
