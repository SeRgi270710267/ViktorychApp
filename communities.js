/* Communities: a mirrored subreddit and the posts signed-in people write here. */
(function () {
  var state = { index: null, docs: {}, internal: {}, tab: "top", filter: "all", loading: {} };

  function tr(key, vars) {
    return window.t ? window.t(key, vars) : key;
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function cfg() {
    return window.VIKTORYCH_ACCOUNTS || { api: "", gate: false };
  }
  function session() {
    var accounts = window.ViktorychAccounts;
    if (!accounts) return { token: "", account: null };
    return {
      token: accounts.token ? accounts.token() : "",
      account: accounts.account ? accounts.account() : null
    };
  }
  function call(path, opts) {
    var accounts = window.ViktorychAccounts;
    if (!accounts || !accounts.call || !cfg().api) return Promise.resolve(null);
    opts = opts || {};
    opts.token = session().token;
    return accounts.call(path, opts).catch(function () { return null; });
  }
  function render() {
    if (window.ViktorychCommunities && window.ViktorychCommunities.requestRender) window.ViktorychCommunities.requestRender();
  }
  function toast(text) {
    if (window.ViktorychCommunities && window.ViktorychCommunities.toast) window.ViktorychCommunities.toast(text);
  }
  function hidden(handle, text, platform) {
    if (window.ViktorychCommunities && window.ViktorychCommunities.hidden) return window.ViktorychCommunities.hidden(handle, text, platform);
    return false;
  }
  function note(item) {
    if (window.ViktorychCommunities && window.ViktorychCommunities.note) window.ViktorychCommunities.note(item);
  }
  function nameOf(value) {
    var text = String(value || "").trim().replace(/^https?:\/\/(?:www\.|old\.)?reddit\.com\/r\//i, "").replace(/^\/?r\//i, "");
    text = text.split(/[/?#]/)[0].toLowerCase();
    return /^[a-z0-9_]{2,21}$/.test(text) ? text : "";
  }
  function signedIn() {
    return !!(session().token && cfg().api);
  }
  function owner() {
    var account = session().account;
    return !!(account && account.owner);
  }

  function loadIndex() {
    if (state.index) return Promise.resolve(state.index);
    return fetch("data/communities/index.json", { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("index");
      return res.json();
    }).then(function (doc) {
      state.index = doc && Array.isArray(doc.communities) ? doc : { communities: [] };
      return state.index;
    }).catch(function () {
      state.index = { communities: [] };
      return state.index;
    });
  }
  function loadDoc(name) {
    if (state.docs[name]) return Promise.resolve(state.docs[name]);
    return fetch("data/communities/" + name + ".json", { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("doc");
      return res.json();
    }).then(function (doc) {
      state.docs[name] = doc || { name: name, posts: [] };
      return state.docs[name];
    }).catch(function () {
      state.docs[name] = { name: name, title: name, posts: [], missing: true };
      return state.docs[name];
    });
  }
  function loadInternal(name) {
    if (!signedIn()) {
      state.internal[name] = null;
      return Promise.resolve(null);
    }
    return call("/v1/communities/" + encodeURIComponent(name)).then(function (body) {
      state.internal[name] = body && body.community ? body : null;
      var notes = body && body.notes;
      if (notes && notes.length) {
        notes.forEach(note);
        call("/v1/communities/notes/seen", { method: "POST", body: { ids: notes.map(function (item) { return item.id; }) } });
      }
      return state.internal[name];
    });
  }

  function head(title, back) {
    return '<div class="topbar tall"><div class="page-head">' +
      (back ? '<a class="icon-btn" href="' + esc(back) + '" aria-label="' + esc(tr("Back")) + '">←</a>' : "") +
      '<div class="head-text grow"><h1>' + esc(title) + '</h1></div></div></div>';
  }
  function count(n) {
    var value = Number(n) || 0;
    if (value >= 1000000) return (value / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (value >= 1000) return (value / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(value);
  }

  function redditPosts(doc) {
    return (doc && doc.posts || []).filter(function (post) {
      return post && !hidden(post.author, (post.title || "") + " " + (post.text || ""), "reddit");
    });
  }
  function internalPosts(name) {
    var bag = state.internal[name];
    if (!bag || !signedIn()) return [];
    return (bag.posts || []).filter(function (post) {
      var author = post.author || {};
      return !hidden(author.handle, post.body, "app");
    });
  }
  function scoreOf(item) {
    if (item.source === "reddit") return Number(item.score) || 0;
    var bag = state.internal[item.community] || {};
    return Number((bag.likes || {})[item.id]) || 0;
  }
  function feedItems(name, doc) {
    var reddit = redditPosts(doc).map(function (post) {
      return { source: "reddit", community: name, id: post.id, created: (Number(post.created) || 0) * 1000, score: post.score, post: post };
    });
    var internal = internalPosts(name).filter(function (post) { return !post.parentId; }).map(function (post) {
      return { source: "app", community: name, id: post.id, created: Number(post.createdAt) || 0, score: 0, post: post };
    });
    var items = reddit.concat(internal);
    if (state.filter === "reddit") items = items.filter(function (item) { return item.source === "reddit"; });
    if (state.filter === "app") items = items.filter(function (item) { return item.source === "app"; });
    if (state.tab === "media") items = items.filter(function (item) { return item.source === "reddit" && item.post.media && item.post.media.length; });
    items.sort(function (a, b) {
      if (state.tab === "latest") return b.created - a.created;
      var delta = scoreOf(b) - scoreOf(a);
      return delta || (b.created - a.created);
    });
    return items;
  }
  function repliesFor(name, parentId, doc) {
    var reddit = [];
    (doc.posts || []).forEach(function (post) {
      (post.replies || []).forEach(function (reply) {
        if (reply.parent === parentId && !hidden(reply.author, reply.text, "reddit")) reddit.push({ source: "reddit", id: reply.id, created: (Number(reply.created) || 0) * 1000, reply: reply });
      });
    });
    var internal = internalPosts(name).filter(function (post) { return post.parentId === parentId; }).map(function (post) {
      return { source: "app", id: post.id, created: Number(post.createdAt) || 0, post: post };
    });
    var items = reddit.concat(internal);
    if (state.filter === "reddit") items = items.filter(function (item) { return item.source === "reddit"; });
    if (state.filter === "app") items = items.filter(function (item) { return item.source === "app"; });
    items.sort(function (a, b) { return a.created - b.created; });
    return items;
  }

  function chips() {
    var chip = function (id, label) {
      return '<button class="tab' + (state.filter === id ? " on" : "") + '" type="button" data-cm="filter" data-filter="' + id + '">' + esc(label) + "</button>";
    };
    return '<div class="tabs" role="tablist">' + chip("all", tr("All")) + chip("reddit", tr("Reddit")) + chip("app", tr("ViktorychApp")) + "</div>";
  }
  function tabs() {
    var tab = function (id, label) {
      return '<button class="tab' + (state.tab === id ? " on" : "") + '" type="button" data-cm="tab" data-tab="' + id + '">' + esc(label) + "</button>";
    };
    return '<div class="tabs" role="tablist">' + tab("top", tr("Top")) + tab("latest", tr("Latest")) + tab("media", tr("Media")) + "</div>";
  }
  function playUrl(name, post, media, index) {
    var api = String(cfg().api || "").replace(/\/$/, "");
    var role = media.type === "video" ? "video" : "photo";
    if (signedIn() && api && /^t3_[A-Za-z0-9]{1,12}$/.test(post.id || "")) {
      return api + "/tg/social/reddit/" + encodeURIComponent(name) + "/" + encodeURIComponent(post.id) + "/" + role + "/" + index;
    }
    return media.url;
  }
  function mediaHtml(name, post, list) {
    return (list || []).map(function (media, index) {
      if (!media || !media.url) return "";
      var src = playUrl(name, post, media, index);
      var fallback = src !== media.url ? ' data-fallback="' + esc(media.url) + '"' : "";
      if (media.type === "video") return '<video class="cm-video" controls playsinline src="' + esc(src) + '"' + fallback + "></video>";
      return '<img class="cm-photo" alt="" src="' + esc(src) + '"' + fallback + ">";
    }).join("");
  }
  function likeControl(name, id, base) {
    var bag = state.internal[name] || {};
    var extra = Number((bag.likes || {})[id]) || 0;
    var liked = (bag.mine || []).indexOf(id) >= 0;
    var total = (Number(base) || 0) + extra;
    if (!signedIn()) return '<span>' + esc(count(total)) + " " + esc(tr("Like")) + "</span>";
    return '<button type="button" data-cm="like" data-id="' + esc(id) + '">' + esc(tr("Like")) + " " + esc(count(total)) + (liked ? " ·" : "") + "</button>";
  }
  function face(author) {
    var letter = String(author.displayName || author.handle || "?").slice(0, 1);
    if (author.avatar && /^https:\/\//.test(author.avatar)) return '<img class="cm-ava" alt="" src="' + esc(author.avatar) + '">';
    return '<span class="cm-ava cm-letter">' + esc(letter) + "</span>";
  }
  function redditCard(name, post) {
    var href = "#/communities/" + encodeURIComponent(name) + "/" + encodeURIComponent(post.id);
    return '<article class="post" data-post="' + esc(post.id) + '"><div class="post-row"><div class="post-main"><div class="byline"><span class="cm-mark">' + esc(tr("Reddit")) + '</span><span class="name">u/' + esc(post.author || "") + '</span>' +
      (post.flair ? '<span class="cm-flair">' + esc(post.flair) + "</span>" : "") +
      '</div><a class="cm-title" href="' + href + '">' + esc(post.title || "") + "</a>" +
      (post.text ? '<p class="cm-text">' + esc(post.text) + "</p>" : "") +
      mediaHtml(name, post, post.media) +
      '<div class="cm-actions">' + likeControl(name, post.id, post.score) + '<a href="' + href + '">' + esc(count(post.comments)) + "</a></div></div></div></article>";
  }
  function appCard(name, post) {
    var author = post.author || {};
    var bag = state.internal[name] || {};
    var href = "#/communities/" + encodeURIComponent(name) + "/" + encodeURIComponent(post.id);
    var liked = (bag.mine || []).indexOf(post.id) >= 0;
    return '<article class="post cm-app" data-post="' + esc(post.id) + '"><div class="post-row">' + face(author) + '<div class="post-main"><div class="byline"><span class="name">' + esc(author.displayName || author.handle || "") +
      (author.owner ? " ✓" : "") + '</span><span class="handle">@' + esc(author.handle || "") + '</span><span class="cm-hint">' + esc(tr("Only on ViktorychApp")) + "</span></div>" +
      '<a class="cm-text" href="' + href + '">' + esc(post.body || "") + "</a>" +
      '<div class="cm-actions"><button type="button" data-cm="like" data-id="' + esc(post.id) + '">' + esc(tr("Like")) + " " + esc(count((bag.likes || {})[post.id] || 0)) + (liked ? " ·" : "") + "</button>" +
      '<a href="' + href + '">' + esc(tr("Reply")) + "</a>" +
      (post.mine || owner() ? '<button type="button" data-cm="delete" data-id="' + esc(post.id) + '" data-sub="' + esc(name) + '">' + esc(tr("Delete")) + "</button>" : "") +
      "</div></div></div></article>";
  }
  function card(name, item) {
    if (item.source === "reddit") return redditCard(name, item.post);
    return appCard(name, item.post);
  }
  function currentSub() {
    var parts = (location.hash || "").split("?")[0].replace(/^#\/?/, "").split("/");
    if (parts[0] !== "communities") return "";
    return nameOf(parts[1]);
  }

  function listPage() {
    var index = state.index;
    if (!index) {
      loadIndex().then(render);
      return head(tr("Communities")) + '<div class="reply-empty">' + esc(tr("Loading")) + "</div>";
    }
    var rows = (index.communities || []).map(function (row) {
      return '<a class="cm-row" href="#/communities/' + encodeURIComponent(row.name) + '"><span class="name">r/' + esc(row.name) + '</span><span class="handle">' + esc(row.title || "") + "</span><span>" + esc(count(row.subscribers)) + "</span></a>";
    }).join("");
    var form = owner() ? '<form class="cm-add" data-cm="add"><input name="name" placeholder="r/teslamotors" aria-label="' + esc(tr("Add community")) + '"><button type="submit">' + esc(tr("Add")) + "</button></form>" : "";
    return head(tr("Communities")) + form + (rows || '<div class="empty"><h2>' + esc(tr("No communities yet.")) + "</h2><p>" + esc(tr("Nothing is sent to Reddit.")) + "</p></div>");
  }

  function communityPage(route) {
    var name = nameOf(route.sub);
    if (!name) return head(tr("Communities"), "#/communities") + '<div class="empty"><h2>' + esc(tr("That community wasn’t found.")) + "</h2></div>";
    var doc = state.docs[name];
    if (!doc || state.loading[name]) {
      if (!state.loading[name]) {
        state.loading[name] = true;
        Promise.all([loadDoc(name), loadInternal(name)]).then(function () {
          state.loading[name] = false;
          render();
        });
      }
      return head("r/" + name, "#/communities") + '<div class="reply-empty">' + esc(tr("Loading")) + "</div>";
    }
    var bag = state.internal[name];
    var members = bag ? '<span class="cm-members">' + esc(count(bag.members)) + " " + esc(tr("ViktorychApp members")) + "</span>" : "";
    var join = signedIn() ? '<button type="button" data-cm="join" data-sub="' + esc(name) + '">' + esc(bag && bag.joined ? tr("Joined") : tr("Join")) + "</button>" : "";
    var banner = doc.banner ? '<img class="cm-banner" alt="" src="' + esc(doc.banner) + '">' : "";
    var about = '<details class="cm-about"><summary>' + esc(tr("About")) + "</summary><p>" + esc(doc.about || "") + "</p>" +
      ((doc.rules || []).map(function (rule) { return "<p><b>" + esc(rule.title || "") + "</b> " + esc(rule.text || "") + "</p>"; }).join("")) + "</details>";
    var remove = owner() ? '<button type="button" data-cm="remove" data-sub="' + esc(name) + '">' + esc(tr("Remove")) + "</button>" : "";
    var items = feedItems(name, doc);
    var empty = state.filter === "app" && !signedIn()
      ? '<div class="empty"><p>' + esc(tr("Sign in to post here.")) + "</p></div>"
      : (items.length ? "" : '<div class="empty"><h2>' + esc(tr("No posts yet")) + "</h2></div>");
    return head(doc.title || ("r/" + name), "#/communities") +
      '<section class="cm-hero">' + banner + '<div class="cm-id"><h2>r/' + esc(name) + "</h2><span>" + esc(count(doc.subscribers)) + " " + esc(tr("Reddit subscribers")) + "</span>" + members + join + remove + "</div></section>" +
      about + tabs() + chips() + empty + items.map(function (item) { return card(name, item); }).join("") +
      '<p class="cm-note">' + esc(tr("Nothing is sent to Reddit.")) + "</p>";
  }

  function findReddit(doc, id) {
    var found = null;
    (doc.posts || []).forEach(function (post) {
      if (post.id === id) found = { kind: "post", post: post };
      (post.replies || []).forEach(function (reply) {
        if (reply.id === id) found = { kind: "reply", reply: reply, post: post };
      });
    });
    return found;
  }
  function threadPage(route) {
    var name = nameOf(route.sub);
    var id = decodeURIComponent(route.post || "");
    var doc = state.docs[name];
    if (!doc) {
      loadDoc(name).then(function () { return loadInternal(name); }).then(render);
      return head(tr("Communities"), "#/communities/" + name) + '<div class="reply-empty">' + esc(tr("Loading")) + "</div>";
    }
    if (!state.internal[name] && signedIn() && !state.loading[name]) {
      state.loading[name] = true;
      loadInternal(name).then(function () { state.loading[name] = false; render(); });
    }
    var bag = state.internal[name] || { posts: [], likes: {}, mine: [] };
    var internal = (bag.posts || []).filter(function (post) { return post.id === id; })[0];
    var reddit = findReddit(doc, id);
    var focus = "";
    if (internal && signedIn()) focus = appCard(name, internal);
    else if (reddit && reddit.kind === "post") focus = redditCard(name, reddit.post);
    else if (reddit && reddit.kind === "reply") {
      focus = '<article class="post"><div class="post-main"><div class="byline"><span class="cm-mark">' + esc(tr("Reddit")) + '</span><span class="name">u/' + esc(reddit.reply.author || "") + "</span></div><p>" + esc(reddit.reply.text || "") + "</p></div></article>";
    }
    if (!focus) return head("r/" + name, "#/communities/" + name) + '<div class="empty"><h2>' + esc(tr("That community wasn’t found.")) + "</h2></div>";
    var kids = repliesFor(name, id, doc).map(function (item) {
      if (item.source === "reddit") {
        return '<article class="post reply-card"><div class="post-main"><div class="byline"><span class="cm-mark">' + esc(tr("Reddit")) + '</span><span class="name">u/' + esc(item.reply.author || "") + '</span></div><p>' + esc(item.reply.text || "") + '</p><div class="cm-actions">' + likeControl(name, item.reply.id, item.reply.score) + "</div></div></article>";
      }
      return appCard(name, item.post);
    }).join("");
    var box = signedIn()
      ? '<form class="composer" data-cm="reply" data-sub="' + esc(name) + '" data-parent="' + esc(id) + '"><textarea aria-label="' + esc(tr("Post your reply")) + '" placeholder="' + esc(tr("Post your reply")) + '"></textarea><button type="submit">' + esc(tr("Reply")) + "</button></form>"
      : '<p class="cm-note">' + esc(tr("Sign in to post here.")) + "</p>";
    return head("r/" + name, "#/communities/" + name) + focus + chips() + kids + box;
  }

  function page(route) {
    if (route.post) return threadPage(route);
    if (route.sub) return communityPage(route);
    return listPage();
  }

  function takeCompose(text) {
    var hash = (location.hash || "").split("?")[0];
    var parts = hash.replace(/^#\/?/, "").split("/");
    if (parts[0] !== "communities" || !nameOf(parts[1]) || parts[2]) return false;
    if (!signedIn()) {
      toast(tr("Sign in to post here."));
      return true;
    }
    var body = String(text || "").trim();
    if (!body) return true;
    call("/v1/communities/" + encodeURIComponent(nameOf(parts[1])) + "/posts", { method: "POST", body: { text: body } }).then(function () {
      delete state.internal[nameOf(parts[1])];
      loadInternal(nameOf(parts[1])).then(render);
    });
    return true;
  }

  document.addEventListener("click", function (event) {
    var el = event.target.closest("[data-cm]");
    if (!el) return;
    var act = el.dataset.cm;
    if (act === "filter") {
      state.filter = el.dataset.filter || "all";
      render();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (act === "tab") {
      state.tab = el.dataset.tab || "top";
      render();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (act === "like") {
      event.preventDefault();
      event.stopPropagation();
      if (!signedIn()) { toast(tr("Sign in to post here.")); return; }
      var id = el.dataset.id;
      var sub = currentSub();
      var bag = state.internal[sub] || {};
      var on = (bag.mine || []).indexOf(id) >= 0;
      call("/v1/communities/" + encodeURIComponent(sub) + "/likes", { method: on ? "DELETE" : "POST", body: { itemId: id } }).then(function () {
        delete state.internal[sub];
        loadInternal(sub).then(render);
      });
      return;
    }
    if (act === "delete") {
      event.preventDefault();
      event.stopPropagation();
      call("/v1/communities/" + encodeURIComponent(el.dataset.sub) + "/posts/" + encodeURIComponent(el.dataset.id), { method: "DELETE" }).then(function () {
        delete state.internal[el.dataset.sub];
        loadInternal(el.dataset.sub).then(render);
      });
      return;
    }
    if (act === "join") {
      event.preventDefault();
      event.stopPropagation();
      var subName = el.dataset.sub;
      var joined = state.internal[subName] && state.internal[subName].joined;
      call("/v1/communities/" + encodeURIComponent(subName) + "/join", { method: joined ? "DELETE" : "POST" }).then(function () {
        delete state.internal[subName];
        loadInternal(subName).then(render);
      });
      return;
    }
    if (act === "remove") {
      event.preventDefault();
      event.stopPropagation();
      call("/v1/owner/communities/" + encodeURIComponent(el.dataset.sub), { method: "DELETE" }).then(function () { toast(tr("Removed")); });
    }
  }, true);

  document.addEventListener("submit", function (event) {
    var form = event.target.closest("[data-cm]");
    if (!form) return;
    event.preventDefault();
    event.stopPropagation();
    if (form.dataset.cm === "add") {
      var input = form.querySelector("input");
      var name = nameOf(input && input.value);
      if (!name) { toast(tr("That community wasn’t found.")); return; }
      call("/v1/owner/communities", { method: "POST", body: { name: name } }).then(function (body) {
        if (!body || !body.community) { toast(tr("Couldn't post.")); return; }
        toast(tr("New posts show up after the next sync."));
      });
      return;
    }
    if (form.dataset.cm === "reply") {
      var area = form.querySelector("textarea");
      var text = area ? area.value.trim() : "";
      if (!text) return;
      call("/v1/communities/" + encodeURIComponent(form.dataset.sub) + "/posts", {
        method: "POST",
        body: { text: text, parentId: form.dataset.parent }
      }).then(function (body) {
        if (!body || !body.post) { toast(tr("Couldn't post.")); return; }
        area.value = "";
        delete state.internal[form.dataset.sub];
        loadInternal(form.dataset.sub).then(render);
      });
    }
  }, true);

  function pullNotes() {
    if (!signedIn()) return Promise.resolve();
    return call("/v1/communities/notes").then(function (body) {
      var notes = body && body.notes;
      if (!notes || !notes.length) return;
      notes.forEach(note);
      call("/v1/communities/notes/seen", { method: "POST", body: { ids: notes.map(function (item) { return item.id; }) } });
    });
  }

  document.addEventListener("error", function (event) {
    var el = event.target;
    if (!el || !el.getAttribute) return;
    var next = el.getAttribute("data-fallback");
    if (!next) return;
    el.removeAttribute("data-fallback");
    el.src = next;
  }, true);

  window.ViktorychCommunities = {
    page: page,
    takeCompose: takeCompose,
    pullNotes: pullNotes,
    requestRender: null,
    toast: null,
    hidden: null,
    note: null
  };
})();
