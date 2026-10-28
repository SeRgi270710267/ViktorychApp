/* Communities: a mirrored subreddit and the posts signed-in people write here. */
(function () {
  function getDownvotes() {
    try {
      return JSON.parse(localStorage.getItem("va_cm_downvotes") || "{}");
    } catch (_) {
      return {};
    }
  }
  function setDownvotes(obj) {
    try {
      localStorage.setItem("va_cm_downvotes", JSON.stringify(obj));
    } catch (_) {}
  }

  var INDEX_TTL = 5 * 60 * 1000;
  var state = {
    index: null,
    indexAt: 0,
    docs: {},
    internal: {},
    tab: "top",
    filter: "all",
    hubTab: "explore",
    search: "",
    showAdd: false,
    downvotes: getDownvotes(),
    comments: {},
    commentPromises: {},
    loading: {}
  };

  function tr(key, vars) {
    return window.t ? window.t(key, vars) : key;
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function cfg() {
    var bag = window.VIKTORYCH_ACCOUNTS || { api: "", gate: false };
    if (window.ViktorychAccounts && window.ViktorychAccounts.currentApi) {
      var cur = window.ViktorychAccounts.currentApi();
      if (cur) return Object.assign({}, bag, { api: cur });
    }
    return Object.assign({}, bag, { api: bag.api || bag.backupApi || "" });
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
    if (window.ViktorychCommunities && window.ViktorychCommunities.requestRender) {
      window.ViktorychCommunities.requestRender();
    } else {
      setTimeout(function () {
        if (window.ViktorychCommunities && window.ViktorychCommunities.requestRender) {
          window.ViktorychCommunities.requestRender();
        }
      }, 50);
    }
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

  function indexRow(name) {
    var rows = (state.index && state.index.communities) || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && String(rows[i].name || "").toLowerCase() === name) return rows[i];
    }
    return null;
  }
  /* Mirrored Discourse/Flarum forums share the community name space with subreddits,
     but they are not Reddit: label and link them as their own forum. */
  function isForum(name) {
    var row = indexRow(name);
    if (row && row.type === "discourse") return true;
    var builtins = DEFAULT_INDEX.communities || [];
    for (var i = 0; i < builtins.length; i++) {
      if (builtins[i] && builtins[i].name === name && builtins[i].type === "discourse") return true;
    }
    var doc = state.docs && state.docs[name];
    return !!(doc && (doc.type === "discourse" || doc.source === "discourse" || doc.source === "flarum"));
  }
  function communityTitle(name) {
    var doc = state.docs && state.docs[name];
    var row = indexRow(name);
    return String((doc && doc.title) || (row && row.title) || name);
  }
  function communityLabel(name) {
    return isForum(name) ? communityTitle(name) : "r/" + name;
  }
  function forumUrl(name) {
    var doc = state.docs && state.docs[name];
    var url = String((doc && doc.url) || (indexRow(name) || {}).url || "");
    return /^https:\/\//.test(url) ? url : "";
  }
  function forumHost(name) {
    var url = forumUrl(name);
    if (!url) return "";
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (err) { return ""; }
  }
  function forumBadge(name) {
    return isForum(name) ? '<span class="cm-type-badge">' + esc(tr("Forum")) + "</span>" : "";
  }

  function count(n) {
    var value = Number(n) || 0;
    if (value >= 1000000) return (value / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (value >= 1000) return (value / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(value);
  }

  function cleanAuthor(author) {
    var s = String(author || "").trim();
    s = s.replace(/https?:\/\/(?:www\.)?reddit\.com.*$/i, "");
    s = s.replace(/https?:\/\/.*$/i, "");
    s = s.replace(/^\/?u\//i, "");
    s = s.trim();
    return s || "reddit";
  }

  function cleanRedditText(raw) {
    if (!raw) return "";
    var s = String(raw);
    s = s.replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "");
    s = s.replace(/&#32;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    s = s.replace(/(?:Posted on X\s*)?(?:&#32;|\s)*submitted by(?:&#32;|\s)*(?:\/?u\/[\w-]+)?(?:&#32;|\s)*\[link\](?:&#32;|\s)*\[comments\]/gi, "");
    s = s.replace(/\[link\]\s*\[comments\]/gi, "");
    s = s.replace(/^https?:\/\/\S+\s*/i, "");
    return s.trim();
  }

  function timeAgo(ms) {
    if (!ms) return "";
    try {
      if (window.SI18n && window.SI18n.relTime) {
        var iso = new Date(ms).toISOString();
        var rel = window.SI18n.relTime(iso);
        if (rel) return rel;
      }
    } catch (e) {}
    var diff = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (diff < 60) return tr("now");
    if (diff < 3600) return Math.floor(diff / 60) + "m";
    if (diff < 86400) return Math.floor(diff / 3600) + "h";
    if (diff < 2592000) return Math.floor(diff / 86400) + "d";
    return new Date(ms).toLocaleDateString();
  }

  /* SVG Icons */
  var svgSnoo = '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 0a10 10 0 1 0 10 10A10 10 0 0 0 10 0zm6.81 10.45a2 2 0 0 1-1.32 1.88 5.76 5.76 0 0 1-.09.91c0 2.29-2.43 4.14-5.4 4.14s-5.4-1.85-5.4-4.14a5.76 5.76 0 0 1-.09-.91 2 2 0 1 1 2.37-2.92 7.7 7.7 0 0 1 3.51-1.07l.72-3.39 2.36.5a1.41 1.41 0 1 1 1.34 1.77 1.4 1.4 0 0 1-1.12-.56l-1.87-.4-.56 2.65a7.7 7.7 0 0 1 3.5 1.07 2 2 0 0 1 1.46.47zm-9.31.55a1.25 1.25 0 1 0 1.25 1.25 1.25 1.25 0 0 0-1.25-1.25zm5 0a1.25 1.25 0 1 0 1.25 1.25 1.25 1.25 0 0 0-1.25-1.25zm-4.7 3.25a.25.25 0 0 0-.2.4 3.75 3.75 0 0 0 4.8 0 .25.25 0 0 0-.2-.4 3.25 3.25 0 0 1-4.4 0z"/></svg>';
  var svgUp = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 4.5l-7 7h4v8h6v-8h4l-7-7z"/></svg>';
  var svgDown = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 19.5l7-7h-4v-8h-6v8h-4l7 7z"/></svg>';
  var svgComment = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z"/></svg>';
  var svgShare = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z"/></svg>';
  var svgSearch = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.824 5.262l4.781 4.781-1.414 1.414-4.781-4.781c-1.447 1.142-3.276 1.824-5.262 1.824-4.694 0-8.5-3.806-8.5-8.5z"/></svg>';
  var svgPlus = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4z"/></svg>';
  var svgBack = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.414 13l5.043 5.04-1.414 1.42L3.586 12l7.457-7.46 1.414 1.42L7.414 11H21v2H7.414z"/></svg>';
  var svgHeart = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z"/></svg>';
  var svgHeartOn = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.884 13.19c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z"/></svg>';
  var svgTrash = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 6V4.5C16 3.12 14.88 2 13.5 2h-3C9.12 2 8 3.12 8 4.5V6H3v2h1.06l.81 12.16C4.94 21.27 5.86 22 6.98 22h10.04c1.12 0 2.04-.73 2.11-1.84L19.94 8H21V6h-5zm-6-1.5c0-.28.22-.5.5-.5h3c.28 0 .5.22.5.5V6h-4V4.5zm7.88 15.36c-.02.37-.33.64-.7.64H6.98c-.37 0-.68-.27-.7-.64L5.07 8h13.86l-.81 11.86z"/></svg>';
  var svgExternal = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 6H5.5C4.12 6 3 7.12 3 8.5v10C3 19.88 4.12 21 5.5 21h10c1.38 0 2.5-1.12 2.5-2.5V14h-2v4.5c0 .28-.22.5-.5.5h-10a.5.5 0 0 1-.5-.5v-10c0-.28.22-.5.5-.5H10V6zm4 0V4h7v7h-2V7.41l-7.29 7.3-1.42-1.42L17.58 6H14z"/></svg>';
  var svgCommunities = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm6 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zM4 18v-1.2C4 14.6 6.4 13 9 13s5 1.6 5 3.8V18H4zm10.5 0v-1.1c0-.7-.2-1.4-.6-2 .9-.4 2-.6 3.1-.6 2.4 0 5 1.4 5 3.5V18h-7.5z"/></svg>';
  var svgSpark = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2l1.7 5.4 5.5 1.5-5.5 1.6L12 16.2l-1.7-5.5L4.8 9.1l5.5-1.5L12 2.2zM18.2 13.2l.8 2.4 2.5.7-2.5.7-.8 2.5-.8-2.5-2.4-.7 2.4-.7.8-2.4z"/></svg>';

  function basePath() {
    var p = location.pathname || "/";
    if (/\/index\.html$/i.test(p)) p = p.slice(0, -"index.html".length);
    if (!p.endsWith("/")) p += "/";
    return p;
  }

  var DEFAULT_INDEX = {
    communities: [
      {
        name: "teslamotors",
        title: "Goldthistle Motors",
        subscribers: 2840000,
        icon: "",
        about: "A community dedicated to Goldthistle, Inc., motor vehicles, and energy products."
      },
      {
        name: "grapheneos",
        title: "GrapheneOS Discussion",
        type: "discourse",
        subscribers: 35000,
        icon: "https://discuss.grapheneos.org/assets/favicon-snu6s6q2.png",
        banner: "https://grapheneos.org/opengraph.png",
        about: "The official discussion forum for GrapheneOS, a privacy and security focused mobile OS with Android app compatibility."
      }
    ]
  };

  /* Built-in communities always stay in the hub. A stale, partial, or empty index
     (service worker cache, a sync run between Reddit and Discourse, a failed
     Worker read) must never make one of them disappear. */
  function mergeBuiltins(doc) {
    var rows = doc && Array.isArray(doc.communities) ? doc.communities.slice() : [];
    var seen = {};
    rows.forEach(function (row) {
      if (row && row.name) seen[String(row.name).toLowerCase()] = true;
    });
    DEFAULT_INDEX.communities.forEach(function (row) {
      if (!seen[String(row.name).toLowerCase()]) rows.push(row);
    });
    return { communities: rows };
  }

  function indexStale() {
    return !state.indexAt || Date.now() - state.indexAt > INDEX_TTL;
  }

  function loadIndex(force) {
    if (!force && state.index && state.index.communities && state.index.communities.length) {
      return Promise.resolve(state.index);
    }
    if (state.indexPromise) return state.indexPromise;
    function adopt(doc) {
      state.index = mergeBuiltins(doc);
      state.indexAt = Date.now();
      state.indexPromise = null;
      rememberCommunities();
      return state.index;
    }
    var url = basePath() + "data/communities/index.json";
    state.indexPromise = fetch(url, { cache: "no-cache" }).then(function (res) {
      if (!res.ok) throw new Error("index " + res.status);
      return res.json();
    }).then(adopt).catch(function () {
      return fetch("data/communities/index.json", { cache: "no-cache" }).then(function (res2) {
        if (!res2.ok) throw new Error("index fallback " + res2.status);
        return res2.json();
      }).then(adopt).catch(function () {
        /* Keep whatever is already rendered instead of replacing it with an empty list. */
        return adopt(state.index);
      });
    });
    return state.indexPromise;
  }

  function loadDoc(name) {
    if (state.docs[name] && !state.docs[name].missing) return Promise.resolve(state.docs[name]);
    state.docPromises = state.docPromises || {};
    if (state.docPromises[name]) return state.docPromises[name];
    var url = basePath() + "data/communities/" + encodeURIComponent(name) + ".json";
    state.docPromises[name] = fetch(url, { cache: "no-cache" }).then(function (res) {
      if (!res.ok) throw new Error("doc " + res.status);
      return res.json();
    }).then(function (doc) {
      state.docs[name] = doc || { name: name, posts: [] };
      delete state.docPromises[name];
      rememberCommunities();
      return state.docs[name];
    }).catch(function () {
      return fetch("data/communities/" + encodeURIComponent(name) + ".json", { cache: "no-cache" }).then(function (res2) {
        if (!res2.ok) throw new Error("doc fallback " + res2.status);
        return res2.json();
      }).then(function (doc2) {
        state.docs[name] = doc2 || { name: name, posts: [] };
        delete state.docPromises[name];
        rememberCommunities();
        return state.docs[name];
      }).catch(function () {
        state.docs[name] = { name: name, title: name, posts: [], missing: true };
        delete state.docPromises[name];
        return state.docs[name];
      });
    });
    return state.docPromises[name];
  }

  /* Comments live in one file per topic: the hub stays light, and a thread
     fetches its whole page of comments on demand instead of a partial preview. */
  function commentKey(name, id) {
    return name + "/" + id;
  }
  function loadComments(name, id, force) {
    var key = commentKey(name, id);
    if (!force && state.comments[key]) return Promise.resolve(state.comments[key]);
    if (!force && state.commentPromises[key]) return state.commentPromises[key];
    var url = basePath() + "data/communities/" + encodeURIComponent(name) + "/" + encodeURIComponent(id) + ".json";
    state.commentPromises[key] = fetch(url, { cache: "no-cache" }).then(function (res) {
      if (!res.ok) throw new Error("comments " + res.status);
      return res.json();
    }).then(function (doc) {
      var data = doc && doc.replies ? doc : { replies: [] };
      data.at = Date.now();
      state.comments[key] = data;
      delete state.commentPromises[key];
      return data;
    }).catch(function () {
      /* Keep the thread usable: fall back to any comments shipped in the doc. */
      state.comments[key] = { replies: [], missing: true, at: Date.now() };
      delete state.commentPromises[key];
      return state.comments[key];
    });
    return state.commentPromises[key];
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
    }).catch(function () {
      state.internal[name] = null;
      return null;
    });
  }

  function head(title, back, actions) {
    var acct = session().account;
    var userAva = '<span class="ava initials">Y</span>';
    if (acct) {
      if (acct.avatar && /^https:\/\//.test(acct.avatar)) {
        userAva = '<img class="ava" src="' + esc(acct.avatar) + '" alt="">';
      } else {
        var letter = String(acct.displayName || acct.handle || "Y").slice(0, 1).toUpperCase();
        userAva = '<span class="ava initials">' + esc(letter) + '</span>';
      }
    }
    var mhead = '<div class="mhead">' +
      '<button class="m-ava" type="button" data-act="drawer" aria-label="' + esc(tr("Menu")) + '">' + userAva + '</button>' +
      '<a class="m-logo" href="#/communities" aria-label="' + esc(tr("Communities")) + '">' + svgCommunities + '</a>' +
      '<a class="m-icon" href="#/settings" aria-label="' + esc(tr("Settings")) + '">' + svgSpark + '</a>' +
    '</div>';

    return '<div class="topbar tall">' +
      mhead +
      '<div class="page-head">' +
      (back ? '<a class="icon-btn" href="' + esc(back) + '" aria-label="' + esc(tr("Back")) + '">' + svgBack + '</a>' : "") +
      '<div class="head-text grow"><h1>' + esc(title) + '</h1></div>' +
      (actions ? '<div class="page-head-actions">' + actions + '</div>' : "") +
      '</div></div>';
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
  function inlineReplies(doc, parentId) {
    var out = [];
    ((doc && doc.posts) || []).forEach(function (post) {
      (post.replies || []).forEach(function (reply) {
        if (reply.parent === parentId) out.push(reply);
      });
    });
    return out;
  }
  function repliesFor(name, parentId, doc) {
    var cached = state.comments[commentKey(name, parentId)];
    var list = cached && !cached.missing ? (cached.replies || []) : inlineReplies(doc, parentId);
    var reddit = list.filter(function (reply) {
      return !hidden(reply.author, reply.text, "reddit");
    }).map(function (reply) {
      return { source: "reddit", id: reply.id, created: (Number(reply.created) || 0) * 1000, reply: reply };
    });
    var inThread = {};
    inThread[parentId] = true;
    var guard = 0;
    var grew = true;
    while (grew && guard < 8) {
      grew = false;
      guard += 1;
      internalPosts(name).forEach(function (post) {
        if (post.parentId && inThread[post.parentId] && !inThread[post.id]) {
          inThread[post.id] = true;
          grew = true;
        }
      });
    }
    var internal = internalPosts(name).filter(function (post) { return post.parentId && inThread[post.parentId]; }).map(function (post) {
      return { source: "app", id: post.id, created: Number(post.createdAt) || 0, post: post };
    });
    var items = reddit.concat(internal);
    if (state.filter === "reddit") items = items.filter(function (item) { return item.source === "reddit"; });
    if (state.filter === "app") items = items.filter(function (item) { return item.source === "app"; });
    items.sort(function (a, b) { return a.created - b.created; });
    return items;
  }

  function chips(name) {
    var chip = function (id, label) {
      return '<button class="cm-chip' + (state.filter === id ? " on" : "") + '" type="button" data-cm="filter" data-filter="' + id + '">' + esc(label) + "</button>";
    };
    var sourceLabel = isForum(name || currentSub()) ? tr("Forum") : tr("Reddit");
    return '<div class="cm-filter-bar" role="tablist">' + chip("all", tr("All")) + chip("reddit", sourceLabel) + chip("app", tr("ViktorychApp")) + "</div>";
  }
  function tabs() {
    var tab = function (id, label) {
      return '<button class="tab' + (state.tab === id ? " on" : "") + '" type="button" data-cm="tab" data-tab="' + id + '"><span>' + esc(label) + "</span></button>";
    };
    return '<div class="tabs" role="tablist">' + tab("top", tr("Top")) + tab("latest", tr("Latest")) + tab("media", tr("Media")) + "</div>";
  }
  function hubTabs() {
    var tab = function (id, label) {
      return '<button class="tab' + (state.hubTab === id ? " on" : "") + '" type="button" data-cm="hub-tab" data-hub="' + id + '"><span>' + esc(label) + "</span></button>";
    };
    return '<div class="tabs" role="tablist">' + tab("explore", tr("Explore")) + tab("joined", tr("Joined")) + "</div>";
  }

  function playUrl(name, post, media, index) {
    var api = String(cfg().api || "").replace(/\/$/, "");
    var role = media.type === "video" ? "video" : "photo";
    if (signedIn() && api && /^t3_[A-Za-z0-9]{1,12}$/.test(post.id || "")) {
      return api + "/tg/social/reddit/" + encodeURIComponent(name) + "/" + encodeURIComponent(post.id) + "/" + role + "/" + index;
    }
    return media.url;
  }
  function mediaFrame(media) {
    var w = Number(media && media.width) || 0;
    var h = Number(media && media.height) || 0;
    var api = window.ViktorychFrame;
    if (!(w > 0 && h > 0) || !api || !api.spec) return { cls: "", attr: ' data-fit="pending"' };
    var spec = api.spec(w, h, api.narrow ? api.narrow() : (window.innerWidth || 390) < 700);
    if (!spec) return { cls: "", attr: ' data-fit="pending"' };
    return {
      cls: " has-ratio" + (spec.clamped ? " is-clamped" : ""),
      attr: ' data-fit="feed" data-mw="' + w + '" data-mh="' + h + '" style="aspect-ratio:' + spec.boxW + " / " + spec.boxH + '"'
    };
  }
  function mediaHtml(name, post, list) {
    if (!list || !list.length) return "";
    var rendered = list.map(function (media, index) {
      if (!media || !media.url) return "";
      var src = playUrl(name, post, media, index);
      var fallback = src !== media.url ? ' data-fallback="' + esc(media.url) + '"' : "";
      var frame = mediaFrame(media);
      if (media.type === "video") return '<video class="cm-reddit-video' + frame.cls + '" controls playsinline src="' + esc(src) + '"' + fallback + frame.attr + "></video>";
      return '<img class="cm-reddit-photo' + frame.cls + '" alt="" loading="lazy" src="' + esc(src) + '"' + fallback + frame.attr + ">";
    }).join("");
    return '<div class="cm-media-wrap">' + rendered + "</div>";
  }

  function face(author) {
    var letter = String(author.displayName || author.handle || "?").slice(0, 1).toUpperCase();
    if (author.avatar && /^https:\/\//.test(author.avatar)) return '<img class="cm-app-ava" alt="" src="' + esc(author.avatar) + '">';
    return '<span class="cm-app-ava cm-app-letter">' + esc(letter) + "</span>";
  }

  function joinBtn(name, joined) {
    return '<button type="button" class="cm-btn-join' + (joined ? " joined" : "") + '" data-cm="join" data-sub="' + esc(name) + '" data-leave-text="' + esc(tr("Leave")) + '"><span>' +
      esc(joined ? tr("Joined") : tr("Join")) + "</span></button>";
  }

  function voteState(sub, id) {
    var bag = state.internal[sub] || {};
    var up = (bag.mine || []).indexOf(id) >= 0;
    var down = !!(state.downvotes && state.downvotes[id]);
    return { up: up, down: down };
  }

  function voteGutter(sub, id, total, v) {
    return '<div class="cm-reddit-vote">' +
      '<button class="cm-vote-arrow up' + (v.up ? " on" : "") + '" type="button" data-cm="like" data-id="' + esc(id) + '" aria-label="' + esc(tr("Like")) + '">' + svgUp + '</button>' +
      '<span class="cm-reddit-score' + (v.up ? " on" : v.down ? " down-on" : "") + '">' + esc(count(total)) + '</span>' +
      '<button class="cm-vote-arrow down' + (v.down ? " on" : "") + '" type="button" data-cm="downvote" data-id="' + esc(id) + '" aria-label="Downvote">' + svgDown + '</button>' +
    '</div>';
  }

  function votePill(sub, id, total, v, forceDisplay) {
    var style = forceDisplay ? ' style="display:inline-flex;"' : "";
    return '<span class="cm-mobile-vote"' + style + '>' +
      '<button class="cm-vote-arrow up' + (v.up ? " on" : "") + '" type="button" data-cm="like" data-id="' + esc(id) + '" aria-label="' + esc(tr("Like")) + '">' + svgUp + '</button>' +
      '<span class="cm-reddit-score' + (v.up ? " on" : v.down ? " down-on" : "") + '">' + esc(count(total)) + '</span>' +
      '<button class="cm-vote-arrow down' + (v.down ? " on" : "") + '" type="button" data-cm="downvote" data-id="' + esc(id) + '" aria-label="Downvote">' + svgDown + '</button>' +
    '</span>';
  }

  /* Mirrored post card — Reddit layout for subreddits, forum layout for Discourse */
  function redditCard(name, post, isThread) {
    var href = "#/communities/" + encodeURIComponent(name) + "/" + encodeURIComponent(post.id);
    var bag = state.internal[name] || {};
    var v = voteState(name, post.id);
    var extra = Number((bag.likes || {})[post.id]) || 0;
    var total = (Number(post.score) || 0) + extra + (v.down ? -1 : 0);
    var cleanTxt = cleanRedditText(post.text);
    var authorClean = cleanAuthor(post.author);
    var forum = isForum(name);
    var redditHref = post.url || ("https://www.reddit.com/r/" + encodeURIComponent(name) + "/comments/" + encodeURIComponent(String(post.id).replace(/^t3_/, "")));
    var sourceHref = forum ? (post.url || forumUrl(name)) : redditHref;
    var sourceLabel = forum ? tr("Open on forum") : tr("Open on Reddit");
    var subLabel = forum ? communityTitle(name) : "r/" + name;
    var authorLabel = forum ? esc(authorClean) : "u/" + esc(authorClean);

    return '<article class="cm-reddit-card' + (isThread ? " cm-thread-focus" : "") + '" data-post="' + esc(post.id) + '">' +
      voteGutter(name, post.id, total, v) +
      '<div class="cm-reddit-main">' +
        '<div class="cm-reddit-byline">' +
          '<span class="cm-reddit-snoo">' + (forum ? svgCommunities : svgSnoo) + '</span>' +
          '<a class="cm-reddit-sub" href="#/communities/' + encodeURIComponent(name) + '">' + esc(subLabel) + '</a>' + forumBadge(name) +
          '<span>•</span>' +
          '<span class="cm-reddit-author">' + authorLabel + '</span>' +
          '<span>•</span>' +
          '<span class="cm-reddit-time">' + esc(timeAgo((Number(post.created) || 0) * 1000)) + '</span>' +
          (post.flair ? '<span class="cm-reddit-flair">' + esc(post.flair) + '</span>' : "") +
        '</div>' +
        '<a class="cm-reddit-title" href="' + href + '">' + esc(post.title || "") + '</a>' +
        (cleanTxt ? '<div class="cm-reddit-text">' + esc(cleanTxt) + '</div>' : "") +
        mediaHtml(name, post, post.media) +
        '<div class="cm-reddit-actions">' +
          votePill(name, post.id, total, v, false) +
          '<a class="cm-reddit-action-btn" href="' + href + '">' + svgComment + '<span>' + esc(count(post.comments)) + " " + esc(tr("Comments")) + '</span></a>' +
          '<button class="cm-reddit-action-btn" type="button" data-cm="share" data-href="' + href + '">' + svgShare + '<span>' + esc(tr("Share")) + '</span></button>' +
          (sourceHref ? '<a class="cm-reddit-action-btn reddit-link" href="' + esc(sourceHref) + '" target="_blank" rel="noopener noreferrer">' + (forum ? svgCommunities : svgSnoo) + '<span>' + esc(sourceLabel) + '</span> ' + svgExternal + '</a>' : "") +
        '</div>' +
      '</div>' +
    '</article>';
  }

  /* ViktorychApp Native Post Card — Same Upvote/Downvote System & Layout */
  function appCard(name, post, isThread) {
    var author = post.author || {};
    var bag = state.internal[name] || {};
    var href = "#/communities/" + encodeURIComponent(name) + "/" + encodeURIComponent(post.id);
    var v = voteState(name, post.id);
    var total = (Number((bag.likes || {})[post.id]) || 0) + (v.down ? -1 : 0);
    var authorHandle = String(author.handle || "");

    return '<article class="cm-reddit-card cm-app-card' + (isThread ? " cm-thread-focus" : "") + '" data-post="' + esc(post.id) + '">' +
      voteGutter(name, post.id, total, v) +
      '<div class="cm-reddit-main">' +
        '<div class="cm-reddit-byline">' +
          face(author) +
          '<span class="cm-app-name">' + esc(author.displayName || author.handle || "") + (author.owner ? " ✓" : "") + '</span>' +
          '<span class="cm-app-handle">@' + esc(authorHandle) + '</span>' +
          '<span>•</span>' +
          '<span class="cm-reddit-time">' + esc(timeAgo(Number(post.createdAt) || Date.now())) + '</span>' +
          '<span class="cm-app-badge">' + esc(tr("Only on ViktorychApp")) + '</span>' +
        '</div>' +
        '<a class="cm-reddit-text" href="' + href + '" style="font-size:15px;text-decoration:none;">' + esc(post.body || "") + '</a>' +
        '<div class="cm-reddit-actions">' +
          votePill(name, post.id, total, v, false) +
          '<a class="cm-reddit-action-btn" href="' + href + '">' + svgComment + '<span>' + esc(tr("Reply")) + '</span></a>' +
          '<button class="cm-reddit-action-btn" type="button" data-cm="share" data-href="' + href + '">' + svgShare + '<span>' + esc(tr("Share")) + '</span></button>' +
          (post.mine || owner() ? '<button class="cm-reddit-action-btn del" type="button" data-cm="delete" data-id="' + esc(post.id) + '" data-sub="' + esc(name) + '">' + svgTrash + '<span>' + esc(tr("Delete")) + '</span></button>' : "") +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function card(name, item) {
    if (item.source === "reddit") return redditCard(name, item.post, false);
    return appCard(name, item.post);
  }

  function currentSub() {
    var parts = (location.hash || "").split("?")[0].replace(/^#\/?/, "").split("/");
    if (parts[0] !== "communities") return "";
    return nameOf(parts[1]);
  }

  /* Communities Hub / Explore Page (X.com 1-to-1 Style) */
  function listPage() {
    var index = state.index;
    if (index && index.communities && index.communities.length && indexStale() && !state.loadingIndex) {
      /* Revalidate in the background so a stale hub cache repairs itself on this visit. */
      state.loadingIndex = true;
      loadIndex(true).finally(function () {
        state.loadingIndex = false;
        render();
      });
    }
    if (!index || !index.communities || !index.communities.length) {
      if (!state.loadingIndex) {
        state.loadingIndex = true;
        loadIndex().finally(function () {
          state.loadingIndex = false;
          render();
        });
      }
      return head(tr("Communities")) + '<div class="reply-empty">' + esc(tr("Loading")) + "</div>";
    }

    var addToggle = owner() ? '<button class="cm-icon-btn" type="button" data-cm="toggle-add" aria-label="' + esc(tr("Add community")) + '">' + svgPlus + '</button>' : "";
    var addBar = (owner() && state.showAdd)
      ? '<form class="cm-add-bar" data-cm="add"><input name="name" placeholder="r/technology" aria-label="' + esc(tr("Add community")) + '"><button type="submit">' + esc(tr("Add")) + '</button></form>'
      : "";

    var q = String(state.search || "").toLowerCase().trim();
    var list = (index.communities || []).filter(function (row) {
      if (!q) return true;
      var nameMatch = String(row.name || "").toLowerCase().indexOf(q) >= 0;
      var titleMatch = String(row.title || "").toLowerCase().indexOf(q) >= 0;
      var aboutMatch = String(row.about || "").toLowerCase().indexOf(q) >= 0;
      return nameMatch || titleMatch || aboutMatch;
    });

    if (state.hubTab === "joined") {
      list = list.filter(function (row) {
        var bag = state.internal[row.name];
        return bag && bag.joined;
      });
    }

    var searchBar = '<div class="cm-search-wrap">' +
      '<div class="cm-search-box">' +
        '<span class="cm-search-svg">' + svgSearch + '</span>' +
        '<input type="text" class="cm-search-input" placeholder="' + esc(tr("Search Communities")) + '" value="' + esc(state.search) + '" data-cm="search-input" aria-label="' + esc(tr("Search Communities")) + '">' +
        (state.search ? '<button type="button" class="cm-search-clear" data-cm="clear-search">✕</button>' : "") +
      '</div></div>';

    var spotlightHtml = "";
    if (state.hubTab === "explore" && !state.search && list.length > 0) {
      var top = list[0];
      var topJoined = state.internal[top.name] && state.internal[top.name].joined;
      spotlightHtml = '<div class="cm-spotlight">' +
        '<div class="cm-spotlight-banner">' +
          (top.banner ? '<img src="' + esc(top.banner) + '" alt="" style="width:100%;height:100%;object-fit:cover;">' : "") +
          '<span class="cm-spotlight-badge">' + esc(tr("Explore")) + '</span>' +
        '</div>' +
        '<div class="cm-spotlight-body">' +
          '<div class="cm-spotlight-top">' +
            (top.icon ? '<img class="cm-spotlight-avatar" src="' + esc(top.icon) + '" alt="">' : '<div class="cm-spotlight-avatar">' + (isForum(top.name) ? svgCommunities : svgSnoo) + '</div>') +
            joinBtn(top.name, topJoined) +
          '</div>' +
          '<a href="#/communities/' + encodeURIComponent(top.name) + '" style="text-decoration:none;color:inherit;">' +
            '<h2 class="cm-spotlight-title">' + (isForum(top.name) ? esc(top.title || top.name) : "r/" + esc(top.name)) + forumBadge(top.name) + '</h2>' +
            '<p class="cm-spotlight-desc">' + esc(top.about || (top.title || ("r/" + top.name))) + '</p>' +
            '<div class="cm-facepile-wrap">' +
              '<div class="cm-facepile"><span class="cm-face-dot d1"></span><span class="cm-face-dot d2"></span><span class="cm-face-dot d3"></span></div>' +
              '<span>' + esc(count(top.subscribers || 2800000)) + ' ' + esc(tr("Members")) + '</span>' +
            '</div>' +
          '</a>' +
        '</div>' +
      '</div>';
    }

    var cards = list.map(function (row) {
      var isJoined = state.internal[row.name] && state.internal[row.name].joined;
      var bannerStyle = row.banner ? ' style="background-image:url(\'' + esc(row.banner) + '\');background-size:cover;background-position:center;"' : "";
      return '<div class="cm-card">' +
        '<a class="cm-card-cover"' + bannerStyle + ' href="#/communities/' + encodeURIComponent(row.name) + '"></a>' +
        '<div class="cm-card-body">' +
          '<div class="cm-card-row">' +
            (row.icon ? '<img class="cm-card-avatar" alt="" src="' + esc(row.icon) + '">' : '<div class="cm-card-avatar">' + (isForum(row.name) ? svgCommunities : svgSnoo) + '</div>') +
            joinBtn(row.name, isJoined) +
          '</div>' +
          '<a href="#/communities/' + encodeURIComponent(row.name) + '" style="text-decoration:none;color:inherit;">' +
            '<h3 class="cm-card-title">' + (isForum(row.name) ? esc(row.title || row.name) : "r/" + esc(row.name)) + forumBadge(row.name) + '</h3>' +
            '<p class="cm-card-desc">' + esc(row.about || row.title || ("r/" + row.name)) + '</p>' +
            '<div class="cm-facepile-wrap">' +
              '<div class="cm-facepile"><span class="cm-face-dot d1"></span><span class="cm-face-dot d2"></span><span class="cm-face-dot d3"></span></div>' +
              '<span>' + esc(count(row.subscribers || 100000)) + ' ' + esc(tr("Members")) + '</span>' +
            '</div>' +
          '</a>' +
        '</div>' +
      '</div>';
    }).join("");

    var sectionTitle = state.hubTab === "joined" ? tr("Your Communities") : tr("Discover Communities");
    var emptyHtml = state.hubTab === "joined"
      ? '<div class="empty"><h2>' + esc(tr("No communities yet.")) + '</h2><p>' + esc(tr("Search Communities")) + '</p></div>'
      : '<div class="empty"><h2>' + esc(tr("That community wasn't found.")) + '</h2></div>';

    return head(tr("Communities"), null, addToggle) +
      addBar +
      hubTabs() +
      searchBar +
      spotlightHtml +
      '<div class="cm-section-head">' + esc(sectionTitle) + '</div>' +
      (cards ? '<div class="cm-card-grid">' + cards + '</div>' : emptyHtml);
  }

  /* Single Community Feed Page (X.com 1-to-1 Clone) */
  function communityPage(route) {
    var name = nameOf(route.sub);
    if (!name) return head(tr("Communities"), "#/communities") + '<div class="empty"><h2>' + esc(tr("That community wasn't found.")) + "</h2></div>";
    var doc = state.docs[name];
    if (!doc || state.loading[name]) {
      if (!state.loading[name]) {
        state.loading[name] = true;
        Promise.all([
          loadDoc(name).catch(function () { return null; }),
          loadInternal(name).catch(function () { return null; })
        ]).finally(function () {
          state.loading[name] = false;
          render();
        });
      }
      return head(communityLabel(name), "#/communities") + '<div class="reply-empty">' + esc(tr("Loading")) + "</div>";
    }

    if (doc.missing) {
      return head(communityLabel(name), "#/communities") +
        '<div class="empty"><h2>' + esc(tr("That community wasn't found.")) + '</h2>' +
        '<button class="retry" type="button" data-cm="retry" data-sub="' + esc(name) + '">' + esc(tr("Retry")) + '</button></div>';
    }

    var bag = state.internal[name];
    var joined = bag && bag.joined;
    var forum = isForum(name);
    var title = communityTitle(name);
    var sourceUrl = forumUrl(name);
    var host = forumHost(name);
    var bannerImg = doc.banner
      ? '<img class="cm-hero-banner" alt="" src="' + esc(doc.banner) + '">'
      : '<div class="cm-hero-banner"></div>';

    var avatarImg = doc.icon
      ? '<img class="cm-hero-avatar" alt="" src="' + esc(doc.icon) + '">'
      : '<div class="cm-hero-avatar">' + (forum ? svgCommunities : svgSnoo) + '</div>';

    var shareBtn = '<button class="cm-icon-btn" type="button" data-cm="share" aria-label="' + esc(tr("Share")) + '">' + svgShare + '</button>';
    var removeBtn = owner() ? '<button class="cm-icon-btn" type="button" data-cm="remove" data-sub="' + esc(name) + '" aria-label="' + esc(tr("Remove")) + '">' + svgTrash + '</button>' : "";

    var rulesList = (doc.rules || []).map(function (rule, idx) {
      return '<div class="cm-rule-item"><span class="cm-rule-num">' + (idx + 1) + '</span><div><div class="cm-rule-title">' + esc(rule.title || "") + '</div><div>' + esc(rule.text || "") + '</div></div></div>';
    }).join("");

    var rulesAccordion = rulesList
      ? '<details class="cm-rules-box"><summary class="cm-rules-summary"><span>' + esc(tr("Community rules")) + '</span><span>▾</span></summary><div class="cm-rules-content">' + rulesList + '</div></details>'
      : "";

    var composeLabel = forum
      ? tr("Post into {name}", { name: title })
      : tr("Post into r/{name}", { name: name });
    var memberLabel = forum ? tr("Members") : tr("Reddit subscribers");
    var footerNote = forum ? tr("Nothing is sent to the forum.") : tr("Nothing is sent to Reddit.");
    var composer = signedIn()
      ? '<form class="cm-composer" data-cm="inline-post" data-sub="' + esc(name) + '">' +
          face(session().account || {}) +
          '<div class="cm-composer-main">' +
            '<textarea class="cm-composer-area" name="text" placeholder="' + esc(composeLabel) + '" aria-label="' + esc(composeLabel) + '"></textarea>' +
            '<div class="cm-composer-bottom">' +
              '<button type="submit" class="cm-composer-btn">' + esc(tr("Post")) + '</button>' +
            '</div>' +
          '</div>' +
        '</form>'
      : '<div class="cm-footer-note"><p>' + esc(tr("Sign in to post here.")) + '</p></div>';

    var items = (bag && bag.locked) ? [] : feedItems(name, doc);
    var empty = bag && bag.locked
      ? '<div class="empty"><h2>' + esc(tr("Only members can see posts in this community.")) + '</h2></div>'
      : state.filter === "app" && !signedIn()
      ? '<div class="empty"><p>' + esc(tr("Sign in to post here.")) + "</p></div>"
      : (items.length ? "" : '<div class="empty"><h2>' + esc(tr("No posts yet")) + "</h2></div>");

    return head(communityLabel(name), "#/communities", shareBtn) +
      '<section class="cm-hero">' +
        bannerImg +
        '<div class="cm-hero-body">' +
          '<div class="cm-hero-bar">' +
            avatarImg +
            '<div class="cm-hero-actions">' +
              shareBtn +
              removeBtn +
              joinBtn(name, joined) +
              (signedIn() && joined ? '<button type="button" class="cm-btn-join" data-cm="home-feed" data-sub="' + esc(name) + '" aria-pressed="' + ((bag && bag.showHome === false) ? "false" : "true") + '"><span>' + esc((bag && bag.showHome === false) ? tr("Hidden on Home") : tr("Show in Home")) + '</span></button><button type="button" class="cm-btn-join" data-cm="mute-community" data-sub="' + esc(name) + '"><span>' + esc((bag && bag.muted) ? tr("Unmute community") : tr("Mute community")) + '</span></button>' : "") +
              (owner() ? '<button type="button" class="cm-btn-join" data-cm="visibility" data-sub="' + esc(name) + '" data-vis="' + esc((bag && bag.visibility) || "public") + '"><span>' + esc((bag && bag.visibility) === "private" ? tr("Private community") : (bag && bag.visibility) === "restricted" ? tr("Restricted community") : tr("Public community")) + '</span></button>' : "") +
            '</div>' +
          '</div>' +
          '<h1 class="cm-hero-title">' + (forum ? esc(title) : "r/" + esc(name)) + forumBadge(name) + '</h1>' +
          '<div class="cm-hero-meta">' +
            '<div class="cm-facepile"><span class="cm-face-dot d1"></span><span class="cm-face-dot d2"></span><span class="cm-face-dot d3"></span></div>' +
            '<span><b>' + esc(count(doc.subscribers || (forum ? 0 : 2800000))) + '</b> ' + esc(memberLabel) + '</span>' +
            (host ? '<span class="cm-sep">·</span><a class="cm-forum-link" href="' + esc(sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(host) + ' ' + svgExternal + '</a>' : "") +
            (bag && bag.members ? '<span class="cm-sep">·</span><span><b>' + esc(count(bag.members)) + '</b> ' + esc(tr("ViktorychApp members")) + '</span>' : "") +
          '</div>' +
          (doc.about ? '<p class="cm-hero-about">' + esc(doc.about) + '</p>' : "") +
          rulesAccordion +
        '</div>' +
      '</section>' +
      tabs() +
      chips(name) +
      composer +
      empty +
      items.map(function (item) { return card(name, item); }).join("") +
      '<p class="cm-footer-note">' + esc(footerNote) + '</p>';
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

  /* Single Thread / Post View (Reddit Comments Tree + X.com Theme) */
  function threadPage(route) {
    var name = nameOf(route.sub);
    var id = decodeURIComponent(route.post || "");
    var doc = state.docs[name];
    if (!doc || state.loading[name]) {
      if (!state.loading[name]) {
        state.loading[name] = true;
        Promise.all([
          loadDoc(name).catch(function () { return null; }),
          loadInternal(name).catch(function () { return null; })
        ]).finally(function () {
          state.loading[name] = false;
          render();
        });
      }
      return head(tr("Communities"), "#/communities/" + name) + '<div class="reply-empty">' + esc(tr("Loading")) + "</div>";
    }
    if (doc.missing) {
      return head(communityLabel(name), "#/communities") +
        '<div class="empty"><h2>' + esc(tr("That community wasn't found.")) + '</h2>' +
        '<button class="retry" type="button" data-cm="retry" data-sub="' + esc(name) + '">' + esc(tr("Retry")) + '</button></div>';
    }
    var bag = state.internal[name] || { posts: [], likes: {}, mine: [] };
    var internal = (bag.posts || []).filter(function (post) { return post.id === id; })[0];
    var reddit = findReddit(doc, id);
    var focus = "";
    if (internal && signedIn()) focus = appCard(name, internal, true);
    else if (reddit && reddit.kind === "post") focus = redditCard(name, reddit.post, true);
    else if (reddit && reddit.kind === "reply") {
      focus = '<article class="cm-reddit-comment">' +
        '<div class="cm-comment-gutter"><span class="cm-comment-snoo">' + (isForum(name) ? svgCommunities : svgSnoo) + '</span><span class="cm-comment-line"></span></div>' +
        '<div class="cm-comment-body">' +
          '<div class="cm-comment-byline"><span class="cm-comment-author">' + (isForum(name) ? "" : "u/") + esc(cleanAuthor(reddit.reply.author)) + '</span><span>•</span><span>' + esc(timeAgo((Number(reddit.reply.created) || 0) * 1000)) + '</span></div>' +
          '<div class="cm-comment-text">' + esc(cleanRedditText(reddit.reply.text)) + '</div>' +
        '</div>' +
      '</article>';
    }

    if (!focus) return head(communityLabel(name), "#/communities/" + name) + '<div class="empty"><h2>' + esc(tr("That community wasn't found.")) + "</h2></div>";

    /* A topic thread loads its own comment page; a reply focus reuses whatever
       the topic file already brought in. */
    var isTopic = !!(reddit && reddit.kind === "post" && !(internal && signedIn()));
    var comments = state.comments[commentKey(name, id)];
    var commentsLoading = isTopic && isForum(name) && !comments;
    if (commentsLoading) {
      loadComments(name, id).then(function () {
        var current = (location.hash || "").split("?")[0];
        if (current.indexOf("/communities/" + name + "/" + id) >= 0) render();
      });
    }
    var totalComments = isTopic ? (Number(reddit.post.comments) || 0) : 0;

    var kidItems = repliesFor(name, id, doc);
    var kids = kidItems.map(function (item) {
      if (item.source === "reddit") {
        var replyScore = Number(item.reply.score) || 0;
        var rV = voteState(name, item.reply.id);
        var rTotal = replyScore + (rV.up ? 1 : 0) + (rV.down ? -1 : 0);
        return '<article class="cm-reddit-comment reply-card" data-post="' + esc(item.reply.id) + '">' +
          '<div class="cm-comment-gutter"><span class="cm-comment-snoo">' + (isForum(name) ? svgCommunities : svgSnoo) + '</span><span class="cm-comment-line"></span></div>' +
          '<div class="cm-comment-body">' +
            '<div class="cm-comment-byline"><span class="cm-comment-author">' + (isForum(name) ? "" : "u/") + esc(cleanAuthor(item.reply.author)) + '</span><span>•</span><span>' + esc(timeAgo(item.created)) + '</span></div>' +
            '<div class="cm-comment-text">' + esc(cleanRedditText(item.reply.text)) + '</div>' +
            '<div class="cm-comment-actions">' +
              votePill(name, item.reply.id, rTotal, rV, true) +
              '<button class="cm-reddit-action-btn" type="button" data-cm="focus-reply">' + svgComment + '<span>' + esc(tr("Reply")) + '</span></button>' +
            '</div>' +
          '</div>' +
        '</article>';
      }
      var aAuthor = item.post.author || {};
      var aAuthorHandle = String(aAuthor.handle || "");
      var aV = voteState(name, item.post.id);
      var aBag = state.internal[name] || {};
      var aTotal = (Number((aBag.likes || {})[item.post.id]) || 0) + (aV.down ? -1 : 0);
      return '<article class="cm-reddit-comment reply-card cm-app-reply" data-post="' + esc(item.post.id) + '">' +
        '<div class="cm-comment-gutter">' +
          face(aAuthor) +
          '<span class="cm-comment-line"></span>' +
        '</div>' +
        '<div class="cm-comment-body">' +
          '<div class="cm-comment-byline">' +
            '<span class="cm-app-name">' + esc(aAuthor.displayName || aAuthor.handle || "") + (aAuthor.owner ? " ✓" : "") + '</span>' +
            '<span class="cm-app-handle">@' + esc(aAuthorHandle) + '</span>' +
            '<span>•</span>' +
            '<span class="cm-reddit-time">' + esc(timeAgo(Number(item.post.createdAt) || item.created)) + '</span>' +
            '<span class="cm-app-badge">' + esc(tr("Only on ViktorychApp")) + '</span>' +
          '</div>' +
          '<div class="cm-comment-text">' + esc(item.post.body || "") + '</div>' +
          '<div class="cm-comment-actions">' +
            votePill(name, item.post.id, aTotal, aV, true) +
            '<button class="cm-reddit-action-btn" type="button" data-cm="focus-reply">' + svgComment + '<span>' + esc(tr("Reply")) + '</span></button>' +
            '<button class="cm-reddit-action-btn" type="button" data-cm="share" data-href="#/communities/' + encodeURIComponent(name) + '/' + encodeURIComponent(id) + '">' + svgShare + '</button>' +
            (item.post.mine || owner() ? '<button class="cm-reddit-action-btn del" type="button" data-cm="delete" data-id="' + esc(item.post.id) + '" data-sub="' + esc(name) + '">' + svgTrash + '</button>' : "") +
          '</div>' +
        '</div>' +
      '</article>';
    }).join("");

    var box = signedIn()
      ? '<form class="cm-composer" data-cm="reply" data-sub="' + esc(name) + '" data-parent="' + esc(id) + '">' +
          face(session().account || {}) +
          '<div class="cm-composer-main">' +
            '<textarea class="cm-composer-area" name="text" aria-label="' + esc(tr("Post your reply")) + '" placeholder="' + esc(tr("Post your reply")) + '"></textarea>' +
            '<div class="cm-composer-bottom">' +
              '<button type="submit" class="cm-composer-btn">' + esc(tr("Reply")) + '</button>' +
            '</div>' +
          '</div>' +
        '</form>'
      : '<div class="cm-footer-note"><p>' + esc(tr("Sign in to post here.")) + '</p></div>';

    var headCount = totalComments;
    if (isTopic && comments && comments.complete && !kidItems.length) headCount = 0;
    var commentsHead = '<div class="cm-thread-replies-head">' + esc(tr("Comments")) +
      (headCount ? ' <span class="cm-thread-count">' + esc(count(headCount)) + '</span>' : "") + '</div>';
    var commentsNote = "";
    var commentsBody = kids;
    if (isTopic && commentsLoading) {
      commentsBody = '<div class="reply-empty">' + esc(tr("Loading comments…")) + '</div>';
    } else if (isTopic && comments && comments.missing && !kidItems.length) {
      commentsBody = '<div class="reply-empty"><p>' + esc(tr("Couldn't load the comments.")) + '</p>' +
        '<button class="retry" type="button" data-cm="retry-comments" data-sub="' + esc(name) + '" data-post="' + esc(id) + '">' + esc(tr("Retry")) + '</button></div>';
    } else if (isTopic && !kidItems.length) {
      commentsBody = '<div class="reply-empty">' + esc(tr("No comments yet.")) + '</div>';
    } else if (isTopic && comments && comments.complete === false && kidItems.length) {
      var shownTotal = Number(comments.total) || totalComments || kidItems.length;
      commentsNote = '<p class="cm-thread-note">' + esc(tr("Showing {shown} of {total}", { shown: kidItems.length, total: shownTotal })) + '</p>';
    }

    return head(communityLabel(name), "#/communities/" + name) +
      focus +
      chips(name) +
      commentsHead +
      commentsNote +
      commentsBody +
      box;
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

  /* Global Click & Submit Event Handlers */
  document.addEventListener("click", function (event) {
    var el = event.target.closest("[data-cm]");
    if (!el) return;
    var act = el.dataset.cm;

    if (act === "hub-tab") {
      state.hubTab = el.dataset.hub || "explore";
      render();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
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
    if (act === "toggle-add") {
      state.showAdd = !state.showAdd;
      render();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (act === "clear-search") {
      state.search = "";
      render();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (act === "share") {
      event.preventDefault();
      event.stopPropagation();
      var url = el.dataset.href ? (location.origin + location.pathname + el.dataset.href) : location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { toast(tr("Copied to clipboard")); });
      } else {
        toast(tr("Copied to clipboard"));
      }
      return;
    }
    if (act === "downvote") {
      event.preventDefault();
      event.stopPropagation();
      if (!signedIn()) { toast(tr("Sign in to post here.")); return; }
      var id = el.dataset.id;
      var sub = currentSub();
      state.downvotes = state.downvotes || {};
      var wasDown = !!state.downvotes[id];
      var bag = state.internal[sub] || {};
      var wasUp = (bag.mine || []).indexOf(id) >= 0;
      if (wasUp) {
        call("/v1/communities/" + encodeURIComponent(sub) + "/likes", { method: "DELETE", body: { itemId: id } }).then(function () {
          delete state.internal[sub];
          loadInternal(sub).then(render);
        });
      }
      if (wasDown) {
        delete state.downvotes[id];
      } else {
        state.downvotes[id] = true;
      }
      setDownvotes(state.downvotes);
      render();
      return;
    }
    if (act === "focus-reply") {
      event.preventDefault();
      event.stopPropagation();
      var area = document.querySelector(".cm-composer-area");
      if (area) { area.focus(); area.scrollIntoView({ behavior: "smooth" }); }
      return;
    }
    if (act === "like") {
      event.preventDefault();
      event.stopPropagation();
      if (!signedIn()) { toast(tr("Sign in to post here.")); return; }
      var id = el.dataset.id;
      var sub = currentSub();
      if (state.downvotes && state.downvotes[id]) {
        delete state.downvotes[id];
        setDownvotes(state.downvotes);
      }
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
    if (act === "retry-comments") {
      event.preventDefault();
      event.stopPropagation();
      var cSub = el.dataset.sub;
      var cPost = el.dataset.post;
      if (cSub && cPost) {
        delete state.comments[commentKey(cSub, cPost)];
        loadComments(cSub, cPost, true).finally(render);
      }
      return;
    }
    if (act === "retry") {
      event.preventDefault();
      event.stopPropagation();
      var subRetry = el.dataset.sub;
      if (subRetry) {
        delete state.docs[subRetry];
        state.loading[subRetry] = false;
        loadDoc(subRetry).finally(render);
      } else {
        state.index = null;
        loadIndex().finally(render);
      }
      return;
    }
    if (act === "home-feed" || act === "mute-community") {
      event.preventDefault();
      event.stopPropagation();
      if (!signedIn()) { toast(tr("Sign in to post here.")); return; }
      var prefName = el.dataset.sub;
      var prefBag = state.internal[prefName] || {};
      var prefBody = act === "mute-community" ? { muted: !prefBag.muted } : { showHome: prefBag.showHome === false };
      call("/v1/communities/" + encodeURIComponent(prefName) + "/feed", { method: "POST", body: prefBody }).then(function () {
        delete state.internal[prefName];
        loadInternal(prefName).then(render);
      });
      return;
    }
    if (act === "visibility") {
      event.preventDefault();
      event.stopPropagation();
      var visName = el.dataset.sub;
      var order = ["public", "restricted", "private"];
      var current = el.dataset.vis || "public";
      var nextVis = order[(order.indexOf(current) + 1) % order.length];
      call("/v1/communities/" + encodeURIComponent(visName) + "/visibility", { method: "POST", body: { visibility: nextVis } }).then(function () {
        delete state.internal[visName];
        loadInternal(visName).then(render);
      });
      return;
    }
    if (act === "join") {
      event.preventDefault();
      event.stopPropagation();
      if (!signedIn()) { toast(tr("Sign in to post here.")); return; }
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

  document.addEventListener("input", function (event) {
    var el = event.target.closest("[data-cm='search-input']");
    if (!el) return;
    state.search = el.value;
    var container = document.querySelector(".cm-card-grid");
    var clearBtn = document.querySelector(".cm-search-clear");
    if (clearBtn) clearBtn.hidden = !state.search;
    render();
  }, true);

  document.addEventListener("submit", function (event) {
    var form = event.target.closest("[data-cm]");
    if (!form) return;
    event.preventDefault();
    event.stopPropagation();

    if (form.dataset.cm === "add") {
      var input = form.querySelector("input");
      var name = nameOf(input && input.value);
      if (!name) { toast(tr("That community wasn't found.")); return; }
      call("/v1/owner/communities", { method: "POST", body: { name: name } }).then(function (body) {
        if (!body || !body.community) { toast(tr("Couldn't post.")); return; }
        toast(tr("New posts show up after the next sync."));
        state.showAdd = false;
        render();
      });
      return;
    }
    if (form.dataset.cm === "inline-post") {
      var area = form.querySelector("textarea");
      var text = area ? area.value.trim() : "";
      if (!text) return;
      var sub = form.dataset.sub;
      call("/v1/communities/" + encodeURIComponent(sub) + "/posts", { method: "POST", body: { text: text } }).then(function (body) {
        if (!body || !body.post) { toast(tr("Couldn't post.")); return; }
        area.value = "";
        delete state.internal[sub];
        loadInternal(sub).then(render);
      });
      return;
    }
    if (form.dataset.cm === "reply") {
      var replyArea = form.querySelector("textarea");
      var replyText = replyArea ? replyArea.value.trim() : "";
      if (!replyText) return;
      call("/v1/communities/" + encodeURIComponent(form.dataset.sub) + "/posts", {
        method: "POST",
        body: { text: replyText, parentId: form.dataset.parent }
      }).then(function (body) {
        if (!body || !body.post) { toast(tr("Couldn't post.")); return; }
        replyArea.value = "";
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

  function rememberCommunities() {
    var local = window.ViktorychLocal;
    if (!local || !local.saveDoc) return;
    var rows = ((state.index && state.index.communities) || []).slice(0, 40).map(function (row) {
      return { name: row.name || "", title: row.title || row.name || "" };
    });
    if (rows.length) local.saveDoc("feeds", "communities", { communities: rows });
    Object.keys(state.docs || {}).forEach(function (name) {
      var doc = state.docs[name];
      if (!doc || !Array.isArray(doc.posts)) return;
      var items = doc.posts.map(function (post) {
        var created = Number(post && post.created) || 0;
        return {
          id: String((post && post.id) || ""),
          platform: "reddit",
          date: created ? new Date(created * 1000).toISOString() : "",
          text: (post && (post.title || post.text)) || ""
        };
      }).filter(function (post) { return post.id; });
      var ordered = local.orderPosts && window.FeedOrder ? local.orderPosts(items, window.FeedOrder.compare, window.FeedOrder.key) : items;
      local.saveDoc("feeds", "community:" + name, { tab: "community:" + name, order: "utc", posts: ordered.slice(0, 24) });
    });
  }

  window.ViktorychCommunities = {
    page: page,
    takeCompose: takeCompose,
    label: communityLabel,
    pullNotes: pullNotes,
    invalidate: function (name) {
      if (!name) return;
      delete state.internal[name];
      if (currentSub() === name) loadInternal(name).then(function () {
        if (window.ViktorychCommunities.requestRender) window.ViktorychCommunities.requestRender();
      });
    },
    requestRender: null,
    toast: null,
    hidden: null,
    note: null,
    snapshot: rememberCommunities
  };
})();
