/* X-styled Discord inbox. Text is escaped before it is inserted.
   Servers and channels come from the config. Nothing here is special to one server. */
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
    if (api && api.productName) return api.productName(kind);
    if (kind === "musicShort") return "ViktrychMusic";
    if (kind === "music") return "ViktorychMusic";
    if (kind === "pwa") return "ViktrychApp";
    return "ViktorychApp";
  }

  const TOPIC = "superintelmusic-discord-th-7f3a91c2";
  const SEEN_KEY = "superintelapp-discord-seen-v1";
  const PREFS_KEY = "superintelapp-discord-prefs-v1";
  const SCROLL_KEY = "superintelapp-discord-scroll-v1";

  function readStore(store, name) {
    try {
      const current = store.getItem(name);
      if (current != null) return current;
      const previous = store.getItem(String(name).replace("superintelapp-", "rss-" + "feeds-"));
      if (previous != null) {
        try { store.setItem(name, previous); } catch (err) { /* private mode can refuse */ }
        return previous;
      }
    } catch (err) { /* private mode can refuse */ }
    return null;
  }

  function readLocal(name) {
    return readStore(localStorage, name);
  }
  const WINDOW = 300;
  const CATALOG_SERVERS = [
    {
      id: "169256939211980800",
      name: "Discord Town Hall",
      channels: [
        { id: "1502285163009409175", name: "rules", category: tr("Information"), mode: "messages" },
        { id: "739179537933533264", name: "support", category: tr("Information"), mode: "messages" },
        { id: "1106365828842139668", name: "account-safety", category: tr("Information"), mode: "messages" },
        { id: "1514784753293852702", name: "wellbeing-resources", category: tr("Information"), mode: "messages" },
        { id: "889949624218042420", name: "product-updates", category: "Announcements", mode: "posts" },
        { id: "889960284020699156", name: "discord-updates", category: "Announcements", mode: "posts" },
        { id: "1337485085737484360", name: "collab-announcements", category: "Announcements", mode: "posts" },
        { id: "1539700463715487854", name: "drops-and-deals", category: "Announcements", mode: "posts" },
        { id: "1539705311697309727", name: "wellbeing-bulletin", category: "Announcements", mode: "posts" },
        { id: "169256939211980800", name: "general-chat", category: "Town Hall General", mode: "messages" },
        { id: "1539754628575404213", name: "discord-discussion", category: "Town Hall General", mode: "messages" },
        { id: "889950993352110160", name: "peer-help", category: "Town Hall General", mode: "messages" },
        { id: "1537598337367146597", name: "profile-aesthetic", category: "Community Fun", mode: "messages" },
        { id: "1539719926573703321", name: "community-polls", category: "Community Fun", mode: "messages" },
        { id: "1544031346077339790", name: "fun-apps", category: "Community Fun", mode: "messages" },
        { id: "1219742162175131658", name: "giveaway-corner", category: "Community Fun", mode: "messages" }
      ]
    }
  ];

  const FIXTURE = {
    "169256939211980800": [
      msg("1530000000000000001", "1001", "Ada", "#5865f2", "0", "2026-10-21T16:40:00.000Z", "Welcome in. The **rules** channel is the place to start."),
      msg("1530000000000000002", "1002", "Wumpus", "#eb459e", "1", "2026-10-21T16:41:00.000Z", "Hello @Ada — glad you are here. Peek at ||the spoiler|| and `town-hall`."),
      msg("1530000000000000003", "1002", "Wumpus", "#eb459e", "1", "2026-10-21T16:42:00.000Z", "Same note, still me. *Town Hall* stays read-only on this page."),
      Object.assign(msg("1530000000000000004", "1003", "Clyde", "#57f287", "2", "2026-10-21T16:48:00.000Z", "Replying with a photo, a custom :wave:, and a link https://discord.com/safety plus <script>alert(1)</script>"), {
        replyId: "1530000000000000002",
        replyName: "Wumpus",
        replyText: "Hello @Ada — glad you are here.",
        attachments: [{ type: "photo", url: "https://cdn.discordapp.com/embed/avatars/2.png", w: 128, h: 128, alt: "Clyde" }],
        emojis: [{ name: "wave", url: "https://cdn.discordapp.com/embed/avatars/4.png" }],
        embeds: [{ url: "https://discord.com/safety", title: "Discord Safety", description: "A short **guide** for new members.", image: "https://cdn.discordapp.com/embed/avatars/0.png", site: "discord.com" }],
        reactions: [{ e: "👍", n: 4 }, { e: "💙", n: 2 }]
      })
    ],
    "889950993352110160": [
      msg("1530000000000000101", "1001", "Ada", "#5865f2", "0", "2026-10-21T15:05:00.000Z", "Has anyone tried the new profile layout?")
    ]
  };

  const FIXTURE_PINS = {
    "169256939211980800": [
      { id: "1530000000000000004", author: "Clyde", text: "Replying with a photo, a custom wave, and a link", date: "2026-10-21T16:48:00.000Z" },
      { id: "1530000000000000001", author: "Ada", text: "Welcome in. The rules channel is the place to start.", date: "2026-10-21T16:40:00.000Z" }
    ]
  };

  const MUTE_CHOICES = [
    { label: tr("For 15 minutes"), ms: 15 * 60 * 1000 },
    { label: tr("For 1 hour"), ms: 60 * 60 * 1000 },
    { label: tr("For 8 hours"), ms: 8 * 60 * 60 * 1000 },
    { label: tr("For 24 hours"), ms: 24 * 60 * 60 * 1000 },
    { label: tr("Until I turn it back on"), ms: 0 }
  ];

  function msg(id, authorId, name, color, avatarIndex, date, body) {
    return {
      id: id,
      authorId: authorId,
      name: name,
      avatar: "https://cdn.discordapp.com/embed/avatars/" + avatarIndex + ".png",
      color: color,
      body: body,
      date: date,
      replyId: "",
      replyName: "",
      replyText: "",
      attachments: [],
      embeds: [],
      emojis: [],
      reactions: [],
      edited: false
    };
  }

  const state = {
    servers: [],
    channels: [],
    serverName: "",
    icon: "",
    paused: false,
    topic: "",
    prefs: null,
    files: {},
    loading: {},
    live: {},
    deleted: {},
    query: "",
    open: "",
    stick: true,
    fixture: false,
    since: "",
    backoff: 1500,
    source: null,
    timer: 0,
    loadStarted: false,
    started: false,
    bound: null,
    pinFiles: {},
    pinLoading: {},
    menu: null,
    pinsOpen: "",
    jump: "",
    muteTimer: 0,
    hold: 0,
    suppressClick: "",
    listHold: null,
    winHold: null,
    scrollLock: false,
    holding: false
  };

  function copyChannel(ch, serverId) {
    return {
      id: ch.id,
      name: ch.name,
      category: ch.category || "",
      mode: ch.mode,
      serverId: serverId,
      inaccessible: false,
      pinsForbidden: false,
      file: ch.mode === "messages" ? "discord/messages/" + ch.id + ".json" : ""
    };
  }

  function adoptServers(list) {
    const servers = [];
    const channels = [];
    (list || []).forEach(function (server) {
      const id = snowflake(server && (server.id || server.guild));
      if (!id) return;
      const rows = [];
      (server.channels || []).forEach(function (ch) {
        const cid = snowflake(ch && ch.id);
        const mode = ch && (ch.mode === "posts" || ch.mode === "messages") ? ch.mode : "";
        if (!cid || !mode) return;
        const row = copyChannel({
          id: cid,
          name: String(ch.name || cid).slice(0, 80),
          category: String(ch.category || "").slice(0, 80),
          mode: mode
        }, id);
        rows.push(row);
        channels.push(row);
      });
      if (!rows.length) return;
      servers.push({
        id: id,
        name: String(server.name || id).slice(0, 80),
        icon: cdnUrl(server.icon) || "",
        channels: rows
      });
    });
    if (!servers.length) return false;
    state.servers = servers;
    state.channels = channels;
    state.serverName = servers[0].name;
    state.icon = servers[0].icon || "";
    return true;
  }

  function hooks() { return state.bound || {}; }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function cdnUrl(url) {
    const text = String(url || "");
    if (!text || text.length > 500 || /[\s<>"'\\]/.test(text)) return "";
    if (!/^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\//.test(text)) return "";
    return text;
  }

  function httpUrl(url) {
    const text = String(url || "");
    if (!text || text.length > 500 || /[\s<>"']/.test(text)) return "";
    if (!/^https?:\/\//i.test(text)) return "";
    return text;
  }

  function hexColor(value) {
    const text = String(value || "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : "";
  }

  function dim(value) {
    const n = Math.round(Number(value));
    if (!isFinite(n) || n <= 0 || n >= 10000) return 0;
    return n;
  }

  function snowflake(value) {
    const text = String(value || "");
    return /^\d{1,22}$/.test(text) ? text : "";
  }

  function cmpId(a, b) {
    const as = String(a || "");
    const bs = String(b || "");
    if (as.length !== bs.length) return as.length < bs.length ? -1 : 1;
    if (as < bs) return -1;
    if (as > bs) return 1;
    return 0;
  }

  function snowflakeMs(id) {
    try { return Number((BigInt(id) >> 22n) + 1420070400000n); }
    catch (err) { return 0; }
  }

  function msgTime(row) {
    const parsed = Date.parse(row && row.date || "");
    if (parsed) return parsed;
    return snowflakeMs(row && row.id);
  }

  function dayKey(row) {
    const ms = msgTime(row);
    if (!ms) return "";
    const date = new Date(ms);
    return date.getFullYear() + "-" + date.getMonth() + "-" + date.getDate();
  }

  function formatClock(row) {
    const ms = msgTime(row);
    if (!ms) return "";
    try {
      return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
    } catch (err) {
      return "";
    }
  }

  function formatDay(row) {
    const ms = msgTime(row);
    if (!ms) return "";
    try {
      return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(new Date(ms));
    } catch (err) {
      return "";
    }
  }

  function channelById(id) {
    const key = String(id || "");
    for (let i = 0; i < state.channels.length; i++) {
      if (state.channels[i].id === key) return state.channels[i];
    }
    return null;
  }

  function knownMap() {
    const map = {};
    const list = state.channels.length ? state.channels : CATALOG_SERVERS.reduce(function (all, server) {
      (server.channels || []).forEach(function (ch) { all.push(copyChannel(ch, server.id)); });
      return all;
    }, []);
    list.forEach(function (ch) { map[ch.id] = ch; });
    return map;
  }

  function format(raw, emojis) {
    const blocks = [];
    function hold(html) {
      const token = "\u0000" + blocks.length + "\u0000";
      blocks.push(html);
      return token;
    }
    let text = String(raw || "").replace(/\u0000/g, "").slice(0, 4000);
    text = text.replace(/<(a?):([A-Za-z0-9_]{2,32}):(\d{1,22})>/g, function (_m, anim, name, id) {
      const ext = anim === "a" ? "gif" : "png";
      return hold('<img class="dmsg-emoji" alt=":' + esc(name) + ':" src="https://cdn.discordapp.com/emojis/' + id + "." + ext + '" referrerpolicy="no-referrer">');
    });
    text = text.replace(/```([\s\S]*?)```/g, function (_m, code) {
      return hold('<pre class="dmsg-code">' + esc(code) + "</pre>");
    });
    text = text.replace(/`([^`\n]+)`/g, function (_m, code) {
      return hold("<code>" + esc(code) + "</code>");
    });
    text = esc(text);
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)&]+)\)/g, function (whole, label, url) {
      const href = httpUrl(url.replace(/&amp;/g, "&"));
      if (!href) return whole;
      return '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
    });
    text = linkifyOutside(text);
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).!?,:]|$)/g, "$1<em>$2</em>");
    text = text.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).!?,:]|$)/g, "$1<em>$2</em>");
    text = text.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="dmsg-spoiler" data-act="spoiler" role="button" tabindex="0">$1</span>');
    text = text.replace(/(^|[\s(])@([A-Za-z0-9_.]{1,32})/g, '$1<span class="dmsg-mention">@$2</span>');
    text = text.replace(/\u0000(\d+)\u0000/g, function (_m, index) {
      return blocks[Number(index)] || "";
    });
    return applyEmoji(text, emojis);
  }

  function linkifyOutside(html) {
    const parts = String(html || "").split(/(<[^>]+>)/);
    return parts.map(function (part) {
      if (!part || part.charAt(0) === "<") return part;
      return part.replace(/https?:\/\/[^\s<&]+/g, function (url) {
        let bare = url.replace(/&amp;/g, "&");
        let extra = "";
        while (bare && /[),.;!?]$/.test(bare)) {
          extra = bare.slice(-1) + extra;
          bare = bare.slice(0, -1);
        }
        const href = httpUrl(bare);
        if (!href) return url;
        return '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(href) + "</a>" + esc(extra);
      });
    }).join("");
  }

  function applyEmoji(html, emojis) {
    const map = {};
    (emojis || []).forEach(function (emoji) {
      const url = cdnUrl(emoji && emoji.url);
      const name = emoji && /^[A-Za-z0-9_]{2,32}$/.test(emoji.name) ? emoji.name : "";
      if (url && name) map[name] = url;
    });
    if (!Object.keys(map).length) return html;
    const parts = html.split(/(<\/?(?:code|pre)[^>]*>)/);
    let inCode = 0;
    return parts.map(function (part) {
      if (part.indexOf("<code") === 0 || part.indexOf("<pre") === 0) { inCode += 1; return part; }
      if (part.indexOf("</code") === 0 || part.indexOf("</pre") === 0) { inCode = Math.max(0, inCode - 1); return part; }
      if (inCode) return part;
      return part.replace(/:([A-Za-z0-9_]{2,32}):/g, function (whole, name) {
        if (!map[name]) return whole;
        return '<img class="dmsg-emoji" alt=":' + esc(name) + ':" src="' + esc(map[name]) + '" referrerpolicy="no-referrer">';
      });
    }).join("");
  }

  function fromFile(row, authors) {
    const author = (authors && authors[row.author]) || {};
    const attachments = [];
    (row.attachments || []).forEach(function (item) {
      const url = cdnUrl(item && item.url);
      if (!url) return;
      attachments.push({
        type: item.type === "video" ? "video" : "photo",
        url: url,
        w: dim(item.width),
        h: dim(item.height),
        alt: String(item.alt || "").slice(0, 180)
      });
    });
    const reactions = [];
    (row.reactions || []).forEach(function (item) {
      if (!item) return;
      const e = String(item.emoji || item.e || "").slice(0, 32);
      const n = Math.round(Number(item.count || item.n) || 0);
      if (!e || n <= 0 || /[<>]/.test(e)) return;
      reactions.push({ e: e, n: n, url: cdnUrl(item.url) });
    });
    return {
      id: String(row.id),
      authorId: String(row.author || ""),
      name: String(author.name || tr("Unknown")).slice(0, 80),
      avatar: cdnUrl(author.avatar),
      color: hexColor(author.color),
      body: String(row.content || row.text || ""),
      date: String(row.date || ""),
      replyId: String(row.reply || ""),
      replyName: String(row.replyAuthor || ""),
      replyText: String(row.replyText || ""),
      attachments: attachments,
      embeds: Array.isArray(row.cards) ? row.cards : [],
      emojis: Array.isArray(row.emojis) ? row.emojis : [],
      reactions: reactions,
      edited: !!row.edited
    };
  }

  function fromLive(m) {
    return {
      id: m.id,
      authorId: m.author.id,
      name: m.author.name || tr("Someone"),
      avatar: m.author.avatar || "",
      color: hexColor(m.author.color),
      body: m.content || "",
      date: m.ts && Date.parse(m.ts) ? m.ts : "",
      replyId: m.reply ? m.reply.id : "",
      replyName: m.reply ? m.reply.author : "",
      replyText: m.reply ? m.reply.content : "",
      attachments: m.att || [],
      embeds: m.emb || [],
      emojis: [],
      reactions: m.rx || [],
      edited: !!m.edited
    };
  }

  function messagesFor(channelId) {
    const gone = state.deleted[channelId] || {};
    const map = new Map();
    if (state.fixture && FIXTURE[channelId]) {
      FIXTURE[channelId].forEach(function (row) {
        if (!gone[row.id]) map.set(row.id, row);
      });
    } else {
      const file = state.files[channelId];
      const authors = file && file.authors || {};
      const rows = file && Array.isArray(file.messages) ? file.messages : [];
      rows.forEach(function (row) {
        if (!row || !snowflake(row.id) || gone[row.id]) return;
        map.set(String(row.id), fromFile(row, authors));
      });
    }
    (state.live[channelId] || []).forEach(function (row) {
      if (!gone[row.id]) map.set(row.id, row);
    });
    const all = Array.from(map.values());
    all.sort(function (a, b) { return cmpId(b.id, a.id); });
    return all.slice(0, WINDOW);
  }

  function validate(body, known) {
    if (!body || typeof body !== "object" || body.v !== 1) return null;
    const ch = snowflake(body.ch);
    if (!ch || !known || !known[ch]) return null;
    if (body.del != null && body.m == null) {
      const id = snowflake(body.del);
      if (!id) return null;
      return { ch: ch, del: id };
    }
    const m = body.m;
    if (!m || typeof m !== "object" || Array.isArray(m)) return null;
    const id = snowflake(m.id);
    if (!id) return null;
    if (typeof m.content !== "string" && m.content != null) return null;
    const content = String(m.content || "");
    if (content.length > 4000) return null;
    const author = m.author && typeof m.author === "object" ? m.author : {};
    const aid = String(author.id || "");
    if (aid && !snowflake(aid)) return null;
    const name = String(author.name || tr("Someone")).replace(/\u0000/g, "").slice(0, 80);
    const att = [];
    (Array.isArray(m.att) ? m.att.slice(0, 8) : []).forEach(function (item) {
      if (!item || typeof item !== "object") return;
      const url = cdnUrl(item.url);
      if (!url) return;
      const type = item.type === "video" || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url) ? "video" : "photo";
      att.push({ url: url, type: type, w: dim(item.w), h: dim(item.h), alt: "" });
    });
    const emb = [];
    (Array.isArray(m.emb) ? m.emb.slice(0, 4) : []).forEach(function (item) {
      if (!item || typeof item !== "object") return;
      const image = cdnUrl(typeof item.image === "string" ? item.image : (item.image && item.image.url) || "");
      const url = httpUrl(item.url || "");
      const title = String(item.title || "").slice(0, 200);
      const description = String(item.description || item.desc || "").slice(0, 1000);
      if (!title && !description && !image) return;
      emb.push({ url: url, title: title, description: description, image: image, site: String(item.site || "").slice(0, 80) });
    });
    const rx = [];
    (Array.isArray(m.rx) ? m.rx.slice(0, 20) : []).forEach(function (item) {
      if (!item || typeof item !== "object") return;
      const e = String(item.e || "").slice(0, 32);
      const n = Number(item.n);
      if (!e || /[<>]/.test(e) || !isFinite(n) || n <= 0 || n > 1000000) return;
      rx.push({ e: e, n: Math.round(n), url: "" });
    });
    let reply = null;
    if (m.reply && typeof m.reply === "object") {
      const rid = snowflake(m.reply.id);
      if (rid) reply = { id: rid, author: String(m.reply.author || "").slice(0, 80), content: String(m.reply.content || "").slice(0, 200) };
    }
    const ts = typeof m.ts === "string" ? m.ts.slice(0, 40) : "";
    return {
      ch: ch,
      m: {
        id: id,
        ts: ts,
        edited: !!m.edited,
        author: { id: aid, name: name, avatar: author.avatar ? cdnUrl(author.avatar) : "", color: hexColor(author.color) },
        content: content,
        reply: reply,
        att: att,
        emb: emb,
        rx: rx
      }
    };
  }

  function accept(body) {
    const parsed = validate(body, knownMap());
    if (!parsed) return false;
    const ch = parsed.ch;
    const channel = knownMap()[ch];
    if (parsed.del) {
      if (!channel || channel.mode !== "messages") return true;
      state.deleted[ch] = state.deleted[ch] || {};
      state.deleted[ch][parsed.del] = true;
      state.live[ch] = (state.live[ch] || []).filter(function (row) { return row.id !== parsed.del; });
      return true;
    }
    if (!channel || channel.mode !== "messages") return true;
    const row = fromLive(parsed.m);
    if (!row.date) {
      const ms = snowflakeMs(row.id);
      if (ms) row.date = new Date(ms).toISOString();
    }
    const rows = state.live[ch] || [];
    const at = rows.findIndex(function (item) { return item.id === row.id; });
    if (at >= 0) rows[at] = row;
    else rows.push(row);
    rows.sort(function (a, b) { return cmpId(b.id, a.id); });
    state.live[ch] = rows.slice(0, WINDOW);
    return true;
  }

  function deliver(body) {
    const parsed = validate(body, knownMap());
    if (!parsed || !accept(body)) return;
    if (typeof document === "undefined") return;
    const ch = channelById(parsed.ch);
    const quiet = !!(ch && channelMuted(ch));
    rememberList();
    const log = document.querySelector(".dmsgs-log");
    if (log && state.open === parsed.ch) repaintLog();
    else if (!quiet) updateDots();
    if (!quiet) paintNavBadge();
    restoreList();
  }

  function quote(text) {
    return esc(String(text || "").replace(/[*_`|]/g, "").replace(/\s+/g, " ").trim().slice(0, 140));
  }

  function replyHtml(row, byId) {
    if (!row.replyId && !row.replyText) return "";
    const parent = byId.get(row.replyId);
    const name = row.replyName || (parent && parent.name) || "message";
    const text = row.replyText || (parent && parent.body) || "";
    return '<div class="dmsg-reply"><span class="dmsg-reply-name">' + esc(name) + '</span><span class="dmsg-reply-text">' + quote(text) + "</span></div>";
  }

  function avatarHtml(row) {
    if (row.avatar) return '<img class="dmsg-ava" src="' + esc(row.avatar) + '" alt="" referrerpolicy="no-referrer">';
    return '<span class="dmsg-ava initials" aria-hidden="true">' + esc((row.name || "?").slice(0, 1).toUpperCase()) + "</span>";
  }

  function mediaHtml(row) {
    return (row.attachments || []).map(function (item) {
      const url = cdnUrl(item.url);
      if (!url) return "";
      const dims = (item.w ? ' width="' + item.w + '"' : "") + (item.h ? ' height="' + item.h + '"' : "");
      if (item.type === "video") {
        return '<video class="dmsg-video" controls preload="metadata" src="' + esc(url) + '"' + dims + "></video>";
      }
      const alt = esc(item.alt || "");
      return '<a class="dmsg-shot" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"><img src="' + esc(url) + '" alt="' + alt + '"' + dims + ' referrerpolicy="no-referrer"></a>';
    }).join("");
  }

  function embedHtml(row) {
    return (row.embeds || []).slice(0, 4).map(function (card) {
      if (!card || typeof card !== "object") return "";
      const href = httpUrl(card.url);
      const image = cdnUrl(typeof card.image === "string" ? card.image : "");
      const title = esc(String(card.title || "").slice(0, 200));
      const desc = format(String(card.description || "").slice(0, 1000));
      const site = esc(String(card.site || "").slice(0, 80));
      if (!title && !desc && !image) return "";
      const titleHtml = title ? (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + title + "</a>" : title) : "";
      return '<div class="dmsg-embed">' +
        (site ? '<div class="dmsg-embed-site">' + site + "</div>" : "") +
        (titleHtml ? '<div class="dmsg-embed-title">' + titleHtml + "</div>" : "") +
        (desc ? '<div class="dmsg-embed-desc">' + desc + "</div>" : "") +
        (image ? '<img src="' + esc(image) + '" alt="" referrerpolicy="no-referrer">' : "") +
        "</div>";
    }).join("");
  }

  function reactionHtml(row) {
    const pills = (row.reactions || []).slice(0, 20).map(function (rx) {
      const face = rx.url ? '<img src="' + esc(rx.url) + '" alt="' + esc(rx.e) + '">' : esc(rx.e);
      return '<span class="dmsg-rx">' + face + "<span>" + esc(String(rx.n)) + "</span></span>";
    }).join("");
    return pills ? '<div class="dmsg-rxs">' + pills + "</div>" : "";
  }

  function logInner(channelId) {
    const rows = messagesFor(channelId).slice().reverse();
    if (!rows.length) {
      const waiting = state.loading[channelId] && !state.fixture;
      const title = waiting ? tr("Loading messages") : (state.paused ? tr("Discord paused") : tr("No messages yet"));
      const body = waiting ? tr("Reading the saved transcript.") : (state.paused ? tr("Saved messages stay here. New reads wait until the account can see the server again.") : tr("The next sync reads the latest 50. This view keeps a rolling window of 300."));
      return '<div class="dmsgs-placeholder"><h2>' + title + "</h2><p>" + esc(body) + "</p></div>";
    }
    const byId = new Map();
    rows.forEach(function (row) { byId.set(row.id, row); });
    let prev = null;
    return rows.map(function (row) {
      const fresh = !prev || prev.authorId !== row.authorId || row.replyId || (msgTime(row) - msgTime(prev) > 7 * 60 * 1000) || dayKey(prev) !== dayKey(row);
      const showDay = !prev || dayKey(prev) !== dayKey(row);
      const day = showDay ? '<div class="dmsg-day"><span>' + esc(formatDay(row)) + "</span></div>" : "";
      const color = hexColor(row.color);
      const head = fresh
        ? '<div class="dmsg-head"><span class="dmsg-name"' + (color ? ' style="color:' + color + '"' : "") + ">" + esc(row.name) + '</span><time datetime="' + esc(row.date) + '">' + esc(formatClock(row)) + "</time></div>"
        : "";
      const gutter = fresh ? avatarHtml(row) : "";
      prev = row;
      return day + '<article class="dmsg' + (fresh ? " group" : " cont") + '" data-mid="' + esc(row.id) + '"><div class="dmsg-gutter">' + gutter + "</div>" +
        '<div class="dmsg-body">' + head + replyHtml(row, byId) +
        '<div class="dmsg-bubble"><div class="dmsg-text">' + format(row.body, row.emojis) + (row.edited ? (" <span class=\"dmsg-edited\"" + ">" + tr("(edited)") + "<" + "/span>") : "") + "</div>" +
        mediaHtml(row) + embedHtml(row) + reactionHtml(row) +
        "</div></div></article>";
    }).join("");
  }

  function seenMap() {
    try {
      const raw = JSON.parse(readLocal(SEEN_KEY) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch (err) {
      return {};
    }
  }

  function markSeen(id) {
    const rows = messagesFor(id);
    if (!rows.length) return;
    const map = seenMap();
    map[id] = rows[0].id;
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(map)); } catch (err) { /* private mode can refuse */ }
  }

  function isUnread(id, route) {
    if (route && route.channel === id) return false;
    const rows = messagesFor(id);
    if (!rows.length) return false;
    return cmpId(rows[0].id, seenMap()[id] || "") > 0;
  }

  function listHref() {
    return "#/messages" + (state.fixture ? "?fixture=1" : "");
  }

  function channelHref(id) {
    return "#/messages/discord/" + encodeURIComponent(id) + (state.fixture ? "?fixture=1" : "");
  }

  function emptyPrefs() {
    return { expanded: {}, pinnedServers: [], pinnedChannels: [], mutedServers: [], mutedChannels: [], mutes: {} };
  }

  function cleanIds(list) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach(function (id) {
      const key = snowflake(id);
      if (key && out.indexOf(key) < 0) out.push(key);
    });
    return out.slice(0, 200);
  }

  function loadPrefs() {
    const empty = emptyPrefs();
    try {
      const raw = JSON.parse(readLocal(PREFS_KEY) || "null");
      if (!raw || typeof raw !== "object") return empty;
      const expanded = {};
      if (raw.expanded && typeof raw.expanded === "object") {
        Object.keys(raw.expanded).forEach(function (key) {
          const id = snowflake(key);
          if (id && raw.expanded[key]) expanded[id] = true;
        });
      }
      const mutes = {};
      if (raw.mutes && typeof raw.mutes === "object") {
        Object.keys(raw.mutes).forEach(function (key) {
          const id = snowflake(key);
          const until = Number(raw.mutes[key]);
          if (id && (until === 0 || (isFinite(until) && until > Date.now()))) mutes[id] = until === 0 ? 0 : until;
        });
      }
      cleanIds(raw.mutedChannels).forEach(function (id) {
        if (!Object.prototype.hasOwnProperty.call(mutes, id)) mutes[id] = 0;
      });
      return {
        expanded: expanded,
        pinnedServers: cleanIds(raw.pinnedServers),
        pinnedChannels: cleanIds(raw.pinnedChannels),
        mutedServers: cleanIds(raw.mutedServers),
        mutedChannels: cleanIds(raw.mutedChannels),
        mutes: mutes
      };
    } catch (err) {
      return empty;
    }
  }

  function prefs() {
    if (!state.prefs) state.prefs = loadPrefs();
    return state.prefs;
  }

  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs())); } catch (err) { /* private mode can refuse */ }
  }

  function hasId(list, id) {
    return (list || []).indexOf(id) >= 0;
  }

  function toggleId(list, id) {
    const at = list.indexOf(id);
    if (at >= 0) list.splice(at, 1);
    else list.unshift(id);
  }

  function serverById(id) {
    const key = String(id || "");
    for (let i = 0; i < state.servers.length; i++) {
      if (state.servers[i].id === key) return state.servers[i];
    }
    return null;
  }

  function serverMuted(id) { return hasId(prefs().mutedServers, id); }

  function muteUntil(id) {
    const stored = prefs();
    const table = stored.mutes || {};
    let until = Object.prototype.hasOwnProperty.call(table, id) ? table[id] : null;
    if (until == null && hasId(stored.mutedChannels || [], id)) until = 0;
    if (until == null) return null;
    if (until !== 0 && until <= Date.now()) {
      delete table[id];
      stored.mutes = table;
      if (stored.mutedChannels) stored.mutedChannels = stored.mutedChannels.filter(function (item) { return item !== id; });
      savePrefs();
      return null;
    }
    return until;
  }

  function channelMuted(ch) {
    return !!(ch && (serverMuted(ch.serverId) || muteUntil(ch.id) != null));
  }

  function armMuteTimer() {
    if (state.muteTimer) clearTimeout(state.muteTimer);
    state.muteTimer = 0;
    if (typeof setTimeout !== "function") return;
    let soon = 0;
    const table = prefs().mutes || {};
    const now = Date.now();
    Object.keys(table).forEach(function (id) {
      const until = table[id];
      if (until > now && (!soon || until < soon)) soon = until;
    });
    if (!soon) return;
    state.muteTimer = setTimeout(function () {
      state.muteTimer = 0;
      Object.keys(prefs().mutes || {}).forEach(muteUntil);
      paintNavBadge();
      if (onMessages()) refreshInbox();
      else armMuteTimer();
    }, Math.min(2147483647, Math.max(250, soon - Date.now() + 20)));
  }

  function orderedCategories(channels) {
    const groups = [];
    const index = {};
    channels.forEach(function (ch) {
      const name = ch.category || "";
      const key = name || "\0";
      if (index[key] == null) {
        index[key] = groups.length;
        groups.push({ name: name, channels: [] });
      }
      groups[index[key]].channels.push(ch);
    });
    return groups;
  }

  function messageChannels(server) {
    return (server.channels || []).filter(function (ch) { return ch.mode === "messages" && !ch.inaccessible; });
  }

  function latestMessage(server) {
    let best = null;
    messageChannels(server).forEach(function (ch) {
      const rows = messagesFor(ch.id);
      if (!rows.length) return;
      if (!best || cmpId(rows[0].id, best.row.id) > 0) best = { row: rows[0], channel: ch };
    });
    return best;
  }

  function previewText(row) {
    return String(row && row.body || "").replace(/[*_`~|>]/g, "").replace(/\s+/g, " ").trim().slice(0, 90);
  }

  function formatShort(ms) {
    if (!ms) return "";
    try {
      const date = new Date(ms);
      const now = new Date();
      const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
      return new Intl.DateTimeFormat(undefined, sameDay ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" }).format(date);
    } catch (err) {
      return "";
    }
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "#";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].slice(0, 1) + parts[1].slice(0, 1)).toUpperCase();
  }

  function unreadCount(server, route) {
    if (serverMuted(server.id)) return 0;
    let count = 0;
    messageChannels(server).forEach(function (ch) {
      if (channelMuted(ch)) return;
      if (isUnread(ch.id, route)) count += 1;
    });
    return count;
  }

  function serverOrder() {
    const pinned = [];
    const rest = [];
    state.servers.forEach(function (server) {
      (hasId(prefs().pinnedServers, server.id) ? pinned : rest).push(server);
    });
    pinned.sort(function (a, b) { return prefs().pinnedServers.indexOf(a.id) - prefs().pinnedServers.indexOf(b.id); });
    return pinned.concat(rest);
  }

  function iconSvg(name) {
    if (name === "pin") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3H8v2l1 5-3 3v2h5v6l1 1 1-1v-6h5v-2l-3-3 1-5V3z"/></svg>';
    if (name === "mute") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6V11a6 6 0 0 0-4.2-5.7L4.7 16.4 4 17v1h14.2A2 2 0 0 1 18 16zM5.1 4.3 3.7 5.7 18.3 20.3l1.4-1.4L5.1 4.3z"/></svg>';
    if (name === "more") return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5 15 12 9 17.5"/></svg>';
  }

  function messagesUnread(route) {
    let count = 0;
    state.servers.forEach(function (server) {
      count += unreadCount(server, route || { channel: state.open });
    });
    return count;
  }

  function paintNavBadge() {
    if (typeof document === "undefined") return;
    document.querySelectorAll("a[href='#/messages'] .dmsgs-tab-badge, a[href=\"#/messages\"] .dmsgs-tab-badge").forEach(function (el) { el.remove(); });
    const count = messagesUnread();
    if (!count) return;
    const label = count > 99 ? "99+" : String(count);
    document.querySelectorAll('a[href="#/messages"]').forEach(function (link) {
      const host = link.querySelector(".nav-ico") || link;
      if (host.querySelector(".dmsgs-tab-badge")) return;
      const span = document.createElement("span");
      span.className = "dmsgs-tab-badge";
      span.textContent = label;
      host.appendChild(span);
    });
  }

  function setChannelMute(id, until) {
    const stored = prefs();
    stored.mutes = stored.mutes || {};
    stored.mutes[id] = until;
    stored.mutedChannels = (stored.mutedChannels || []).filter(function (item) { return item !== id; });
    if (until === 0) stored.mutedChannels.unshift(id);
    savePrefs();
    armMuteTimer();
  }

  function clearChannelMute(id) {
    const stored = prefs();
    if (stored.mutes) delete stored.mutes[id];
    stored.mutedChannels = (stored.mutedChannels || []).filter(function (item) { return item !== id; });
    savePrefs();
    armMuteTimer();
  }

  function channelMuteOnly(id) {
    return muteUntil(id) != null;
  }

  function pinsBlocked(ch) {
    if (!ch) return true;
    const file = state.pinFiles[ch.id];
    if (file) return !!file.forbidden;
    return !!ch.pinsForbidden;
  }

  function pinRows(id) {
    const file = state.pinFiles[id];
    let rows = [];
    if (file) rows = file.pins || [];
    else if (state.fixture && FIXTURE_PINS[id]) rows = FIXTURE_PINS[id];
    return rows.slice().sort(function (a, b) { return cmpId(b.id, a.id); });
  }

  function iconButton(kind, id, on, label) {
    const act = (on ? "Unpin " : "Pin ");
    const mute = (on ? "Unmute " : "Mute ");
    const text = (kind.indexOf("mute") === 0 ? mute : act) + label;
    return '<button type="button" class="dmsgs-iconbtn' + (on ? " on" : "") + '" data-discord="' + kind + '" data-id="' + esc(id) + '" aria-pressed="' + (on ? "true" : "false") + '" aria-label="' + esc(text) + '">' + iconSvg(kind.indexOf("mute") === 0 ? "mute" : "pin") + "</button>";
  }

  function channelRow(ch, route, category) {
    const on = route && route.channel === ch.id;
    const muted = channelMuted(ch);
    const unread = !muted && isUnread(ch.id, route);
    const pinned = hasId(prefs().pinnedChannels, ch.id);
    return '<div class="dmsgs-ch-row' + (muted ? " muted" : "") + (pinned ? " pinned" : "") + '">' +
      '<a class="dmsgs-ch' + (on ? " on" : "") + (unread ? " unread" : "") + '" data-ch="' + esc(ch.id) + '" data-name="' + esc(ch.name) + '" data-cat="' + esc(category || ch.category || "") + '" href="' + channelHref(ch.id) + '">' +
      '<span class="dmsgs-hash" aria-hidden="true">#</span><span class="dmsgs-ch-name" title="' + esc(ch.name) + '">' + esc(ch.name) + "</span>" +
      (pinned ? ("<span class=\"dmsgs-pinmark\" " + "aria-label=\"" + tr("Pinned") + "\"" + ">") + iconSvg("pin") + "</span>" : "") +
      (muted ? ("<span class=\"dmsgs-bell\" " + "aria-label=\"" + tr("Muted") + "\"" + ">") + iconSvg("mute") + "</span>" : "") +
      (unread ? ("<span class=\"dmsgs-dot\" " + "aria-label=\"" + tr("Unread") + "\"" + "></span>") : "") +
      "</a>" +
      '<button type="button" class="dmsgs-more" data-discord="menu" data-id="' + esc(ch.id) + ("\" " + "aria-label=\"" + tr("More") + "\"" + ">") + iconSvg("more") + "</button>" +
      "</div>";
  }

  function channelList(server, route) {
    const all = messageChannels(server);
    const pinned = [];
    const rest = [];
    all.forEach(function (ch) { (hasId(prefs().pinnedChannels, ch.id) ? pinned : rest).push(ch); });
    pinned.sort(function (a, b) { return prefs().pinnedChannels.indexOf(a.id) - prefs().pinnedChannels.indexOf(b.id); });
    const pinnedHtml = pinned.map(function (ch) { return channelRow(ch, route, ch.category); }).join("");
    const groups = orderedCategories(rest).map(function (group) {
      const links = group.channels.map(function (ch) { return channelRow(ch, route, group.name); }).join("");
      return (group.name ? '<h2 class="dmsgs-cat" title="' + esc(group.name) + '">' + esc(group.name) + "</h2>" : "") + links;
    }).join("");
    return '<div class="dmsgs-sub">' + pinnedHtml + groups + "</div>";
  }

  function serverBlock(server, route) {
    const open = !!(state.query || prefs().expanded[server.id]);
    const latest = latestMessage(server);
    const count = unreadCount(server, route);
    const muted = serverMuted(server.id);
    const pinned = hasId(prefs().pinnedServers, server.id);
    const preview = state.paused ? tr("Discord paused") : (latest ? (latest.row.name + ": " + previewText(latest.row)) : tr("No messages yet"));
    const time = !state.paused && latest ? formatShort(msgTime(latest.row)) : "";
    const badge = !muted && count ? '<span class="dmsgs-badge" aria-label="' + count + ' unread">' + (count > 99 ? "99+" : String(count)) + "</span>" : "";
    const icon = server.icon
      ? '<img src="' + esc(server.icon) + '" alt="" referrerpolicy="no-referrer">'
      : "<span>" + esc(initials(server.name)) + "</span>";
    return '<section class="dmsgs-srv' + (open ? " open" : "") + (muted ? " muted" : "") + (pinned ? " pinned" : "") + '" data-server="' + esc(server.id) + '" data-name="' + esc(server.name) + '">' +
      '<div class="dmsgs-srv-row">' +
      '<button type="button" class="dmsgs-srv-main" data-discord="toggle" data-server="' + esc(server.id) + '" aria-expanded="' + (open ? "true" : "false") + '">' +
      '<span class="dmsgs-chev" aria-hidden="true">' + iconSvg("chev") + "</span>" +
      '<span class="dmsgs-srv-ico">' + icon + "</span>" +
      '<span class="dmsgs-srv-copy"><span class="dmsgs-srv-top"><b title="' + esc(server.name) + '">' + esc(server.name) + "</b>" + (time ? "<time>" + esc(time) + "</time>" : "") + "</span>" +
      '<span class="dmsgs-srv-preview">' + esc(preview) + "</span></span>" +
      badge +
      "</button>" +
      '<span class="dmsgs-srv-acts">' + iconButton("pin-server", server.id, pinned, "server") + iconButton("mute-server", server.id, muted, "server") + "</span>" +
      "</div>" +
      channelList(server, route) +
      "</section>";
  }

  function listHtml(route) {
    const head = ("<header class=\"dmsgs-head\"><h1" + ">" + tr("Messages") + "<" + "/h1></header>");
    const text = state.channels.filter(function (ch) { return ch.mode === "messages" && !ch.inaccessible; });
    if (!text.length) {
      return head + ("<div class=\"dmsgs-placeholder\"><h2" + ">" + tr("No conversations yet") + "<" + "/h2><p" + ">" + tr("Channels set to messages show up here. None are configured yet.") + "<" + "/p></div>");
    }
    const rows = serverOrder().map(function (server) { return serverBlock(server, route); }).join("");
    const filtering = state.query ? " is-filtering" : "";
    return head +
      '<label class="search dmsgs-search"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 20.3 16.7 16a7.5 7.5 0 1 0-.7.7L20.3 21 21 20.3zM5 10.5a5.5 5.5 0 1 1 11 0 5.5 5.5 0 0 1-11 0z"/></svg>' +
      ("<input id=\"dmsgs-q\" class=\"dmsgs-q\" type=\"search\" " + "placeholder=\"" + tr("Search Direct Messages") + "\"" + " " + "aria-label=\"" + tr("Search Direct Messages") + "\"" + " value=\"") + esc(state.query) + '"></label>' +
      '<div class="dmsgs-channels' + filtering + '">' + rows + "</div>";
  }

  function conversationHtml(route) {
    const id = route && route.channel || "";
    if (!id) {
      return ("<section class=\"dmsgs-conv dmsgs-conv-empty\"><div class=\"dmsgs-placeholder\"><h2" + ">" + tr("Select a message") + "<" + "/h2><p" + ">" + tr("Choose from your existing conversations, or just keep swimming.") + "<" + "/p></div></section>");
    }
    const ch = channelById(id);
    if (!ch) {
      return '<section class="dmsgs-conv"><header class="dmsgs-conv-head"><a class="dmsgs-back" href="' + listHref() + ("\" " + "aria-label=\"" + tr("Back") + "\"" + ">‹</a><div><b" + ">" + tr("Channel") + "<" + "/b></div></header><div class=\"dmsgs-log\"><div class=\"dmsgs-placeholder\"><h2" + ">" + tr("This channel isn’t available") + "<" + "/h2><p" + ">" + tr("It isn’t in the Discord list.") + "<" + "/p></div></div></section>");
    }
    if (ch.mode !== "messages") {
      return '<section class="dmsgs-conv"><header class="dmsgs-conv-head"><a class="dmsgs-back" href="' + listHref() + ("\" " + "aria-label=\"" + tr("Back") + "\"" + ">‹</a><span class=\"dmsgs-hash lg\" aria-hidden=\"true\">#</span><div class=\"dmsgs-conv-title\"><b title=\"") + esc(ch.name) + '">' + esc(ch.name) + '</b><span title="' + esc(ch.category) + '">' + esc(ch.category) + ("</span></div></header><div class=\"dmsgs-log\"><div class=\"dmsgs-placeholder\"><h2" + ">" + tr("Posted on Home") + "<" + "/h2><p" + ">" + tr("Announcement channels are published with the rest of the feed.") + "<" + "/p></div></div></section>");
    }
    const server = serverById(ch.serverId);
    const who = messagesFor(id)[0];
    const face = who && who.avatar
      ? '<span class="dmsgs-head-face"><img src="' + esc(who.avatar) + '" alt="" referrerpolicy="no-referrer"></span>'
      : '<span class="dmsgs-head-face initials" aria-hidden="true">' + esc((ch.name || "?").slice(0, 1).toUpperCase()) + "</span>";
    const pinBtn = pinsBlocked(ch) ? "" : '<button type="button" class="dmsgs-iconbtn dmsgs-pins' + (state.pinsOpen === id ? " on" : "") + '" data-discord="pins" data-id="' + esc(id) + ("\" " + "aria-label=\"" + tr("Pinned messages") + "\"" + " aria-expanded=\"") + (state.pinsOpen === id ? "true" : "false") + '">' + iconSvg("pin") + "</button>";
    const place = (server && server.name) || ch.category || "Discord";
    return '<section class="dmsgs-conv">' +
      '<header class="dmsgs-conv-head"><a class="dmsgs-back" href="' + listHref() + ("\" " + "aria-label=\"" + tr("Back") + "\"" + ">‹</a>") + face + '<div class="dmsgs-conv-title"><b title="' + esc(ch.name) + '">' + esc(ch.name) + '</b><span title="' + esc(place) + '">' + esc(place) + "</span></div>" + pinBtn + "</header>" +
      '<div class="dmsgs-log" tabindex="0">' + logInner(id) + "</div>" +
      pinPanelHtml(id) +
      ("<button type=\"button\" class=\"dmsgs-jump\" hidden" + ">" + tr("Jump to present") + "<" + "/button>") +
      ("<div class=\"dmsgs-compose\"><div class=\"dmsgs-compose-box\" role=\"textbox\" aria-disabled=\"true\" " + "aria-label=\"" + tr("Read-only channel") + "\"" + "><span" + ">" + tr("Read-only channel") + "<" + "/span></div></div>") +
      "</section>";
  }

  function pinPanelHtml(id) {
    if (state.pinsOpen !== id) return "";
    const ch = channelById(id);
    if (!ch || pinsBlocked(ch)) return "";
    const rows = pinRows(id);
    const waiting = !state.fixture && !state.pinFiles[id];
    let body = "";
    if (waiting) body = ("<p class=\"dmsgs-pinempty\"" + ">" + tr("Loading pinned messages") + "<" + "/p>");
    else if (!rows.length) body = ("<p class=\"dmsgs-pinempty\"" + ">" + tr("No pinned messages") + "<" + "/p>");
    else body = rows.map(function (row) {
      const when = formatClock({ id: row.id, date: row.date });
      return '<button type="button" class="dmsgs-pinrow" data-discord="jump" data-mid="' + esc(row.id) + '">' +
        '<span class="dmsgs-pinrow-top"><b>' + esc(row.author || tr("Someone")) + "</b>" + (when ? "<time>" + esc(when) + "</time>" : "") + "</span>" +
        '<span class="dmsgs-pinrow-text">' + esc(row.text || tr("Pinned message")) + "</span></button>";
    }).join("");
    return ("<div class=\"dmsgs-pinpanel\" role=\"dialog\" " + "aria-label=\"" + tr("Pinned messages") + "\"" + ">") +
      ("<header class=\"dmsgs-pinhead\"><span class=\"dmsgs-grab\" aria-hidden=\"true\"></span><b" + ">" + tr("Pinned messages") + "<" + "/b><button type=\"button\" class=\"dmsgs-iconbtn\" data-discord=\"pins-close\" " + "aria-label=\"" + tr("Close") + "\"" + ">×</button></header>") +
      '<div class="dmsgs-pinlist">' + body + "</div></div>";
  }

  function menuHtml() {
    const menu = state.menu;
    if (!menu || !menu.id) return "";
    const ch = channelById(menu.id);
    if (!ch) return "";
    const pinned = hasId(prefs().pinnedChannels, ch.id);
    const muted = channelMuteOnly(ch.id);
    let items = "";
    if (menu.durations) {
      items = ("<div class=\"dmsgs-menu-title\"" + ">" + tr("Mute channel") + "<" + "/div>") + MUTE_CHOICES.map(function (choice) {
        return '<button type="button" role="menuitem" data-discord="mute-for" data-id="' + esc(ch.id) + '" data-ms="' + choice.ms + '">' + esc(choice.label) + "</button>";
      }).join("");
    } else {
      items = '<button type="button" role="menuitem" data-discord="pin-channel" data-id="' + esc(ch.id) + '"><span class="dmsgs-mi">' + iconSvg("pin") + "</span>" + (pinned ? tr("Unpin channel") : tr("Pin channel")) + "</button>" +
        (muted
          ? '<button type="button" role="menuitem" data-discord="unmute-channel" data-id="' + esc(ch.id) + '"><span class="dmsgs-mi">' + iconSvg("mute") + ("</span" + ">" + tr("Unmute channel") + "<" + "/button>")
          : '<button type="button" role="menuitem" data-discord="mute-menu" data-id="' + esc(ch.id) + '"><span class="dmsgs-mi">' + iconSvg("mute") + ("</span" + ">" + tr("Mute channel") + "<" + "/button>"));
    }
    const x = Math.round(Number(menu.x) || 16);
    const y = Math.round(Number(menu.y) || 16);
    return ("<button type=\"button\" class=\"dmsgs-scrim\" data-discord=\"menu-close\" " + "aria-label=\"" + tr("Close menu") + "\"" + "></button>") +
      '<div class="dmsgs-menu" role="menu" style="left:' + x + 'px;top:' + y + 'px"><span class="dmsgs-grab" aria-hidden="true"></span>' + items + "</div>";
  }

  function page(route) {
    state.fixture = !!(route && route.query && typeof route.query.get === "function" && route.query.get("fixture") === "1");
    if (state.fixture && !state.holdServers) {
      const kept = {};
      state.channels.forEach(function (ch) {
        if (ch.pinsForbidden || ch.inaccessible) kept[ch.id] = { pinsForbidden: !!ch.pinsForbidden, inaccessible: !!ch.inaccessible };
      });
      adoptServers(CATALOG_SERVERS);
      state.channels.forEach(function (ch) {
        const prev = kept[ch.id];
        if (!prev) return;
        if (prev.pinsForbidden) ch.pinsForbidden = true;
        if (prev.inaccessible) ch.inaccessible = true;
      });
    }
    ensureLoad();
    const id = route && snowflake(route.channel);
    if (id && !state.fixture) {
      ensureChannel(id);
      ensurePins(id);
    }
    const open = id ? " has-channel" : "";
    return '<div class="dmsgs' + open + '" data-discord-root>' +
      '<aside class="dmsgs-list" id="dmsgs-list">' + listHtml(route) +
      ("<div class=\"dmsgs-split\" role=\"separator\" tabindex=\"0\" aria-orientation=\"vertical\" " + "aria-label=\"" + tr("Resize message list") + "\"" + " aria-controls=\"dmsgs-list\" aria-valuemin=\"300\" aria-valuemax=\"440\" aria-valuenow=\"440\"></div></aside>") +
      conversationHtml(route) +
      menuHtml() +
      "</div>";
  }

  function titleFor(route) {
    if (!route || route.name !== "messages" || !route.channel) return "";
    const ch = channelById(route.channel);
    return ch ? "#" + ch.name : "";
  }

  function nearBottom(log) {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  }

  function onScroll() {
    const log = document.querySelector(".dmsgs-log");
    if (!log || state.scrollLock) return;
    const near = nearBottom(log);
    state.stick = near;
    const jump = document.querySelector(".dmsgs-jump");
    if (jump) jump.hidden = near;
    if (state.open) writeScroll("log:" + state.open, log.scrollTop);
    if (near && state.open) {
      markSeen(state.open);
      updateDots();
    }
  }

  function repaintLog() {
    const log = document.querySelector(".dmsgs-log");
    if (!log || !state.open) return;
    const list = listEl();
    const listTop = list ? list.scrollTop : 0;
    const near = nearBottom(log) || state.stick;
    const rows = messagesFor(state.open).slice().reverse();
    const have = Array.prototype.map.call(log.querySelectorAll(".dmsg[data-mid]"), function (el) { return el.getAttribute("data-mid"); });
    const want = rows.map(function (row) { return row.id; });
    const same = have.join(",") === want.join(",");
    if (!same) log.innerHTML = logInner(state.open);
    state.scrollLock = true;
    if (near) {
      log.scrollTop = log.scrollHeight;
      markSeen(state.open);
    }
    if (list && Math.abs(list.scrollTop - listTop) > 1) list.scrollTop = listTop;
    state.scrollLock = false;
    if (state.open) writeScroll("log:" + state.open, log.scrollTop);
    const jump = document.querySelector(".dmsgs-jump");
    if (jump) jump.hidden = near;
    updateDots();
  }

  function updateDots() {
    if (typeof document === "undefined") return;
    document.querySelectorAll(".dmsgs-ch").forEach(function (el) {
      const id = el.getAttribute("data-ch");
      const ch = channelById(id);
      const unread = ch && !channelMuted(ch) && isUnread(id, { channel: state.open });
      el.classList.toggle("unread", unread);
      let dot = el.querySelector(".dmsgs-dot");
      if (unread && !dot) {
        dot = document.createElement("span");
        dot.className = "dmsgs-dot";
        dot.setAttribute("aria-label", tr("Unread"));
        el.appendChild(dot);
      } else if (!unread && dot) {
        dot.remove();
      }
    });
    document.querySelectorAll(".dmsgs-srv").forEach(function (srv) {
      const server = serverById(srv.getAttribute("data-server"));
      if (!server) return;
      const count = unreadCount(server, { channel: state.open });
      let badge = srv.querySelector(".dmsgs-badge");
      if (!serverMuted(server.id) && count) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "dmsgs-badge";
          const main = srv.querySelector(".dmsgs-srv-main");
          if (main) main.appendChild(badge);
        }
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.setAttribute("aria-label", count + " unread");
      } else if (badge) {
        badge.remove();
      }
      const latest = latestMessage(server);
      const preview = srv.querySelector(".dmsgs-srv-preview");
      if (preview) {
        preview.textContent = state.paused ? tr("Discord paused") : (latest ? (latest.row.name + ": " + previewText(latest.row)) : tr("No messages yet"));
      }
    });
    paintNavBadge();
  }

  function applyFilter() {
    if (typeof document === "undefined") return;
    const q = String(state.query || "").trim().toLowerCase();
    const host = document.querySelector(".dmsgs-channels");
    if (host) host.classList.toggle("is-filtering", !!q);
    document.querySelectorAll(".dmsgs-srv").forEach(function (srv) {
      const serverName = (srv.getAttribute("data-name") || "").toLowerCase();
      const serverMatch = !q || serverName.indexOf(q) >= 0;
      let any = serverMatch;
      srv.querySelectorAll(".dmsgs-ch-row").forEach(function (row) {
        const link = row.querySelector(".dmsgs-ch");
        const name = (link && link.getAttribute("data-name") || "").toLowerCase();
        const cat = (link && link.getAttribute("data-cat") || "").toLowerCase();
        const match = serverMatch || name.indexOf(q) >= 0 || cat.indexOf(q) >= 0;
        row.hidden = !!(q && !match);
        if (match) any = true;
      });
      srv.querySelectorAll(".dmsgs-cat").forEach(function (el) {
        let visible = false;
        let node = el.nextElementSibling;
        while (node && !node.classList.contains("dmsgs-cat") && !node.classList.contains("dmsgs-srv")) {
          if (node.classList.contains("dmsgs-ch-row") && !node.hidden) visible = true;
          node = node.nextElementSibling;
        }
        el.hidden = !visible;
      });
      srv.hidden = !any;
    });
  }

  function scrollMap() {
    try {
      const raw = JSON.parse(readStore(sessionStorage, SCROLL_KEY) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch (err) {
      return {};
    }
  }

  function writeScroll(key, value) {
    if (!key) return;
    const map = scrollMap();
    const n = Math.max(0, Math.round(Number(value) || 0));
    map[String(key).slice(0, 80)] = n;
    try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify(map)); } catch (err) { /* private mode can refuse */ }
  }

  function readScroll(key) {
    const n = Number(scrollMap()[key]);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function listEl() {
    return typeof document === "undefined" ? null : document.querySelector(".dmsgs-channels");
  }

  function logEl() {
    return typeof document === "undefined" ? null : document.querySelector(".dmsgs-log");
  }

  function rememberList() {
    const list = listEl();
    if (!list || state.scrollLock) return;
    if (state.holding && list.scrollTop < 2 && state.listHold > 20) return;
    state.listHold = list.scrollTop;
    writeScroll("list", list.scrollTop);
    const open = document.querySelector(".dmsgs-srv.open");
    const sid = open && open.getAttribute("data-server");
    if (sid) writeScroll("server:" + sid, list.scrollTop);
  }

  function restoreList() {
    const list = listEl();
    if (!list) return;
    const y = state.listHold != null ? state.listHold : readScroll("list");
    state.scrollLock = true;
    if (Math.abs(list.scrollTop - y) > 1) list.scrollTop = y;
    state.scrollLock = false;
    writeScroll("list", y);
  }

  function listHidden() {
    const list = listEl();
    return !!(list && list.offsetParent === null);
  }

  function rememberWindow() {
    try {
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      if (state.holding && y < 2 && state.winHold > 20) return;
      state.winHold = y;
      writeScroll("window", y);
    } catch (err) { /* no window */ }
  }

  function restoreWindow() {
    const y = state.winHold != null ? state.winHold : readScroll("window");
    try {
      if (Math.abs((window.scrollY || 0) - y) > 1) window.scrollTo(0, y);
    } catch (err) { /* ignore */ }
  }

  function bindList() {
    const list = listEl();
    if (!list || list.dataset.bound === "1") return;
    list.dataset.bound = "1";
    list.addEventListener("scroll", function () {
      if (state.scrollLock) return;
      rememberList();
    }, { passive: true });
  }

  function bindLog(log) {
    const node = log || logEl();
    if (!node || node.dataset.bound === "1") return;
    node.dataset.bound = "1";
    node.addEventListener("scroll", onScroll, { passive: true });
  }

  function routeFromLocation() {
    let hash = "#/messages";
    try { hash = location.hash || "#/messages"; } catch (err) { /* node tests have no location */ }
    const cut = hash.indexOf("?");
    const path = (cut >= 0 ? hash.slice(0, cut) : hash).replace(/^#/, "");
    const query = new URLSearchParams(cut >= 0 ? hash.slice(cut + 1) : "");
    const parts = path.split("/").filter(Boolean);
    const channel = parts[0] === "messages" && parts[1] === "discord" ? (parts[2] || "") : "";
    return { name: "messages", channel: channel, query: query };
  }

  function placeLog(toNewest) {
    const log = logEl();
    if (!log || !state.open) return;
    state.scrollLock = true;
    if (toNewest) {
      log.scrollTop = log.scrollHeight;
      state.stick = true;
      markSeen(state.open);
    } else if (state.stick) {
      log.scrollTop = log.scrollHeight;
    } else {
      log.scrollTop = readScroll("log:" + state.open) || log.scrollHeight;
    }
    state.scrollLock = false;
    writeScroll("log:" + state.open, log.scrollTop);
    const jump = document.querySelector(".dmsgs-jump");
    if (jump) jump.hidden = !!state.stick;
  }

  function scrollLogToMessage(target) {
    const log = logEl();
    if (!log || !target) return;
    const logBox = log.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    state.scrollLock = true;
    log.scrollTop = Math.max(0, log.scrollTop + (box.top - logBox.top) - (log.clientHeight - box.height) / 2);
    state.scrollLock = false;
    state.stick = false;
    writeScroll("log:" + state.open, log.scrollTop);
    target.classList.add("dmsg-flash");
    const jump = document.querySelector(".dmsgs-jump");
    if (jump) jump.hidden = false;
  }

  function markActive() {
    const id = state.open || "";
    document.querySelectorAll(".dmsgs-ch").forEach(function (el) {
      el.classList.toggle("on", el.getAttribute("data-ch") === id);
    });
  }

  function replaceConv(toNewest) {
    const root = document.querySelector("[data-discord-root]");
    const conv = root && root.querySelector(".dmsgs-conv");
    if (!conv) return false;
    const previous = logEl();
    if (previous && state.open && !toNewest) writeScroll("log:" + state.open, previous.scrollTop);
    rememberList();
    conv.outerHTML = conversationHtml(routeFromLocation());
    const host = document.querySelector("[data-discord-root]");
    if (host) host.classList.toggle("has-channel", !!state.open);
    bindLog();
    placeLog(!!toNewest);
    restoreList();
    return true;
  }

  function repaintChannels() {
    const host = listEl();
    if (!host) return false;
    rememberList();
    const y = state.listHold != null ? state.listHold : host.scrollTop;
    host.innerHTML = serverOrder().map(function (server) { return serverBlock(server, routeFromLocation()); }).join("");
    state.scrollLock = true;
    host.scrollTop = y;
    state.scrollLock = false;
    state.listHold = host.scrollTop;
    writeScroll("list", host.scrollTop);
    bindList();
    applyFilter();
    return true;
  }

  function repaintMenu() {
    const root = document.querySelector("[data-discord-root]");
    if (!root) return false;
    root.querySelectorAll(".dmsgs-scrim, .dmsgs-menu").forEach(function (el) {
      if (el.parentNode === root) el.remove();
    });
    if (state.menu) root.insertAdjacentHTML("beforeend", menuHtml());
    return true;
  }

  function refreshInbox() {
    if (typeof document === "undefined" || !document.querySelector("[data-discord-root]")) {
      if (onMessages() && hooks().render) hooks().render();
      return;
    }
    state.holding = true;
    rememberList();
    rememberWindow();
    repaintChannels();
    if (state.open) replaceConv(false);
    repaintMenu();
    restoreList();
    restoreWindow();
    state.holding = false;
  }

  function releaseHold() {
    if (listHidden()) return;
    state.holding = false;
    state.listHold = null;
  }

  function syncFromHash() {
    const route = routeFromLocation();
    state.fixture = !!(route.query && typeof route.query.get === "function" && route.query.get("fixture") === "1");
    const id = snowflake(route.channel);
    const changed = state.open !== id;
    state.open = id;
    if (changed) {
      state.stick = true;
      state.menu = null;
      state.pinsOpen = "";
    }
    const root = document.querySelector("[data-discord-root]");
    if (!root) {
      if (hooks().render) hooks().render();
      return;
    }
    state.holding = true;
    rememberList();
    root.classList.toggle("has-channel", !!id);
    markActive();
    replaceConv(changed);
    repaintMenu();
    updateDots();
    if (id && !state.fixture) {
      ensureChannel(id);
      ensurePins(id);
    }
    restoreList();
    restoreWindow();
    try {
      const title = titleFor(route);
      document.title = (title || tr("Messages")) + " / " + productName("app");
    } catch (err) { /* ignore */ }
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(function () {
        restoreList();
        restoreWindow();
        releaseHold();
      });
    } else releaseHold();
  }

  function followHash(href) {
    const next = href || "#/messages";
    let here = "";
    try { here = location.hash || "#/"; } catch (err) {}
    if (here !== next) {
      try { history.pushState(null, "", next); }
      catch (err) {
        try { location.hash = next; return; } catch (e2) { /* ignore */ }
      }
    }
    if (hooks().noteHash) hooks().noteHash(next);
    if (hooks().stay) hooks().stay();
    syncFromHash();
  }

  function bindSplit() {
    if (typeof document === "undefined" || !root.FeedsSplit) return;
    const split = document.querySelector(".dmsgs-split");
    if (!split) return;
    root.FeedsSplit.bind(split, root.FeedsSplit.messages, document.querySelector(".dmsgs"));
  }

  function mount(route) {
    const messages = route && route.name === "messages";
    if (!messages) {
      state.open = "";
      state.menu = null;
      state.pinsOpen = "";
      refreshLive();
      paintNavBadge();
      armMuteTimer();
      return;
    }
    const channel = snowflake(route.channel);
    if (state.open !== channel) {
      state.open = channel;
      state.stick = true;
    }
    bindList();
    bindLog();
    bindSplit();
    const list = listEl();
    if (list) {
      const y = state.listHold != null ? state.listHold : readScroll("list");
      state.scrollLock = true;
      list.scrollTop = y;
      state.scrollLock = false;
      state.listHold = list.scrollTop;
    }
    const log = logEl();
    if (state.jump) {
      const target = document.querySelector('.dmsg[data-mid="' + state.jump + '"]');
      if (target) scrollLogToMessage(target);
      else if (log) log.scrollTop = log.scrollHeight;
      state.jump = "";
    } else if (log && state.open) {
      state.scrollLock = true;
      log.scrollTop = state.stick ? log.scrollHeight : (readScroll("log:" + state.open) || log.scrollHeight);
      state.scrollLock = false;
      if (state.stick) markSeen(state.open);
    }
    applyFilter();
    const jump = document.querySelector(".dmsgs-jump");
    if (jump) jump.hidden = state.stick;
    restoreWindow();
    paintNavBadge();
    armMuteTimer();
    refreshLive();
  }

  function topicOk(value) {
    const text = String(value || "").trim();
    return /^[A-Za-z0-9_-]{8,80}$/.test(text) ? text : "";
  }

  function liveTopic() {
    return state.topic || TOPIC;
  }

  function applyConfig(servers) {
    (servers || []).forEach(function (server) {
      const topic = topicOk(server && server.ntfy);
      if (topic) state.topic = topic;
    });
    const kept = {};
    state.channels.forEach(function (ch) { kept[ch.id] = !!ch.inaccessible; });
    if (!adoptServers(servers)) return;
    state.channels.forEach(function (ch) { if (kept[ch.id]) ch.inaccessible = true; });
  }

  function applyIndex(index) {
    const status = index && index.status;
    state.paused = status === "unauthorized" || status === "forbidden" || status === "captcha" || status === "verification";
    const byId = {};
    state.channels.forEach(function (ch) { byId[ch.id] = ch; });
    const byServer = {};
    state.servers.forEach(function (server) { byServer[server.id] = server; });
    ((index && index.servers) || []).forEach(function (server) {
      const row = byServer[snowflake(server && server.id)];
      const icon = cdnUrl(server && server.icon);
      if (row && icon) row.icon = icon;
      if (row && server && server.name) row.name = String(server.name).slice(0, 80);
      if (icon) state.icon = icon;
      if (server && server.name) state.serverName = String(server.name).slice(0, 80);
      ((server && server.channels) || []).forEach(function (ch) {
        const channel = byId[snowflake(ch && ch.id)];
        if (!channel) return;
        if (ch.name) channel.name = String(ch.name).slice(0, 80);
        if (ch.category) channel.category = String(ch.category).slice(0, 80);
        if (ch.file && /^discord\/messages\/\d{1,22}\.json$/.test(ch.file)) channel.file = ch.file;
        channel.inaccessible = !!ch.inaccessible;
        channel.pinsForbidden = !!ch.pinsForbidden;
      });
    });
  }

  function ensurePins(id) {
    const ch = channelById(id);
    if (!ch || ch.mode !== "messages" || state.fixture || state.pinFiles[id] || state.pinLoading[id]) return;
    if (typeof fetch !== "function") return;
    state.pinLoading[id] = true;
    fetch("discord/pins/" + id + ".json", { cache: "no-cache" }).then(function (res) {
      return res && res.ok ? res.json() : { pins: [] };
    }).then(function (doc) {
      const forbidden = !!(doc && doc.forbidden);
      const pins = [];
      ((doc && doc.pins) || []).forEach(function (row) {
        const mid = snowflake(row && row.id);
        if (!mid) return;
        pins.push({
          id: mid,
          author: String((row && row.author) || tr("Someone")).slice(0, 80),
          text: String((row && row.text) || "").slice(0, 180),
          date: String((row && row.date) || "").slice(0, 40)
        });
      });
      pins.sort(function (a, b) { return cmpId(b.id, a.id); });
      state.pinFiles[id] = { forbidden: forbidden, pins: pins };
      if (ch) ch.pinsForbidden = forbidden;
    }).catch(function () {
      state.pinFiles[id] = { forbidden: false, pins: [] };
    }).then(function () {
      state.pinLoading[id] = false;
      if (state.open === id || state.pinsOpen === id) {
        rememberList();
        replaceConv(false);
        restoreList();
      }
    });
  }

  function ensureChannel(id) {
    const ch = channelById(id);
    if (!ch || ch.mode !== "messages" || state.files[id] || state.loading[id]) return;
    if (typeof fetch !== "function") return;
    state.loading[id] = true;
    fetch(ch.file || ("discord/messages/" + id + ".json"), { cache: "no-cache" }).then(function (res) {
      return res && res.ok ? res.json() : null;
    }).then(function (doc) {
      state.files[id] = doc && typeof doc === "object" ? doc : { messages: [], authors: {} };
    }).catch(function () {
      state.files[id] = { messages: [], authors: {} };
    }).then(function () {
      state.loading[id] = false;
      if (state.open !== id) return;
      rememberList();
      repaintLog();
      bindLog();
      restoreList();
    });
  }

  function ensureLoad() {
    if (state.fixture || state.loadStarted) return;
    state.loadStarted = true;
    if (typeof fetch !== "function") return;
    let pending;
    try { pending = fetch("feeds.config.json", { cache: "no-cache" }); }
    catch (err) { return; }
    pending.then(function (res) { return res && res.ok ? res.json() : null; }).then(function (doc) {
      if (doc && Array.isArray(doc.discord)) applyConfig(doc.discord);
      let index;
      try { index = fetch("discord/index.json", { cache: "no-cache" }); }
      catch (err) { index = Promise.resolve(null); }
      return index.then(function (res) { return res && res.ok ? res.json() : null; }).catch(function () { return null; });
    }).then(function (index) {
      if (index) applyIndex(index);
      if (onMessages()) refreshInbox();
    }).catch(function () {});
  }

  function onMessages() {
    try { return /^#\/messages(?:\/|\?|$)/.test(location.hash || ""); }
    catch (err) { return false; }
  }

  function wantLive() {
    if (typeof document === "undefined") return false;
    return document.visibilityState === "visible";
  }

  function closeSse() {
    if (state.source) {
      state.source.close();
      state.source = null;
    }
  }

  function stopLive() {
    closeSse();
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = 0;
    }
  }

  function ensureSince() {
    if (!state.since) state.since = String(Math.floor(Date.now() / 1000));
  }

  function handleNtfy(raw) {
    if (typeof raw !== "string" || raw.length > 20000) return;
    let note;
    try { note = JSON.parse(raw); }
    catch (err) { return; }
    if (!note || typeof note !== "object") return;
    if (note.topic && note.topic !== liveTopic()) return;
    if (note.id) state.since = String(note.id);
    if (note.event && note.event !== "message") return;
    if (typeof note.message !== "string" || note.message.length > 12000) return;
    let body;
    try { body = JSON.parse(note.message); }
    catch (err) { return; }
    deliver(body);
  }

  function schedulePoll() {
    if (state.timer || !wantLive()) return;
    const wait = state.backoff;
    state.backoff = Math.min(30000, state.backoff * 2);
    state.timer = setTimeout(poll, wait);
  }

  function poll() {
    state.timer = 0;
    if (!wantLive()) return;
    ensureSince();
    fetch("https://ntfy.sh/" + liveTopic() + "/json?poll=1&since=" + encodeURIComponent(state.since), { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error(String(res.status));
      return res.text();
    }).then(function (text) {
      String(text || "").split("\n").forEach(function (line) {
        if (line.trim()) handleNtfy(line.trim());
      });
      state.backoff = 1500;
      if (wantLive()) openSse();
    }).catch(function () {
      schedulePoll();
    });
  }

  function openSse() {
    if (!wantLive() || state.source || state.timer) return;
    ensureSince();
    let es;
    try {
      es = new EventSource("https://ntfy.sh/" + liveTopic() + "/sse?since=" + encodeURIComponent(state.since));
    } catch (err) {
      schedulePoll();
      return;
    }
    state.source = es;
    es.addEventListener("message", function (event) {
      state.backoff = 1500;
      handleNtfy(event.data);
    });
    es.onerror = function () {
      closeSse();
      schedulePoll();
    };
  }

  function refreshLive() {
    if (wantLive()) openSse();
    else stopLive();
  }

  function clearHold() {
    if (state.hold) clearTimeout(state.hold);
    state.hold = 0;
  }

  function pageZoom() {
    try {
      if (typeof getComputedStyle !== "function" || !document.body) return 1;
      const z = parseFloat(getComputedStyle(document.body).zoom);
      return isFinite(z) && z > 0 ? z : 1;
    } catch (err) {
      return 1;
    }
  }

  function openMenu(id, x, y, durations) {
    const z = pageZoom();
    state.menu = { id: id, durations: !!durations, x: x / z, y: y / z };
    state.pinsOpen = "";
    if (!repaintMenu() && hooks().render) hooks().render();
    nudgeMenu();
  }

  function nudgeMenu() {
    const menu = document.querySelector(".dmsgs-menu");
    if (!menu) return;
    try {
      if (window.matchMedia && window.matchMedia("(max-width: 699px)").matches) return;
    } catch (err) { /* keep the pointer position */ }
    const z = pageZoom();
    const box = menu.getBoundingClientRect();
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    let dx = 0;
    let dy = 0;
    if (box.right > vw - 8) dx = vw - 8 - box.right;
    if (box.left + dx < 8) dx += 8 - (box.left + dx);
    if (box.bottom > vh - 8) dy = vh - 8 - box.bottom;
    if (box.top + dy < 8) dy += 8 - (box.top + dy);
    if (!dx && !dy) return;
    const left = (parseFloat(menu.style.left) || 0) + dx / z;
    const top = (parseFloat(menu.style.top) || 0) + dy / z;
    menu.style.left = Math.round(left) + "px";
    menu.style.top = Math.round(top) + "px";
    if (state.menu) {
      state.menu.x = left;
      state.menu.y = top;
    }
  }

  function start() {
    if (state.started) return;
    state.started = true;
    if (typeof document === "undefined") return;
    document.addEventListener("visibilitychange", refreshLive);
    document.addEventListener("input", function (event) {
      const input = event.target;
      if (!input || !input.classList || !input.classList.contains("dmsgs-q")) return;
      state.query = input.value || "";
      applyFilter();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      if (!state.menu && !state.pinsOpen) return;
      state.menu = null;
      state.pinsOpen = "";
      if (hooks().render) hooks().render();
    });
    document.addEventListener("contextmenu", function (event) {
      const row = event.target && event.target.closest && event.target.closest(".dmsgs-ch-row");
      if (!row) return;
      const link = row.querySelector(".dmsgs-ch");
      const id = link && snowflake(link.getAttribute("data-ch"));
      if (!id) return;
      event.preventDefault();
      openMenu(id, event.clientX, event.clientY, false);
    });
    document.addEventListener("touchstart", function (event) {
      const row = event.target && event.target.closest && event.target.closest(".dmsgs-ch-row");
      if (!row || (event.target.closest && event.target.closest(".dmsgs-more"))) return;
      const link = row.querySelector(".dmsgs-ch");
      const id = link && snowflake(link.getAttribute("data-ch"));
      const touch = event.touches && event.touches[0];
      if (!id || !touch) return;
      const x = touch.clientX;
      const y = touch.clientY;
      clearHold();
      state.hold = setTimeout(function () {
        state.hold = 0;
        state.suppressClick = id;
        openMenu(id, x, y, false);
      }, 500);
    }, { passive: true });
    document.addEventListener("touchend", clearHold);
    document.addEventListener("touchmove", clearHold);
    document.addEventListener("touchcancel", clearHold);
    document.addEventListener("mousedown", function (event) {
      if (event.button !== 0) return;
      const el = event.target && event.target.closest && event.target.closest(".dmsgs-channels button");
      if (!el) return;
      event.preventDefault();
    }, true);
    document.addEventListener("click", function (event) {
      const nav = event.target && event.target.closest && event.target.closest("a.dmsgs-ch, a.dmsgs-back");
      if (nav && nav.closest("[data-discord-root]")) {
        if (state.suppressClick && nav.classList.contains("dmsgs-ch") && nav.getAttribute("data-ch") === state.suppressClick) {
          state.suppressClick = "";
          event.preventDefault();
          return;
        }
        event.preventDefault();
        state.holding = true;
        rememberList();
        rememberWindow();
        followHash(nav.getAttribute("href"));
        return;
      }
      if (state.suppressClick) state.suppressClick = "";
      const jump = event.target && event.target.closest && event.target.closest(".dmsgs-jump");
      if (jump) {
        const log = document.querySelector(".dmsgs-log");
        if (!log) return;
        log.scrollTop = log.scrollHeight;
        state.stick = true;
        jump.hidden = true;
        if (state.open) markSeen(state.open);
        updateDots();
        return;
      }
      const btn = event.target && event.target.closest && event.target.closest("[data-discord]");
      if (!btn) {
        if ((state.menu || state.pinsOpen) && !(event.target && event.target.closest && event.target.closest(".dmsgs-menu, .dmsgs-pinpanel"))) {
          const pins = state.pinsOpen;
          state.menu = null;
          state.pinsOpen = "";
          repaintMenu();
          if (pins) replaceConv(false);
        }
        return;
      }
      const kind = btn.getAttribute("data-discord");
      if (kind === "menu-close" || kind === "pins-close") {
        event.preventDefault();
        if (kind === "menu-close") state.menu = null;
        else state.pinsOpen = "";
        repaintMenu();
        if (kind === "pins-close") replaceConv(false);
        return;
      }
      if (kind === "jump") {
        event.preventDefault();
        state.jump = snowflake(btn.getAttribute("data-mid"));
        state.pinsOpen = "";
        replaceConv(false);
        const target = state.jump && document.querySelector('.dmsg[data-mid="' + state.jump + '"]');
        state.jump = "";
        if (target) scrollLogToMessage(target);
        restoreList();
        return;
      }
      const id = snowflake(btn.getAttribute("data-id") || btn.getAttribute("data-server"));
      if (!id) return;
      event.preventDefault();
      const stored = prefs();
      if (kind === "toggle") {
        const willOpen = !stored.expanded[id];
        const list = listEl();
        if (!willOpen && list) {
          state.listHold = list.scrollTop;
          writeScroll("list", list.scrollTop);
          writeScroll("server:" + id, list.scrollTop);
        }
        if (stored.expanded[id]) delete stored.expanded[id];
        else stored.expanded[id] = true;
        savePrefs();
        const section = document.querySelector('.dmsgs-srv[data-server="' + id + '"]');
        if (section) {
          const open = !!(stored.expanded[id] || state.query);
          state.scrollLock = true;
          state.holding = true;
          section.classList.toggle("open", open);
          const main = section.querySelector(".dmsgs-srv-main");
          if (main) main.setAttribute("aria-expanded", open ? "true" : "false");
          if (open) restoreList();
          state.scrollLock = false;
          if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(function () {
              if (stored.expanded[id] || state.query) restoreList();
              else state.holding = false;
            });
          } else if (!open) state.holding = false;
        } else if (!repaintChannels() && hooks().render) hooks().render();
        return;
      } else if (kind === "pin-server") {
        toggleId(stored.pinnedServers, id);
        savePrefs();
      } else if (kind === "mute-server") {
        toggleId(stored.mutedServers, id);
        savePrefs();
      } else if (kind === "menu") {
        const rect = btn.getBoundingClientRect ? btn.getBoundingClientRect() : { left: 16, bottom: 64 };
        openMenu(id, rect.left, rect.bottom + 4, false);
        return;
      } else if (kind === "pin-channel") {
        toggleId(stored.pinnedChannels, id);
        state.menu = null;
        savePrefs();
      } else if (kind === "mute-menu") {
        if (!state.menu) state.menu = { id: id, durations: true, x: 16, y: 64 };
        else { state.menu.durations = true; state.menu.id = id; }
      } else if (kind === "mute-for") {
        const ms = Number(btn.getAttribute("data-ms"));
        if (ms === 0 || (isFinite(ms) && ms > 0)) setChannelMute(id, ms === 0 ? 0 : Date.now() + ms);
        state.menu = null;
      } else if (kind === "unmute-channel") {
        clearChannelMute(id);
        state.menu = null;
      } else if (kind === "pins") {
        state.pinsOpen = state.pinsOpen === id ? "" : id;
        state.menu = null;
        if (state.pinsOpen) ensurePins(id);
      } else {
        return;
      }
      paintNavBadge();
      rememberList();
      if (!repaintChannels()) {
        if (hooks().render) hooks().render();
        return;
      }
      if (kind === "pins") replaceConv(false);
      repaintMenu();
      restoreList();
    });
    armMuteTimer();
    paintNavBadge();
    refreshLive();
  }

  function bind(next) { state.bound = next || null; }

  root.FeedsDiscord = {
    bind: bind,
    start: start,
    page: page,
    titleFor: titleFor,
    mount: mount,
    _validate: validate,
    _format: format,
    _accept: accept,
    _ids: function (channelId) { return messagesFor(channelId).map(function (row) { return row.id; }); },
    _setChannels: function (channels) {
      adoptServers([{ id: "1", name: "Discord", channels: channels || [] }]);
    },
    _setServers: function (servers) { state.holdServers = true; adoptServers(servers); },
    _setPrefs: function (next) { state.prefs = next || emptyPrefs(); },
    _applyIndex: applyIndex,
    _openMenu: function (id, durations) { state.menu = { id: String(id || ""), durations: !!durations, x: 24, y: 72 }; },
    _openPins: function (id) { state.pinsOpen = String(id || ""); state.menu = null; },
    syncFromHash: syncFromHash,
    _deliver: deliver
  };
})(typeof window !== "undefined" ? window : globalThis);
