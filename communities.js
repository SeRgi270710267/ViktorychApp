/* Communities: mirrored subreddits & Discourse forums and the posts signed-in people write here. */
(function () {
  var state = {
    index: null,
    docs: {},
    internal: {},
    tab: "latest",
    filter: "all",
    category: "all",
    hubTab: "explore",
    search: "",
    showAdd: false,
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
  function isDiscourse(docOrRow) {
    if (!docOrRow) return false;
    var name = (docOrRow.name || "").toLowerCase();
    return docOrRow.type === "discourse" || docOrRow.source === "discourse" || docOrRow.source === "flarum" || name === "grapheneos";
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
    s = s.replace(/^\/?u\//i, "");
    s = s.trim();
    return s || "reddit";
  }

  function cleanRedditText(raw) {
    if (!raw) return "";
    var s = String(raw);
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

  function cleanDiscourseExcerpt(raw) {
    if (!raw) return "";
    var s = String(raw).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (s.length > 150) s = s.slice(0, 150).trim() + "…";
    return s;
  }

  function sanitizeDiscourseHtml(raw) {
    if (!raw) return "";
    var str = String(raw).trim();
    if (!/<[a-z][\s\S]*>/i.test(str)) {
      return "<p>" + esc(str) + "</p>";
    }
    // Remove unsafe script/iframe/style/form elements
    str = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
             .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
             .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
             .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, "");
    // Remove inline event handlers
    str = str.replace(/\son\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, "");
    // Remove javascript: links
    str = str.replace(/\shref\s*=\s*(?:['"]\s*javascript:[^'"]*['"]|javascript:[^\s>]+)/gi, ' href="#"');
    // Ensure all links open securely in external window
    str = str.replace(/<a\s+(?:[^>]*?\s+)?href=/gi, '<a target="_blank" rel="noopener noreferrer" href=');
    return str;
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
  var svgDiscourse = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.1 2C6.5 2 2 6.5 2 12.1c0 2.2.7 4.3 2 6L2.1 22.9c-.2.5.3 1 1 1l4.9-1.9c1.7 1.3 3.8 2 6.1 2 5.6 0 10.1-4.5 10.1-10.1C22.2 6.5 17.7 2 12.1 2zm0 18.2c-1.9 0-3.7-.6-5.2-1.7l-.4-.3-3.6 1.4 1.4-3.6-.3-.4c-1.1-1.5-1.7-3.3-1.7-5.2 0-4.6 3.7-8.3 8.3-8.3s8.3 3.7 8.3 8.3c0 4.6-3.7 8.3-8.3 8.3z"/><circle cx="12.1" cy="12.1" r="3.2"/></svg>';
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
  var svgExternal = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 6H5.5C4.12 6 3 7.12 3 8.5v10C3 19.88 4.12 21 5.5 21h10c1.38 0 2.5-1.12 2.5-2.5V14h-2v4.5c0 .28.22.5.5.5h-10a.5.5 0 0 1-.5-.5v-10c0-.28.22-.5.5-.5H10V6zm4 0V4h7v7h-2V7.41l-7.29 7.3-1.42-1.42L17.58 6H14z"/></svg>';
  var svgCommunities = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm6 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zM4 18v-1.2C4 14.6 6.4 13 9 13s5 1.6 5 3.8V18H4zm10.5 0v-1.1c0-.7-.2-1.4-.6-2 .9-.4 2-.6 3.1-.6 2.4 0 5 1.4 5 3.5V18h-7.5z"/></svg>';
  var svgSpark = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2l1.7 5.4 5.5 1.5-5.5 1.6L12 16.2l-1.7-5.5L4.8 9.1l5.5-1.5L12 2.2zM18.2 13.2l.8 2.4 2.5.7-2.5.7-.8 2.5-.8-2.5-2.4-.7 2.4-.7.8-2.4z"/></svg>';
  var svgPin = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>';
  var svgReply = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>';
  var svgViews = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>';

  var BUILTIN_COMMUNITIES = [
    {
      name: "grapheneos",
      title: "GrapheneOS Discussion",
      type: "discourse",
      subscribers: 35000,
      icon: "https://discuss.grapheneos.org/assets/favicon-snu6s6q2.png",
      banner: "https://grapheneos.org/opengraph.png",
      about: "The official discussion forum for GrapheneOS, a privacy and security focused mobile OS with Android app compatibility."
    },
    {
      name: "teslamotors",
      title: "Tesla Motors",
      subscribers: 2840000,
      icon: ""
    }
  ];

  function loadIndex() {
    if (state.index) return Promise.resolve(state.index);
    return fetch("data/communities/index.json", { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("index");
      return res.json();
    }).then(function (doc) {
      var list = (doc && Array.isArray(doc.communities)) ? doc.communities.slice() : [];
      BUILTIN_COMMUNITIES.forEach(function (b) {
        var existing = list.find(function (c) { return c && c.name === b.name; });
        if (!existing) {
          list.push(b);
        } else if (b.type && !existing.type) {
          existing.type = b.type;
          if (!existing.banner) existing.banner = b.banner;
          if (!existing.about) existing.about = b.about;
        }
      });
      state.index = { communities: list };
      return state.index;
    }).catch(function () {
      state.index = { communities: BUILTIN_COMMUNITIES.slice() };
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
    if (item.source === "reddit" || item.source === "discourse") return Number(item.score) || 0;
    var bag = state.internal[item.community] || {};
    return Number((bag.likes || {})[item.id]) || 0;
  }

  function feedItems(name, doc) {
    var items = [];
    if (isDiscourse(doc)) {
      items = (doc.posts || []).filter(function (post) {
        return post && !hidden(post.author, (post.title || "") + " " + (post.text || ""), "forum");
      }).map(function (post) {
        return {
          source: "discourse",
          community: name,
          id: post.id,
          created: (Number(post.created) || 0) * 1000,
          lastPostedAt: (Number(post.lastPostedAt || post.created) || 0) * 1000,
          score: Number(post.score || 0),
          post: post
        };
      });
      if (state.category && state.category !== "all") {
        items = items.filter(function (item) {
          var cName = (item.post.category || "").toLowerCase();
          var target = state.category.toLowerCase();
          var catMatch = cName === target;
          var tagMatch = (item.post.tags || []).some(function (t) { return String(t).toLowerCase() === target; });
          return catMatch || tagMatch;
        });
      }
    } else {
      items = redditPosts(doc).map(function (post) {
        return { source: "reddit", community: name, id: post.id, created: (Number(post.created) || 0) * 1000, score: post.score, post: post };
      });
    }

    var internal = internalPosts(name).filter(function (post) { return !post.parentId; }).map(function (post) {
      return { source: "app", community: name, id: post.id, created: Number(post.createdAt) || 0, score: 0, post: post };
    });

    items = items.concat(internal);
    if (state.filter === "reddit") items = items.filter(function (item) { return item.source === "reddit"; });
    if (state.filter === "discourse") items = items.filter(function (item) { return item.source === "discourse"; });
    if (state.filter === "app") items = items.filter(function (item) { return item.source === "app"; });
    if (state.tab === "media") items = items.filter(function (item) { return item.source === "reddit" && item.post.media && item.post.media.length; });

    items.sort(function (a, b) {
      if (a.post && a.post.pinned && !(b.post && b.post.pinned)) return -1;
      if (b.post && b.post.pinned && !(a.post && a.post.pinned)) return 1;

      if (state.tab === "latest") {
        var aTime = a.lastPostedAt || a.created;
        var bTime = b.lastPostedAt || b.created;
        return bTime - aTime;
      }
      var delta = scoreOf(b) - scoreOf(a);
      return delta || (b.created - a.created);
    });
    return items;
  }

  function repliesFor(name, parentId, doc) {
    var items = [];
    if (isDiscourse(doc)) {
      (doc.posts || []).forEach(function (post) {
        if (String(post.id) === String(parentId)) {
          (post.replies || []).forEach(function (reply) {
            if (!hidden(reply.author, reply.text, "forum")) {
              items.push({
                source: "discourse",
                id: reply.id,
                created: (Number(reply.created) || 0) * 1000,
                reply: reply
              });
            }
          });
        }
      });
    } else {
      (doc.posts || []).forEach(function (post) {
        (post.replies || []).forEach(function (reply) {
          if (reply.parent === parentId && !hidden(reply.author, reply.text, "reddit")) {
            items.push({ source: "reddit", id: reply.id, created: (Number(reply.created) || 0) * 1000, reply: reply });
          }
        });
      });
    }
    var internal = internalPosts(name).filter(function (post) { return String(post.parentId) === String(parentId); }).map(function (post) {
      return { source: "app", id: post.id, created: Number(post.createdAt) || 0, post: post };
    });
    items = items.concat(internal);
    if (state.filter === "reddit") items = items.filter(function (item) { return item.source === "reddit"; });
    if (state.filter === "discourse") items = items.filter(function (item) { return item.source === "discourse"; });
    if (state.filter === "app") items = items.filter(function (item) { return item.source === "app"; });
    items.sort(function (a, b) { return a.created - b.created; });
    return items;
  }

  function chips(doc) {
    var isDisc = isDiscourse(doc);
    var sourceId = isDisc ? "discourse" : "reddit";
    var sourceLabel = isDisc ? tr("Discourse") : tr("Reddit");
    var chip = function (id, label) {
      return '<button class="cm-chip' + (state.filter === id ? " on" : "") + '" type="button" data-cm="filter" data-filter="' + id + '">' + esc(label) + "</button>";
    };
    return '<div class="cm-filter-bar" role="tablist">' + chip("all", tr("All")) + chip(sourceId, sourceLabel) + chip("app", tr("ViktorychApp")) + "</div>";
  }

  function tabs(doc) {
    var isDisc = isDiscourse(doc);
    var tab = function (id, label) {
      return '<button class="tab' + (state.tab === id ? " on" : "") + '" type="button" data-cm="tab" data-tab="' + id + '"><span>' + esc(label) + "</span></button>";
    };
    if (isDisc) {
      return '<div class="tabs" role="tablist">' + tab("latest", tr("Latest")) + tab("top", tr("Top")) + tab("categories", tr("Categories")) + "</div>";
    }
    return '<div class="tabs" role="tablist">' + tab("top", tr("Top")) + tab("latest", tr("Latest")) + tab("media", tr("Media")) + "</div>";
  }

  function hubTabs() {
    var tab = function (id, label) {
      return '<button class="tab' + (state.hubTab === id ? " on" : "") + '" type="button" data-cm="hub-tab" data-hub="' + id + '"><span>' + esc(label) + "</span></button>";
    };
    return '<div class="tabs" role="tablist">' + tab("explore", tr("Explore")) + tab("joined", tr("Joined")) + "</div>";
  }

  function categoryPills(doc) {
    var tags = (doc && doc.tags) || [];
    var cats = [];
    var seen = {};
    tags.forEach(function (t) {
      if (t && t.name && !seen[t.name]) {
        seen[t.name] = true;
        cats.push({ name: t.name, color: t.color || "#71767b" });
      }
    });
    (doc.posts || []).forEach(function (p) {
      if (p.category && !seen[p.category]) {
        seen[p.category] = true;
        cats.push({ name: p.category, color: p.categoryColor || "#71767b" });
      }
    });
    if (!cats.length) return "";

    var allActive = state.category === "all";
    var allPill = '<button class="cm-d-cat-chip' + (allActive ? " on" : "") + '" type="button" data-cm="d-cat" data-cat="all">' +
      esc(tr("All Categories")) + '</button>';

    var pills = cats.map(function (c) {
      var on = state.category.toLowerCase() === c.name.toLowerCase();
      var dot = '<span class="cm-d-cat-dot" style="background:' + esc(c.color) + '"></span>';
      return '<button class="cm-d-cat-chip' + (on ? " on" : "") + '" type="button" data-cm="d-cat" data-cat="' + esc(c.name) + '">' +
        dot + '<span>' + esc(c.name) + '</span></button>';
    }).join("");

    return '<div class="cm-d-cat-bar" role="tablist">' + allPill + pills + '</div>';
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
    if (!list || !list.length) return "";
    var rendered = list.map(function (media, index) {
      if (!media || !media.url) return "";
      var src = playUrl(name, post, media, index);
      var fallback = src !== media.url ? ' data-fallback="' + esc(media.url) + '"' : "";
      if (media.type === "video") return '<video class="cm-reddit-video" controls playsinline src="' + esc(src) + '"' + fallback + "></video>";
      return '<img class="cm-reddit-photo" alt="" loading="lazy" src="' + esc(src) + '"' + fallback + ">";
    }).join("");
    return '<div class="cm-media-wrap">' + rendered + '</div>';
  }

  function face(author) {
    if (author && (author.profileLess || author.handle === "anonymous")) {
      return '<span class="cm-app-ava cm-app-anon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-2.67 0-8 1.34-8 4v1h16v-1c0-2.66-5.33-4-8-4z"/></svg></span>';
    }
    var letter = String(author.displayName || author.handle || "?").slice(0, 1).toUpperCase();
    if (author.avatar && /^https:\/\//.test(author.avatar)) return '<img class="cm-app-ava" alt="" src="' + esc(author.avatar) + '">';
    return '<span class="cm-app-ava cm-app-letter">' + esc(letter) + "</span>";
  }

  function discourseAvatar(url, name, sizeCls) {
    var letter = String(name || "?").slice(0, 1).toUpperCase();
    var cls = "cm-d-ava " + (sizeCls || "");
    if (url && /^https?:\/\//i.test(url)) {
      return '<img class="' + cls + '" src="' + esc(url) + '" alt="" loading="lazy">';
    }
    return '<span class="' + cls + ' cm-d-letter">' + esc(letter) + "</span>";
  }

  function joinBtn(name, joined) {
    return '<button type="button" class="cm-btn-join' + (joined ? " joined" : "") + '" data-cm="join" data-sub="' + esc(name) + '" data-leave-text="' + esc(tr("Leave")) + '"><span>' +
      esc(joined ? tr("Joined") : tr("Join")) + "</span></button>";
  }

  /* Reddit Post Card */
  function redditCard(name, post, isThread) {
    var href = "#/communities/" + encodeURIComponent(name) + "/" + encodeURIComponent(post.id);
    var bag = state.internal[name] || {};
    var extra = Number((bag.likes || {})[post.id]) || 0;
    var liked = (bag.mine || []).indexOf(post.id) >= 0;
    var total = (Number(post.score) || 0) + extra;
    var cleanTxt = cleanRedditText(post.text);
    var authorClean = cleanAuthor(post.author);
    var redditHref = post.url || ("https://www.reddit.com/r/" + encodeURIComponent(name) + "/comments/" + encodeURIComponent(String(post.id).replace(/^t3_/, "")));

    return '<article class="cm-reddit-card' + (isThread ? " cm-thread-focus" : "") + '" data-post="' + esc(post.id) + '">' +
      '<div class="cm-reddit-vote">' +
        '<button class="cm-vote-arrow up' + (liked ? " on" : "") + '" type="button" data-cm="like" data-id="' + esc(post.id) + '" aria-label="' + esc(tr("Like")) + '">' + svgUp + '</button>' +
        '<span class="cm-reddit-score' + (liked ? " on" : "") + '">' + esc(count(total)) + '</span>' +
        '<button class="cm-vote-arrow down" type="button" data-cm="downvote" data-id="' + esc(post.id) + '" aria-label="Downvote">' + svgDown + '</button>' +
      '</div>' +
      '<div class="cm-reddit-main">' +
        '<div class="cm-reddit-byline">' +
          '<span class="cm-reddit-snoo">' + svgSnoo + '</span>' +
          '<a class="cm-reddit-sub" href="#/communities/' + encodeURIComponent(name) + '">r/' + esc(name) + '</a>' +
          '<span>•</span>' +
          '<span class="cm-reddit-author">u/' + esc(authorClean) + '</span>' +
          '<span>•</span>' +
          '<span class="cm-reddit-time">' + esc(timeAgo((Number(post.created) || 0) * 1000)) + '</span>' +
          (post.flair ? '<span class="cm-reddit-flair">' + esc(post.flair) + '</span>' : "") +
        '</div>' +
        '<a class="cm-reddit-title" href="' + href + '">' + esc(post.title || "") + '</a>' +
        (cleanTxt ? '<div class="cm-reddit-text">' + esc(cleanTxt) + '</div>' : "") +
        mediaHtml(name, post, post.media) +
        '<div class="cm-reddit-actions">' +
          '<div class="cm-mobile-vote">' +
            '<button class="cm-vote-arrow up' + (liked ? " on" : "") + '" type="button" data-cm="like" data-id="' + esc(post.id) + '">' + svgUp + '</button>' +
            '<span class="cm-reddit-score' + (liked ? " on" : "") + '">' + esc(count(total)) + '</span>' +
            '<button class="cm-vote-arrow down" type="button" data-cm="downvote" data-id="' + esc(post.id) + '">' + svgDown + '</button>' +
          '</div>' +
          '<a class="cm-reddit-action-btn" href="' + href + '">' + svgComment + '<span>' + esc(count(post.comments)) + " " + esc(tr("Comments")) + '</span></a>' +
          '<button class="cm-reddit-action-btn" type="button" data-cm="share" data-href="' + href + '">' + svgShare + '<span>' + esc(tr("Share")) + '</span></button>' +
          '<a class="cm-reddit-action-btn reddit-link" href="' + esc(redditHref) + '" target="_blank" rel="noopener noreferrer">' + svgSnoo + '<span>' + esc(tr("Open on Reddit")) + '</span> ' + svgExternal + '</a>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  /* Discourse Topic Row — Authentic Discourse Forum Layout */
  function discourseCard(name, post) {
    var href = "#/communities/" + encodeURIComponent(name) + "/" + encodeURIComponent(post.id);
    var topicUrl = post.url || ("https://discuss.grapheneos.org/d/" + encodeURIComponent(post.id));
    var commentsCount = Number(post.comments || 0);
    var viewsCount = Number(post.views || 0);
    var catName = post.category || "General";
    var catColor = post.categoryColor || "#71767b";
    var catDot = '<span class="cm-d-cat-dot" style="background:' + esc(catColor) + '"></span>';

    var tagsHtml = (post.tags || []).slice(0, 3).map(function (t) {
      return '<span class="cm-d-tag">#' + esc(t) + '</span>';
    }).join("");

    var pinnedBadge = post.pinned
      ? '<span class="cm-d-badge-pinned">' + svgPin + ' ' + esc(tr("Pinned")) + '</span>'
      : "";

    var excerpt = post.text ? cleanDiscourseExcerpt(post.text) : "";
    var timeText = timeAgo((Number(post.lastPostedAt || post.created) || 0) * 1000);

    return '<article class="cm-d-topic-row" data-topic="' + esc(post.id) + '">' +
      '<div class="cm-d-topic-main">' +
        '<div class="cm-d-topic-top">' +
          pinnedBadge +
          '<a class="cm-d-topic-title" href="' + href + '">' + esc(post.title || "") + '</a>' +
        '</div>' +
        (excerpt ? '<p class="cm-d-topic-excerpt">' + esc(excerpt) + '</p>' : "") +
        '<div class="cm-d-topic-meta">' +
          '<span class="cm-d-cat-pill">' + catDot + '<span>' + esc(catName) + '</span></span>' +
          tagsHtml +
          '<span class="cm-d-meta-sep">•</span>' +
          '<div class="cm-d-author-meta">' +
            discourseAvatar(post.authorAvatar, post.author, "mini") +
            '<span class="cm-d-author-name">@' + esc(post.author || "author") + '</span>' +
          '</div>' +
          '<span class="cm-d-meta-sep">•</span>' +
          '<span class="cm-d-time">' + esc(timeText) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="cm-d-topic-aside">' +
        '<a class="cm-d-metric-box replies" href="' + href + '" title="' + esc(tr("Replies")) + '">' +
          svgComment + '<span>' + esc(count(commentsCount)) + '</span>' +
        '</a>' +
        '<div class="cm-d-metric-box views" title="' + esc(tr("Views")) + '">' +
          svgViews + '<span>' + esc(count(viewsCount)) + '</span>' +
        '</div>' +
        '<button class="cm-d-icon-act" type="button" data-cm="share" data-href="' + href + '" title="' + esc(tr("Share")) + '">' +
          svgShare +
        '</button>' +
        '<a class="cm-d-icon-act" href="' + esc(topicUrl) + '" target="_blank" rel="noopener noreferrer" title="' + esc(tr("Open on forum")) + '">' +
          svgExternal +
        '</a>' +
      '</div>' +
    '</article>';
  }

  /* ViktorychApp Native Post Card */
  function appCard(name, post) {
    var author = post.author || {};
    var bag = state.internal[name] || {};
    var href = "#/communities/" + encodeURIComponent(name) + "/" + encodeURIComponent(post.id);
    var liked = (bag.mine || []).indexOf(post.id) >= 0;
    var likeCount = Number((bag.likes || {})[post.id]) || 0;
    var isAnon = !!(author && (author.profileLess || author.handle === "anonymous"));
    var authorId = String((author && (author.publicId || author.id)) || post.authorId || post.author_id || "").replace(/^app:/, "");
    var authorHandle = String(author.handle || "");
    if (!isAnon && authorId && authorHandle && !authorHandle.endsWith(authorId)) {
      authorHandle += authorId;
    }
    var authorName = isAnon ? tr("Anonymous") : (author.displayName || author.handle || "");
    var displayHandle = isAnon ? "anonymous" : authorHandle;

    return '<article class="cm-app-card" data-post="' + esc(post.id) + '">' +
      face(author) +
      '<div class="cm-app-main">' +
        '<div class="cm-app-byline">' +
          '<span class="cm-app-name">' + esc(authorName) + (author.owner ? " ✓" : "") + '</span>' +
          '<span class="cm-app-handle">@' + esc(displayHandle) + '</span>' +
          '<span class="cm-app-badge' + (isAnon ? " cm-badge-anon" : "") + '">' + esc(isAnon ? tr("Anonymous") : tr("Only on ViktorychApp")) + '</span>' +
        '</div>' +
        '<a class="cm-app-text" href="' + href + '">' + esc(post.body || "") + '</a>' +
        '<div class="cm-app-actions">' +
          '<a class="cm-app-act" href="' + href + '">' + svgComment + '<span>' + esc(tr("Reply")) + '</span></a>' +
          '<button class="cm-app-act like' + (liked ? " on" : "") + '" type="button" data-cm="like" data-id="' + esc(post.id) + '">' +
            (liked ? svgHeartOn : svgHeart) + '<span>' + esc(count(likeCount)) + '</span>' +
          '</button>' +
          '<button class="cm-app-act" type="button" data-cm="share" data-href="' + href + '">' + svgShare + '</button>' +
          (post.mine || owner() ? '<button class="cm-app-act del" type="button" data-cm="delete" data-id="' + esc(post.id) + '" data-sub="' + esc(name) + '">' + svgTrash + '</button>' : "") +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function card(name, item) {
    if (item.source === "reddit") return redditCard(name, item.post, false);
    if (item.source === "discourse") return discourseCard(name, item.post);
    return appCard(name, item.post);
  }

  function currentSub() {
    var parts = (location.hash || "").split("?")[0].replace(/^#\/?/, "").split("/");
    if (parts[0] !== "communities") return "";
    return nameOf(parts[1]);
  }

  /* Communities Hub / Explore Page */
  function listPage() {
    var index = state.index;
    if (!index) {
      loadIndex().then(render);
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
      var topIsDisc = isDiscourse(top);
      var topAvatar = top.icon
        ? '<img class="cm-spotlight-avatar" src="' + esc(top.icon) + '" alt="">'
        : ('<div class="cm-spotlight-avatar">' + (topIsDisc ? svgDiscourse : svgSnoo) + '</div>');
      var topTitle = topIsDisc ? esc(top.title || top.name) : ("r/" + esc(top.name));
      var topBadge = topIsDisc ? '<span class="cm-discourse-badge">' + svgDiscourse + ' Discourse</span>' : '<span class="cm-spotlight-badge">' + esc(tr("Explore")) + '</span>';

      spotlightHtml = '<div class="cm-spotlight">' +
        '<div class="cm-spotlight-banner">' +
          (top.banner ? '<img src="' + esc(top.banner) + '" alt="" style="width:100%;height:100%;object-fit:cover;">' : "") +
          topBadge +
        '</div>' +
        '<div class="cm-spotlight-body">' +
          '<div class="cm-spotlight-top">' +
            topAvatar +
            joinBtn(top.name, topJoined) +
          '</div>' +
          '<a href="#/communities/' + encodeURIComponent(top.name) + '" style="text-decoration:none;color:inherit;">' +
            '<h2 class="cm-spotlight-title">' + topTitle + '</h2>' +
            '<p class="cm-spotlight-desc">' + esc(top.about || top.title || top.name) + '</p>' +
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
      var isDisc = isDiscourse(row);
      var bannerStyle = row.banner ? ' style="background-image:url(\'' + esc(row.banner) + '\');background-size:cover;background-position:center;"' : "";
      var avaHtml = row.icon
        ? '<img class="cm-card-avatar" alt="" src="' + esc(row.icon) + '">'
        : ('<div class="cm-card-avatar">' + (isDisc ? svgDiscourse : svgSnoo) + '</div>');
      var cardTitle = isDisc ? esc(row.title || row.name) : ("r/" + esc(row.name));
      var discPill = isDisc ? '<span class="cm-discourse-pill">' + svgDiscourse + ' Discourse</span>' : "";

      return '<div class="cm-card">' +
        '<a class="cm-card-cover"' + bannerStyle + ' href="#/communities/' + encodeURIComponent(row.name) + '"></a>' +
        '<div class="cm-card-body">' +
          '<div class="cm-card-row">' +
            avaHtml +
            joinBtn(row.name, isJoined) +
          '</div>' +
          '<a href="#/communities/' + encodeURIComponent(row.name) + '" style="text-decoration:none;color:inherit;">' +
            '<h3 class="cm-card-title">' + cardTitle + ' ' + discPill + '</h3>' +
            '<p class="cm-card-desc">' + esc(row.about || row.title || row.name) + '</p>' +
            '<div class="cm-facepile-wrap">' +
              '<div class="cm-facepile"><span class="cm-face-dot d1"></span><span class="cm-face-dot d2"></span><span class="cm-face-dot d3"></span></div>' +
              '<span>' + esc(count(row.subscribers || 35000)) + ' ' + esc(tr("Members")) + '</span>' +
            '</div>' +
          '</a>' +
        '</div>' +
      '</div>';
    }).join("");

    var sectionTitle = state.hubTab === "joined" ? tr("Your Communities") : tr("Discover Communities");
    var emptyHtml = state.hubTab === "joined"
      ? '<div class="empty"><h2>' + esc(tr("No communities yet.")) + '</h2><p>' + esc(tr("Search Communities")) + '</p></div>'
      : '<div class="empty"><h2>' + esc(tr("That community wasn’t found.")) + '</h2></div>';

    return head(tr("Communities"), null, addToggle) +
      addBar +
      hubTabs() +
      searchBar +
      spotlightHtml +
      '<div class="cm-section-head">' + esc(sectionTitle) + '</div>' +
      (cards ? '<div class="cm-card-grid">' + cards + '</div>' : emptyHtml);
  }

  /* Single Community Feed Page */
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
      return head(name, "#/communities") + '<div class="reply-empty">' + esc(tr("Loading")) + "</div>";
    }

    var bag = state.internal[name];
    var joined = bag && bag.joined;
    var isDisc = isDiscourse(doc);

    var bannerImg = doc.banner
      ? '<img class="cm-hero-banner" alt="" src="' + esc(doc.banner) + '">'
      : '<div class="cm-hero-banner"></div>';

    var defaultSvg = isDisc ? svgDiscourse : svgSnoo;
    var avatarImg = doc.icon
      ? '<img class="cm-hero-avatar" alt="" src="' + esc(doc.icon) + '">'
      : '<div class="cm-hero-avatar">' + defaultSvg + '</div>';

    var shareBtn = '<button class="cm-icon-btn" type="button" data-cm="share" aria-label="' + esc(tr("Share")) + '">' + svgShare + '</button>';
    var removeBtn = owner() ? '<button class="cm-icon-btn" type="button" data-cm="remove" data-sub="' + esc(name) + '" aria-label="' + esc(tr("Remove")) + '">' + svgTrash + '</button>' : "";

    var rulesList = (doc.rules || []).map(function (rule, idx) {
      return '<div class="cm-rule-item"><span class="cm-rule-num">' + (idx + 1) + '</span><div><div class="cm-rule-title">' + esc(rule.title || "") + '</div><div>' + esc(rule.text || "") + '</div></div></div>';
    }).join("");

    var rulesAccordion = rulesList
      ? '<details class="cm-rules-box"><summary class="cm-rules-summary"><span>' + esc(tr("Community rules")) + '</span><span>▾</span></summary><div class="cm-rules-content">' + rulesList + '</div></details>'
      : "";

    var pageTitle = isDisc ? (doc.title || doc.name) : ("r/" + name);
    var composePlaceholder = isDisc
      ? tr("Post into {name}", { name: doc.title || doc.name })
      : tr("Post into r/{name}", { name: name });

    var isAnonAccount = Boolean(session().account && session().account.profileLess);
    var composePlaceholder = isDisc
      ? (isAnonAccount ? tr("Start an anonymous discussion") : tr("Start a new topic"))
      : (isAnonAccount ? tr("Post an anonymous reply") : tr("Post to {sub}", { sub: "r/" + name }));
    var composer = signedIn()
      ? '<form class="cm-composer' + (isDisc ? " cm-d-composer" : "") + '" data-cm="inline-post" data-sub="' + esc(name) + '">' +
          face(session().account || {}) +
          '<div class="cm-composer-main">' +
            '<textarea class="cm-composer-area" name="text" placeholder="' + esc(composePlaceholder) + '" aria-label="' + esc(composePlaceholder) + '"></textarea>' +
            '<div class="cm-composer-bottom">' +
              (isAnonAccount ? '<span class="cm-anon-indicator">' + esc(tr("Posting anonymously")) + '</span>' : "") +
              '<button type="submit" class="cm-composer-btn">' + esc(tr("Post")) + '</button>' +
            '</div>' +
          '</div>' +
        '</form>'
      : '<div class="cm-footer-note"><p>' + esc(tr("Sign in to post here.")) + '</p></div>';

    var items = feedItems(name, doc);
    var empty = state.filter === "app" && !signedIn()
      ? '<div class="empty"><p>' + esc(tr("Sign in to post here.")) + "</p></div>"
      : (items.length ? "" : '<div class="empty"><h2>' + esc(tr("No posts yet")) + "</h2></div>");

    var metaRow = "";
    if (isDisc) {
      var forumUrl = doc.url || "https://discuss.grapheneos.org";
      metaRow = '<div class="cm-hero-meta cm-d-hero-meta">' +
        '<span class="cm-discourse-tag-badge">' + svgDiscourse + ' ' + esc(tr("Discourse Forum")) + '</span>' +
        '<span><b>' + esc(count(doc.posts ? doc.posts.length : 0)) + '</b> ' + esc(tr("Topics")) + '</span>' +
        '<span class="cm-sep">·</span>' +
        '<span><b>' + esc(count(doc.subscribers || 35000)) + '</b> ' + esc(tr("Members")) + '</span>' +
        (bag && bag.members ? '<span class="cm-sep">·</span><span><b>' + esc(count(bag.members)) + '</b> ' + esc(tr("ViktorychApp members")) + '</span>' : "") +
        '<a class="cm-d-link-btn" href="' + esc(forumUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(tr("Open on forum")) + ' ' + svgExternal + '</a>' +
      '</div>';
    } else {
      metaRow = '<div class="cm-hero-meta">' +
        '<div class="cm-facepile"><span class="cm-face-dot d1"></span><span class="cm-face-dot d2"></span><span class="cm-face-dot d3"></span></div>' +
        '<span><b>' + esc(count(doc.subscribers || 2800000)) + '</b> ' + esc(tr("Reddit subscribers")) + '</span>' +
        (bag && bag.members ? '<span class="cm-sep">·</span><span><b>' + esc(count(bag.members)) + '</b> ' + esc(tr("ViktorychApp members")) + '</span>' : "") +
      '</div>';
    }

    var catBar = isDisc ? categoryPills(doc) : "";
    var footerNotice = isDisc ? tr("Nothing is sent to the forum.") : tr("Nothing is sent to Reddit.");

    return head(pageTitle, "#/communities", shareBtn) +
      '<section class="cm-hero' + (isDisc ? " cm-d-hero" : "") + '">' +
        bannerImg +
        '<div class="cm-hero-body">' +
          '<div class="cm-hero-bar">' +
            avatarImg +
            '<div class="cm-hero-actions">' +
              shareBtn +
              removeBtn +
              joinBtn(name, joined) +
            '</div>' +
          '</div>' +
          '<h1 class="cm-hero-title">' + esc(pageTitle) + '</h1>' +
          metaRow +
          (doc.about ? '<p class="cm-hero-about">' + esc(doc.about) + '</p>' : "") +
          rulesAccordion +
        '</div>' +
      '</section>' +
      tabs(doc) +
      catBar +
      chips(doc) +
      composer +
      empty +
      items.map(function (item) { return card(name, item); }).join("") +
      '<p class="cm-footer-note">' + esc(footerNotice) + '</p>';
  }

  function findPost(doc, id) {
    var found = null;
    (doc.posts || []).forEach(function (post) {
      if (String(post.id) === String(id)) found = { kind: "post", post: post };
      (post.replies || []).forEach(function (reply) {
        if (String(reply.id) === String(id)) found = { kind: "reply", reply: reply, post: post };
      });
    });
    return found;
  }

  /* Single Thread / Topic View */
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
    var internal = (bag.posts || []).filter(function (post) { return String(post.id) === String(id); })[0];
    var matched = findPost(doc, id);
    var isDisc = isDiscourse(doc);

    if (isDisc) {
      var topic = matched ? matched.post : null;
      if (!topic && !internal) {
        return head(doc.title || doc.name, "#/communities/" + name) + '<div class="empty"><h2>' + esc(tr("That community wasn’t found.")) + "</h2></div>";
      }

      var topicTitle = topic ? topic.title : (internal ? internal.body.slice(0, 40) : "");
      var topicUrl = topic ? (topic.url || ("https://discuss.grapheneos.org/d/" + encodeURIComponent(topic.id))) : "";
      var catDot = topic ? ('<span class="cm-d-cat-dot" style="background:' + esc(topic.categoryColor || "#71767b") + '"></span>') : "";

      var threadHeader = '<div class="cm-d-thread-header">' +
        (topic && topic.category ? ('<div class="cm-d-cat-pill">' + catDot + '<span>' + esc(topic.category) + '</span></div>') : "") +
        '<h1 class="cm-d-thread-title">' + esc(topicTitle) + '</h1>' +
        (topic ? (
          '<div class="cm-d-thread-meta">' +
            '<div class="cm-d-author-meta">' +
              discourseAvatar(topic.authorAvatar, topic.author, "mini") +
              '<span class="cm-d-author-name">@' + esc(topic.author || "author") + '</span>' +
            '</div>' +
            '<span class="cm-d-meta-sep">•</span>' +
            '<span>' + esc(timeAgo(topic.created * 1000)) + '</span>' +
            '<span class="cm-d-meta-sep">•</span>' +
            '<span><b>' + esc(count(topic.comments || 0)) + '</b> ' + esc(tr("Replies")) + '</span>' +
            '<span class="cm-d-meta-sep">•</span>' +
            '<span><b>' + esc(count(topic.views || 0)) + '</b> ' + esc(tr("Views")) + '</span>' +
            (topicUrl ? ('<a class="cm-d-link-btn" href="' + esc(topicUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(tr("Open on forum")) + ' ' + svgExternal + '</a>') : "") +
          '</div>'
        ) : "") +
      '</div>';

      // OP Card
      var extraLikes = Number((bag.likes || {})[topic ? topic.id : id]) || 0;
      var liked = (bag.mine || []).indexOf(topic ? topic.id : id) >= 0;
      var opLikes = (topic ? Number(topic.score || 0) : 0) + extraLikes;

      var opHtml = "";
      if (topic) {
        opHtml = '<article class="cm-d-post op" data-post="' + esc(topic.id) + '">' +
          '<div class="cm-d-post-top">' +
            discourseAvatar(topic.authorAvatar, topic.author, "med") +
            '<div class="cm-d-post-byline">' +
              '<div class="cm-d-post-user-row">' +
                '<span class="cm-d-post-user">@' + esc(topic.author || "author") + '</span>' +
                '<span class="cm-d-badge op">OP</span>' +
              '</div>' +
              '<span class="cm-d-post-time">' + esc(timeAgo(topic.created * 1000)) + '</span>' +
            '</div>' +
            '<span class="cm-d-post-num">#1</span>' +
          '</div>' +
          '<div class="cm-d-post-body">' + sanitizeDiscourseHtml(topic.text) + '</div>' +
          '<div class="cm-d-post-actions">' +
            '<button class="cm-d-act-btn like' + (liked ? " on" : "") + '" type="button" data-cm="like" data-id="' + esc(topic.id) + '">' +
              (liked ? svgHeartOn : svgHeart) + '<span>' + esc(count(opLikes)) + '</span>' +
            '</button>' +
            '<button class="cm-d-act-btn" type="button" data-cm="d-focus-reply">' + svgReply + '<span>' + esc(tr("Reply")) + '</span></button>' +
            '<button class="cm-d-act-btn" type="button" data-cm="share" data-href="#/communities/' + encodeURIComponent(name) + '/' + encodeURIComponent(topic.id) + '">' + svgShare + '</button>' +
          '</div>' +
        '</article>';
      } else if (internal) {
        opHtml = appCard(name, internal);
      }

      // Stream of replies
      var repliesList = repliesFor(name, id, doc).map(function (item, idx) {
        if (item.source === "discourse") {
          var rep = item.reply;
          var repNum = rep.number || (idx + 2);
          var repLiked = (bag.mine || []).indexOf(rep.id) >= 0;
          var repExtra = Number((bag.likes || {})[rep.id]) || 0;
          var repTotal = (Number(rep.score) || 0) + repExtra;

          return '<article class="cm-d-post" data-post="' + esc(rep.id) + '">' +
            '<div class="cm-d-post-top">' +
              discourseAvatar(rep.authorAvatar, rep.author, "med") +
              '<div class="cm-d-post-byline">' +
                '<div class="cm-d-post-user-row">' +
                  '<span class="cm-d-post-user">@' + esc(rep.author || "author") + '</span>' +
                '</div>' +
                '<span class="cm-d-post-time">' + esc(timeAgo(item.created)) + '</span>' +
              '</div>' +
              '<span class="cm-d-post-num">#' + esc(repNum) + '</span>' +
            '</div>' +
            '<div class="cm-d-post-body">' + sanitizeDiscourseHtml(rep.text) + '</div>' +
            '<div class="cm-d-post-actions">' +
              '<button class="cm-d-act-btn like' + (repLiked ? " on" : "") + '" type="button" data-cm="like" data-id="' + esc(rep.id) + '">' +
                (repLiked ? svgHeartOn : svgHeart) + '<span>' + esc(count(repTotal)) + '</span>' +
              '</button>' +
              '<button class="cm-d-act-btn" type="button" data-cm="d-focus-reply">' + svgReply + '<span>' + esc(tr("Reply")) + '</span></button>' +
              '<button class="cm-d-act-btn" type="button" data-cm="share" data-href="#/communities/' + encodeURIComponent(name) + '/' + encodeURIComponent(id) + '">' + svgShare + '</button>' +
            '</div>' +
          '</article>';
        }
        return appCard(name, item.post);
      }).join("");

      var discourseReplyBox = signedIn()
        ? '<form class="cm-composer cm-d-composer" data-cm="reply" data-sub="' + esc(name) + '" data-parent="' + esc(id) + '">' +
            face(session().account || {}) +
            '<div class="cm-composer-main">' +
              '<textarea class="cm-composer-area" name="text" aria-label="' + esc(tr("Reply to this topic")) + '" placeholder="' + esc(tr("Reply to this topic")) + '"></textarea>' +
              '<div class="cm-composer-bottom">' +
                '<button type="submit" class="cm-composer-btn">' + svgReply + ' ' + esc(tr("Reply")) + '</button>' +
              '</div>' +
            '</div>' +
          '</form>'
        : '<div class="cm-footer-note"><p>' + esc(tr("Sign in to post here.")) + '</p></div>';

      return head(doc.title || doc.name, "#/communities/" + name) +
        threadHeader +
        '<div class="cm-d-stream">' +
          opHtml +
          repliesList +
        '</div>' +
        chips(doc) +
        discourseReplyBox +
        '<p class="cm-footer-note">' + esc(tr("Nothing is sent to the forum.")) + '</p>';
    }

    // Default Reddit thread view
    var focus = "";
    if (internal && signedIn()) focus = appCard(name, internal);
    else if (matched && matched.kind === "post") focus = redditCard(name, matched.post, true);
    else if (matched && matched.kind === "reply") {
      focus = '<article class="cm-reddit-comment">' +
        '<div class="cm-comment-gutter"><span class="cm-comment-snoo">' + svgSnoo + '</span><span class="cm-comment-line"></span></div>' +
        '<div class="cm-comment-body">' +
          '<div class="cm-comment-byline"><span class="cm-comment-author">u/' + esc(cleanAuthor(matched.reply.author)) + '</span><span>•</span><span>' + esc(timeAgo((Number(matched.reply.created) || 0) * 1000)) + '</span></div>' +
          '<div class="cm-comment-text">' + esc(matched.reply.text || "") + '</div>' +
        '</div>' +
      '</article>';
    }

    if (!focus) return head("r/" + name, "#/communities/" + name) + '<div class="empty"><h2>' + esc(tr("That community wasn’t found.")) + "</h2></div>";

    var kids = repliesFor(name, id, doc).map(function (item) {
      if (item.source === "reddit") {
        var replyScore = Number(item.reply.score) || 0;
        return '<article class="cm-reddit-comment reply-card">' +
          '<div class="cm-comment-gutter"><span class="cm-comment-snoo">' + svgSnoo + '</span><span class="cm-comment-line"></span></div>' +
          '<div class="cm-comment-body">' +
            '<div class="cm-comment-byline"><span class="cm-comment-author">u/' + esc(cleanAuthor(item.reply.author)) + '</span><span>•</span><span>' + esc(timeAgo(item.created)) + '</span></div>' +
            '<div class="cm-comment-text">' + esc(item.reply.text || "") + '</div>' +
            '<div class="cm-comment-actions">' +
              '<span class="cm-mobile-vote">' +
                '<button class="cm-vote-arrow up" type="button" data-cm="like" data-id="' + esc(item.reply.id) + '">' + svgUp + '</button>' +
                '<span class="cm-reddit-score">' + esc(count(replyScore)) + '</span>' +
              '</span>' +
              '<button class="cm-reddit-action-btn" type="button" data-cm="focus-reply">' + svgComment + '<span>' + esc(tr("Reply")) + '</span></button>' +
            '</div>' +
          '</div>' +
        '</article>';
      }
      return appCard(name, item.post);
    }).join("");

    var isAnonAccount = Boolean(session().account && session().account.profileLess);
    var box = signedIn()
      ? '<form class="cm-composer" data-cm="reply" data-sub="' + esc(name) + '" data-parent="' + esc(id) + '">' +
          face(session().account || {}) +
          '<div class="cm-composer-main">' +
            '<textarea class="cm-composer-area" name="text" aria-label="' + esc(isAnonAccount ? tr("Post an anonymous reply") : tr("Post your reply")) + '" placeholder="' + esc(isAnonAccount ? tr("Post an anonymous reply") : tr("Post your reply")) + '"></textarea>' +
            '<div class="cm-composer-bottom">' +
              (isAnonAccount ? '<span class="cm-anon-indicator">' + esc(tr("Posting anonymously")) + '</span>' : "") +
              '<button type="submit" class="cm-composer-btn">' + esc(tr("Reply")) + '</button>' +
            '</div>' +
          '</div>' +
        '</form>'
      : '<div class="cm-footer-note"><p>' + esc(tr("Sign in to post here.")) + '</p></div>';

    return head("r/" + name, "#/communities/" + name) +
      focus +
      chips(doc) +
      '<div class="cm-thread-replies-head">' + esc(tr("Comments")) + '</div>' +
      kids +
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

    if (act === "d-cat") {
      state.category = el.dataset.cat || "all";
      render();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (act === "d-focus-reply") {
      event.preventDefault();
      event.stopPropagation();
      var area = document.querySelector(".cm-composer-area");
      if (area) { area.focus(); area.scrollIntoView({ behavior: "smooth" }); }
      return;
    }
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
      state.tab = el.dataset.tab || "latest";
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
      return;
    }
    if (act === "focus-reply") {
      event.preventDefault();
      event.stopPropagation();
      var fArea = document.querySelector(".cm-composer-area");
      if (fArea) { fArea.focus(); fArea.scrollIntoView({ behavior: "smooth" }); }
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
      if (!name) { toast(tr("That community wasn’t found.")); return; }
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
