/* X-styled Discord inbox. Text is escaped before it is inserted. */
(function (root) {
  const TOPIC = "superintelmusic-discord-th-7f3a91c2";
  const GUILD_ID = "169256939211980800";
  const SEEN_KEY = "rss-feeds-discord-seen-v1";
  const WINDOW = 300;
  const CATEGORY_ORDER = ["Information", "Announcements", "Town Hall General", "Community Fun"];
  const CATALOG = [
    { id: "1502285163009409175", name: "rules", category: "Information", mode: "messages" },
    { id: "739179537933533264", name: "support", category: "Information", mode: "messages" },
    { id: "1106365828842139668", name: "account-safety", category: "Information", mode: "messages" },
    { id: "1514784753293852702", name: "wellbeing-resources", category: "Information", mode: "messages" },
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
    channels: CATALOG.map(copyChannel),
    serverName: "Discord Town Hall",
    icon: "",
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
    bound: null
  };

  function copyChannel(ch) {
    return {
      id: ch.id,
      name: ch.name,
      category: ch.category,
      mode: ch.mode,
      file: ch.mode === "messages" ? "discord/messages/" + ch.id + ".json" : ""
    };
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
    state.channels.forEach(function (ch) { map[ch.id] = ch; });
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
      name: String(author.name || "Unknown").slice(0, 80),
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
      name: m.author.name || "Someone",
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
    const name = String(author.name || "Someone").replace(/\u0000/g, "").slice(0, 80);
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
    const log = document.querySelector(".dmsgs-log");
    if (log && state.open === parsed.ch) repaintLog();
    else updateDots();
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
      return '<div class="dmsgs-placeholder"><h2>' + (waiting ? "Loading messages" : "No messages yet") + "</h2><p>" +
        esc(waiting ? "Reading the saved transcript." : "The next sync reads the latest 50. This view keeps a rolling window of 300.") +
        "</p></div>";
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
      const gutter = fresh
        ? avatarHtml(row)
        : '<time class="dmsg-hovertime" datetime="' + esc(row.date) + '">' + esc(formatClock(row).replace(/^.*,\s*/, "")) + "</time>";
      prev = row;
      return day + '<article class="dmsg' + (fresh ? " group" : " cont") + '">' + gutter + '<div class="dmsg-body">' +
        replyHtml(row, byId) + head +
        '<div class="dmsg-text">' + format(row.body, row.emojis) + (row.edited ? ' <span class="dmsg-edited">(edited)</span>' : "") + "</div>" +
        mediaHtml(row) + embedHtml(row) + reactionHtml(row) +
        "</div></article>";
    }).join("");
  }

  function seenMap() {
    try {
      const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || "{}");
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

  function orderedCategories(channels) {
    const groups = [];
    const index = {};
    channels.forEach(function (ch) {
      const name = ch.category || "Channels";
      if (index[name] == null) {
        index[name] = groups.length;
        groups.push({ name: name, channels: [] });
      }
      groups[index[name]].channels.push(ch);
    });
    groups.sort(function (a, b) {
      const ai = CATEGORY_ORDER.indexOf(a.name);
      const bi = CATEGORY_ORDER.indexOf(b.name);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
    return groups;
  }

  function listHtml(route) {
    const text = state.channels.filter(function (ch) { return ch.mode === "messages"; });
    const groups = orderedCategories(text);
    const serverIcon = state.icon
      ? '<img src="' + esc(state.icon) + '" alt="" referrerpolicy="no-referrer">'
      : "<span>TH</span>";
    const rows = groups.map(function (group) {
      const links = group.channels.map(function (ch) {
        const on = route && route.channel === ch.id;
        const unread = isUnread(ch.id, route);
        return '<a class="dmsgs-ch' + (on ? " on" : "") + (unread ? " unread" : "") + '" data-ch="' + esc(ch.id) + '" data-name="' + esc(ch.name) + '" data-cat="' + esc(group.name) + '" href="' + channelHref(ch.id) + '">' +
          '<span class="dmsgs-hash" aria-hidden="true">#</span><span class="dmsgs-ch-name">' + esc(ch.name) + "</span>" +
          (unread ? '<span class="dmsgs-dot" aria-label="Unread"></span>' : "") +
          "</a>";
      }).join("");
      return '<h2 class="dmsgs-cat">' + esc(group.name) + "</h2>" + links;
    }).join("");
    return '<header class="dmsgs-head"><h1>Messages</h1></header>' +
      '<label class="search dmsgs-search"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 20.3 16.7 16a7.5 7.5 0 1 0-.7.7L20.3 21 21 20.3zM5 10.5a5.5 5.5 0 1 1 11 0 5.5 5.5 0 0 1-11 0z"/></svg>' +
      '<input id="dmsgs-q" class="dmsgs-q" type="search" placeholder="Search Direct Messages" aria-label="Search Direct Messages" value="' + esc(state.query) + '"></label>' +
      '<div class="dmsgs-server">' + '<span class="dmsgs-server-ico">' + serverIcon + "</span>" +
      '<span class="dmsgs-server-copy"><b>' + esc(state.serverName) + '</b><span>Text channels</span></span></div>' +
      '<div class="dmsgs-channels">' + rows + "</div>";
  }

  function conversationHtml(route) {
    const id = route && route.channel || "";
    if (!id) {
      return '<section class="dmsgs-conv dmsgs-conv-empty"><div class="dmsgs-placeholder"><h2>Select a message</h2><p>Choose a channel to read. This inbox is read-only.</p></div></section>';
    }
    const ch = channelById(id);
    if (!ch) {
      return '<section class="dmsgs-conv"><header class="dmsgs-conv-head"><a class="dmsgs-back" href="' + listHref() + '" aria-label="Back">‹</a><div><b>Channel</b></div></header><div class="dmsgs-log"><div class="dmsgs-placeholder"><h2>This channel isn’t available</h2><p>It isn’t in the Town Hall list.</p></div></div></section>';
    }
    if (ch.mode !== "messages") {
      return '<section class="dmsgs-conv"><header class="dmsgs-conv-head"><a class="dmsgs-back" href="' + listHref() + '" aria-label="Back">‹</a><span class="dmsgs-hash lg" aria-hidden="true">#</span><div><b>' + esc(ch.name) + "</b><span>" + esc(ch.category) + '</span></div></header><div class="dmsgs-log"><div class="dmsgs-placeholder"><h2>Posted on Home</h2><p>Announcement channels are published with the rest of the feed.</p></div></div></section>';
    }
    return '<section class="dmsgs-conv">' +
      '<header class="dmsgs-conv-head"><a class="dmsgs-back" href="' + listHref() + '" aria-label="Back">‹</a><span class="dmsgs-hash lg" aria-hidden="true">#</span><div><b>' + esc(ch.name) + "</b><span>" + esc(ch.category) + "</span></div></header>" +
      '<div class="dmsgs-log" tabindex="0">' + logInner(id) + "</div>" +
      '<button type="button" class="dmsgs-jump" hidden>Jump to present</button>' +
      '<div class="dmsgs-compose"><div class="dmsgs-compose-box" role="textbox" aria-disabled="true" aria-label="Read-only channel"><span>Read-only channel</span></div></div>' +
      "</section>";
  }

  function page(route) {
    state.fixture = !!(route && route.query && typeof route.query.get === "function" && route.query.get("fixture") === "1");
    ensureLoad();
    const id = route && snowflake(route.channel);
    if (id && !state.fixture) ensureChannel(id);
    const open = id ? " has-channel" : "";
    return '<div class="dmsgs' + open + '" data-discord-root>' +
      '<aside class="dmsgs-list">' + listHtml(route) + "</aside>" +
      conversationHtml(route) +
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
    if (!log) return;
    const near = nearBottom(log);
    state.stick = near;
    const jump = document.querySelector(".dmsgs-jump");
    if (jump) jump.hidden = near;
    if (near && state.open) {
      markSeen(state.open);
      updateDots();
    }
  }

  function repaintLog() {
    const log = document.querySelector(".dmsgs-log");
    if (!log || !state.open) return;
    const near = nearBottom(log) || state.stick;
    log.innerHTML = logInner(state.open);
    if (near) {
      log.scrollTop = log.scrollHeight;
      markSeen(state.open);
    }
    const jump = document.querySelector(".dmsgs-jump");
    if (jump) jump.hidden = near;
    updateDots();
  }

  function updateDots() {
    if (typeof document === "undefined") return;
    document.querySelectorAll(".dmsgs-ch").forEach(function (el) {
      const id = el.getAttribute("data-ch");
      const unread = isUnread(id, { channel: state.open });
      el.classList.toggle("unread", unread);
      let dot = el.querySelector(".dmsgs-dot");
      if (unread && !dot) {
        dot = document.createElement("span");
        dot.className = "dmsgs-dot";
        dot.setAttribute("aria-label", "Unread");
        el.appendChild(dot);
      } else if (!unread && dot) {
        dot.remove();
      }
    });
  }

  function applyFilter() {
    if (typeof document === "undefined") return;
    const q = String(state.query || "").trim().toLowerCase();
    document.querySelectorAll(".dmsgs-ch").forEach(function (el) {
      const name = (el.getAttribute("data-name") || "").toLowerCase();
      const cat = (el.getAttribute("data-cat") || "").toLowerCase();
      el.hidden = !!(q && name.indexOf(q) < 0 && cat.indexOf(q) < 0);
    });
    document.querySelectorAll(".dmsgs-cat").forEach(function (el) {
      let any = false;
      let node = el.nextElementSibling;
      while (node && !node.classList.contains("dmsgs-cat")) {
        if (node.classList.contains("dmsgs-ch") && !node.hidden) any = true;
        node = node.nextElementSibling;
      }
      el.hidden = !any;
    });
  }

  function mount(route) {
    const messages = route && route.name === "messages";
    if (!messages) {
      state.open = "";
      refreshLive();
      return;
    }
    const channel = snowflake(route.channel);
    if (state.open !== channel) {
      state.open = channel;
      state.stick = true;
    }
    const log = document.querySelector(".dmsgs-log");
    if (log && state.stick) log.scrollTop = log.scrollHeight;
    if (log && log.dataset.bound !== "1") {
      log.dataset.bound = "1";
      log.addEventListener("scroll", onScroll, { passive: true });
    }
    if (channel && state.stick) markSeen(channel);
    applyFilter();
    const jump = document.querySelector(".dmsgs-jump");
    if (jump) jump.hidden = state.stick;
    refreshLive();
  }

  function applyConfig(servers) {
    const channels = [];
    let name = "";
    (servers || []).forEach(function (server) {
      if (!server || !Array.isArray(server.channels)) return;
      if (!name && server.name) name = String(server.name).slice(0, 80);
      server.channels.forEach(function (ch) {
        const id = snowflake(ch && ch.id);
        const mode = ch && (ch.mode === "posts" || ch.mode === "messages") ? ch.mode : "";
        if (!id || !mode) return;
        channels.push({
          id: id,
          name: String(ch.name || id).slice(0, 80),
          category: String(ch.category || "").slice(0, 80),
          mode: mode,
          file: mode === "messages" ? "discord/messages/" + id + ".json" : ""
        });
      });
    });
    if (!channels.length) return;
    state.channels = channels;
    if (name) state.serverName = name;
  }

  function applyIndex(index) {
    const byId = {};
    state.channels.forEach(function (ch) { byId[ch.id] = ch; });
    ((index && index.servers) || []).forEach(function (server) {
      const icon = cdnUrl(server && server.icon);
      if (icon) state.icon = icon;
      if (server && server.name) state.serverName = String(server.name).slice(0, 80);
      ((server && server.channels) || []).forEach(function (ch) {
        const row = byId[snowflake(ch && ch.id)];
        if (!row) return;
        if (ch.name) row.name = String(ch.name).slice(0, 80);
        if (ch.category) row.category = String(ch.category).slice(0, 80);
        if (ch.file && /^discord\/messages\/\d{1,22}\.json$/.test(ch.file)) row.file = ch.file;
      });
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
      if (hooks().render && state.open === id) hooks().render();
    });
  }

  function ensureLoad() {
    if (state.loadStarted) return;
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
      if (hooks().render && onMessages()) hooks().render();
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
    if (note.topic && note.topic !== TOPIC) return;
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
    fetch("https://ntfy.sh/" + TOPIC + "/json?poll=1&since=" + encodeURIComponent(state.since), { cache: "no-store" }).then(function (res) {
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
      es = new EventSource("https://ntfy.sh/" + TOPIC + "/sse?since=" + encodeURIComponent(state.since));
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
    document.addEventListener("click", function (event) {
      const jump = event.target && event.target.closest && event.target.closest(".dmsgs-jump");
      if (!jump) return;
      const log = document.querySelector(".dmsgs-log");
      if (!log) return;
      log.scrollTop = log.scrollHeight;
      state.stick = true;
      jump.hidden = true;
      if (state.open) markSeen(state.open);
      updateDots();
    });
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
    _setChannels: function (channels) { state.channels = channels || []; }
  };
})(typeof window !== "undefined" ? window : globalThis);
