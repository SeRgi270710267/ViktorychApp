/* Composer modeled on X's mobile post sheet. Posts stay in this app.
   Post to X opens https://x.com/intent/post and never calls a paid API.
   Pictures and video keep the original file. Nothing here is re-encoded. */
(function () {
  var core = globalThis.XComposeCore;
  if (!core) {
    globalThis.ViktorychXCompose = {
      inlineHtml: function () { return ""; },
      modalHtml: function () { return ""; },
      settingsHtml: function () { return ""; },
      mentionsBanner: function () { return ""; },
      onAct: function () { return false; },
      afterRender: function () {},
      preparePost: function () {},
      requestClose: function () { return false; },
      onEscape: function () { return false; },
      publish: function () {}
    };
    return;
  }

  var DRAFT_KEY = "viktorychapp-x-drafts-v1";
  var PARTIAL_KEY = "viktorychapp-x-partial-v1";
  var FOLD_KEY = "viktorychapp-composer-fold-v1";
  var MAX_BYTES = 20 * 1024 * 1024;
  var EMOJI = ["😀", "😂", "🥹", "😊", "😍", "😘", "😎", "🤔", "😅", "😭", "😡", "🤯", "😴", "🤝", "👍", "👎", "👏", "🙏", "🔥", "✨", "💯", "❤️", "💙", "🎉", "✅", "❌", "⭐", "📌", "💬", "👀", "🚀", "🌈", "☀️", "🌙", "⚡", "🎵", "📷", "🎬", "🏆", "💡"];
  var DURATIONS = [[5, "5 minutes"], [60, "1 hour"], [1440, "1 day"], [4320, "3 days"], [10080, "7 days"]];
  var AUDIENCES = [["everyone", "Everyone"], ["following", "Accounts you follow"], ["friends", "Friends"], ["lists", "Custom lists"]];
  var REPLIES = [["everyone", "Everyone can reply"], ["following", "Accounts you follow"], ["verified", "Verified accounts"], ["mentioned", "Only accounts you mention"]];
  var host = null;
  var modalSlot = "post";
  var partialDraft = null;
  var panel = "";
  var gifQ = "";
  var gifItems = [];
  var gifBusy = false;
  var gifError = "";
  var scanning = false;
  var timer = 0;
  var saveTimer = 0;
  var bound = false;
  var aiMenu = "";
  var menuOpenedAt = 0;
  var aiTones = false;
  var aiBusy = null;
  var aiPreview = null;
  var aiToast = "";
  var aiToastSlot = "";
  var aiToastTimer = 0;
  var aiJob = 0;
  var recorder = null;
  var recordSlot = "";
  var dragFrom = null;
  var draftMedia = {};
  var scrollFold = false;

  function blank() {
    return {
      posts: [{ text: "", replyTo: "" }],
      media: [], link: "", hashtags: [], replyTo: "", quoteUrl: "", appParent: "", appQuote: "",
      context: "", targetKey: "", sourceText: "", emoji: false, audience: "everyone", replyControl: "everyone",
      location: "", poll: null, scheduleAt: 0, quoteBody: "", quoteName: ""
    };
  }
  var slots = { post: blank(), reply: blank(), quote: blank() };

  function tr(key, vars) {
    var fn = window.t || null;
    var text = fn ? fn(key, vars) : key;
    if (!fn && vars) {
      Object.keys(vars).forEach(function (name) {
        text = String(text).replace(new RegExp("\\{" + name + "\\}", "g"), String(vars[name]));
      });
    }
    return text;
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function icon(path) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"></path></svg>';
  }
  var ICONS = {
    image: "M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14m18 0H3m18 0-5-6-4 5-3-3-6 4",
    camera: "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM19 10v1a7 7 0 0 1-14 0v-1M12 18v3",
    poll: "M4 20V10M10 20V4M16 20v-6M22 20H2",
    pin: "M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11zM12 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
    cal: "M4 5h16v15H4zM8 3v4M16 3v4M4 10h16",
    emoji: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01",
    plus: "M12 5v14M5 12h14",
    close: "M18 6 6 18M6 6l12 12",
    chev: "M6 9l6 6 6-6",
    globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20",
    spark: "M12 2.2l1.7 5.4 5.5 1.5-5.5 1.6L12 16.2l-1.7-5.5L4.8 9.1l5.5-1.5L12 2.2zM18.2 13.2l.8 2.4 2.5.7-2.5.7-.8 2.5-.8-2.5-2.4-.7 2.4-.7.8-2.4z"
  };

  function readStore(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (err) { return null; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* this device is full */ }
  }
  function narrowHome() {
    try { return !!(window.matchMedia && window.matchMedia("(max-width: 700px)").matches); }
    catch (err) { return false; }
  }
  function readFold() {
    var doc = readStore(FOLD_KEY);
    if (!doc || typeof doc.open !== "boolean") return { open: !narrowHome(), auto: true };
    return { open: doc.open !== false, auto: doc.auto !== false };
  }
  function writeFold(prefs) {
    writeStore(FOLD_KEY, { open: !!prefs.open, auto: prefs.auto !== false });
  }
  function composerFocused() {
    var active = document.activeElement;
    return !!(active && active.closest && active.closest(".xc-inline[data-home-compose='1']"));
  }
  function homeBusy() {
    if (dirty("post")) return true;
    if (panel || aiMenu || aiPreview) return true;
    if (slots.post && slots.post.emoji) return true;
    if (composerFocused()) return true;
    return false;
  }
  function homeFolded() {
    var prefs = readFold();
    if (!prefs.open) return true;
    if (composerFocused() || dirty("post") || panel || aiMenu || aiPreview || (slots.post && slots.post.emoji)) return false;
    return !!(prefs.auto && scrollFold);
  }
  function expandHome() {
    var prefs = readFold();
    writeFold({ open: true, auto: prefs.auto });
    scrollFold = false;
    applyFoldDom(false);
  }
  function tuneAudience() {
    var reduced = false;
    try { reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (err) { reduced = false; }
    document.querySelectorAll("[data-xc-marquee]").forEach(function (el) {
      var clip = el.querySelector(".xc-aud-clip");
      var text = el.querySelector(".xc-aud-text");
      if (!clip || !text) return;
      var overflow = text.scrollWidth > clip.clientWidth + 1;
      if (overflow && !reduced) el.classList.add("is-on");
      else el.classList.remove("is-on");
    });
  }
  function applyFoldDom(folded) {
    var node = document.querySelector(".xc-inline[data-home-compose='1']");
    if (!node) return;
    if (folded) node.classList.add("xc-folded");
    else node.classList.remove("xc-folded");
    node.setAttribute("aria-expanded", folded ? "false" : "true");
    var area = node.querySelector("textarea[data-xc='text']");
    if (area) {
      if (folded) area.style.height = "24px";
      else grow(area);
    }
    if (!folded) tuneAudience();
  }
  function draftDoc() {
    var doc = readStore(DRAFT_KEY);
    return doc && Array.isArray(doc.items) ? doc : { items: [] };
  }
  function readPartial() {
    var doc = readStore(PARTIAL_KEY);
    var gap = Number(doc && doc.gap) || core.POLL_BASE_MS;
    return { on: !!(doc && doc.on), handle: String((doc && doc.handle) || "").replace(/^@/, "").slice(0, 15), nextAt: Number(doc && doc.nextAt) || 0, gap: gap, wait: !!(doc && doc.wait) };
  }
  function writePartial(prefs) {
    writeStore(PARTIAL_KEY, { on: !!prefs.on, handle: String(prefs.handle || "").replace(/^@/, "").slice(0, 15), nextAt: Number(prefs.nextAt) || 0, gap: Number(prefs.gap) || core.POLL_BASE_MS, wait: !!prefs.wait });
  }
  function linkedHandle() {
    var accounts = window.ViktorychAccounts;
    var account = accounts && accounts.account ? accounts.account() : null;
    var list = (account && account.identities) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].platform === "x" && /^[A-Za-z0-9_]{1,15}$/.test(String(list[i].handle || ""))) return String(list[i].handle);
    }
    return "";
  }
  function cleanHandle(value) {
    var text = String(value || "").replace(/^@/, "").trim();
    return /^[A-Za-z0-9_]{1,15}$/.test(text) ? text : "";
  }
  function fileType(file) {
    var type = String((file && file.type) || "").toLowerCase();
    if (type) return type;
    var name = String((file && file.name) || "").toLowerCase();
    if (/\.gif$/.test(name)) return "image/gif";
    if (/\.png$/.test(name)) return "image/png";
    if (/\.jpe?g$/.test(name)) return "image/jpeg";
    if (/\.webp$/.test(name)) return "image/webp";
    if (/\.mp4$/.test(name)) return "video/mp4";
    if (/\.webm$/.test(name)) return "video/webm";
    if (/\.mov$/.test(name)) return "video/quicktime";
    return "";
  }
  function labelOf(list, value) {
    for (var i = 0; i < list.length; i++) if (list[i][0] === value) return list[i][1];
    return list[0][1];
  }
  function firstUrl(text) {
    var parsed = core.parseTweet(text || "");
    return parsed.urls && parsed.urls[0] ? parsed.urls[0] : "";
  }
  function measure(slot, index) {
    var post = (slot.posts || [])[index] || { text: "" };
    var weight = core.composeWeight({
      text: post.text,
      hashtags: index === 0 ? slot.hashtags : [],
      url: index === 0 && !slot.quoteUrl ? slot.link : "",
      quote: !!(index === 0 && slot.quoteUrl)
    });
    return { weight: weight, left: 280 - weight };
  }
  function canPost(slot) {
    if (!slot) return false;
    if (slot.scheduleAt && slot.posts.length > 1) return false;
    var any = false;
    var over = false;
    slot.posts.forEach(function (post, index) {
      var info = measure(slot, index);
      if (info.weight > 280) over = true;
      var text = String(post.text || "").trim();
      if (text || (index === 0 && (slot.media.length || (slot.poll && pollReady(slot)) || /^https?:\/\//i.test(slot.link || "")))) any = true;
    });
    return any && !over;
  }
  function pollReady(slot) {
    if (!slot.poll) return false;
    return slot.poll.options.filter(function (item) { return String(item || "").trim(); }).length >= 2;
  }
  function dirty(slotName) {
    var slot = slots[slotName];
    if (!slot) return false;
    if (slot.media.length || slot.poll || slot.location || slot.scheduleAt || (slot.hashtags || []).length || slot.link) return true;
    return slot.posts.some(function (post) { return String(post.text || "").trim(); });
  }
  function intentFor(slot, index) {
    var post = slot.posts[index] || { text: "" };
    return core.buildIntentUrl({
      text: post.text,
      inReplyTo: index === 0 ? slot.replyTo : (post.replyTo || ""),
      url: index === 0 ? (slot.quoteUrl || slot.link) : "",
      hashtags: index === 0 ? slot.hashtags : []
    });
  }
  function fieldId(slotName, index) {
    var open = host && host.modalOpen && host.modalOpen();
    if (open && slotName !== modalSlot) return "xc-inline-" + slotName + "-" + index;
    if (index === 0 && slotName === "post") return "compose-text";
    if (index === 0 && (slotName === "reply" || slotName === "quote")) return "reply-draft";
    return "xc-" + slotName + "-" + index;
  }
  function marks(text) {
    return esc(text).replace(/([@#][A-Za-z0-9_]{1,50})/g, '<span class="xc-mark">$1</span>') + "\n";
  }
  function meter(info) {
    var circ = 50.27;
    var ratio = Math.max(0, Math.min(1, info.weight / 280));
    var cls = info.left < 0 ? "over" : info.left <= 20 ? "near" : "";
    var label = info.left <= 20 ? '<span class="xc-left">' + esc(String(info.left)) + "</span>" : "";
    return '<span class="xc-count ' + cls + '" aria-label="' + esc(tr("Characters left")) + '"><svg class="xc-meter" viewBox="0 0 20 20" aria-hidden="true"><circle class="xc-meter-track" cx="10" cy="10" r="8"></circle><circle class="xc-meter-val" cx="10" cy="10" r="8" stroke-dasharray="' + circ + '" stroke-dashoffset="' + (circ * (1 - ratio)).toFixed(2) + '"></circle></svg>' + label + "</span>";
  }
  function postButton(slotName) {
    var ok = canPost(slots[slotName]);
    return '<button class="xc-post-btn" id="compose-post" type="button" data-act="xc-publish" data-slot="' + esc(slotName) + '"' + (ok ? "" : " disabled") + ">" + esc(tr("Post")) + "</button>";
  }
  function intentLink(slotName, index) {
    var info = measure(slots[slotName], index);
    var href = info.left >= 0 && String((slots[slotName].posts[index] || {}).text || "").trim() ? ' href="' + esc(intentFor(slots[slotName], index)) + '"' : "";
    var disabled = href ? "" : ' aria-disabled="true"';
    return '<a class="xc-intent" target="_blank" rel="noopener noreferrer" data-slot="' + esc(slotName) + '" data-index="' + index + '"' + href + disabled + ">" + esc(tr("Post to X")) + "</a>";
  }

  function composeHelpOn() {
    var ai = window.ViktorychOnDeviceAi;
    if (ai && ai.composeUiOn) return !!ai.composeUiOn();
    var device = window.ViktorychDevice;
    if (!device || !device.aiFeatureOn || !device.featureOn) return false;
    var settings = device.read ? device.read() : null;
    var signals = device.signals ? device.signals() : {};
    return !!(device.featureOn(settings, "ai", signals) && device.aiFeatureOn(settings, "compose", signals));
  }
  function replyMode(slotName) {
    var slot = slots[slotName];
    return slotName === "reply" || !!(slot && (slot.replyTo || slot.appParent));
  }
  function showAiToast(slotName, message) {
    aiToast = message || "";
    aiToastSlot = slotName || "";
    clearTimeout(aiToastTimer);
    if (!aiToast) return;
    aiToastTimer = setTimeout(function () {
      aiToast = "";
      aiToastSlot = "";
      paint();
    }, 3200);
  }
  function toneButton(slotName, tone, label) {
    return '<button type="button" role="menuitem" data-act="xc-ai-run" data-kind="tone" data-tone="' + esc(tone) + '" data-slot="' + esc(slotName) + '" data-index="0">' + esc(label) + "</button>";
  }
  function aiMenuHtml(slotName) {
    var tones = aiTones
      ? '<div class="xc-ai-sub" role="group" aria-label="' + esc(tr("Change tone")) + '">' + toneButton(slotName, "friendly", tr("More friendly")) + toneButton(slotName, "formal", tr("More formal")) + toneButton(slotName, "shorter", tr("Shorter")) + "</div>"
      : "";
    var suggest = replyMode(slotName)
      ? '<button type="button" role="menuitem" data-act="xc-ai-run" data-kind="suggest" data-slot="' + esc(slotName) + '" data-index="0">' + esc(tr("Suggest replies")) + "</button>"
      : "";
    return '<div class="xc-ai-pop" role="menu">'
      + '<button type="button" role="menuitem" data-act="xc-ai-run" data-kind="grammar" data-slot="' + esc(slotName) + '" data-index="0">' + esc(tr("Fix grammar")) + "</button>"
      + '<button type="button" role="menuitem" data-act="xc-ai-tones" data-slot="' + esc(slotName) + '" aria-expanded="' + (aiTones ? "true" : "false") + '">' + esc(tr("Change tone")) + "</button>"
      + tones + suggest + "</div>";
  }
  function aiButton(slotName) {
    if (!composeHelpOn()) return "";
    var open = aiMenu === slotName;
    return '<div class="xc-ai"><button class="xc-tool xc-ai-btn" type="button" data-act="xc-ai" data-slot="' + esc(slotName) + '" aria-label="' + esc(tr("Writing tools")) + '" aria-haspopup="menu" aria-expanded="' + (open ? "true" : "false") + '">' + icon(ICONS.spark) + "</button>"
      + (open ? aiMenuHtml(slotName) : "") + "</div>";
  }
  function aiExtra(slotName) {
    var html = "";
    if (aiBusy && aiBusy.slot === slotName) {
      html += '<div class="xc-ai-preview" role="status"><span class="xc-ai-spin" aria-hidden="true"></span><span>' + esc(tr("Working…")) + "</span></div>";
    } else if (aiPreview && aiPreview.slot === slotName) {
      var body = aiPreview.suggestions && aiPreview.suggestions.length
        ? '<div class="xc-ai-choices">' + aiPreview.suggestions.map(function (line, i) {
          return '<button type="button" class="xc-ai-choice' + (i === aiPreview.pick ? " on" : "") + '" data-act="xc-ai-pick" data-slot="' + esc(slotName) + '" data-i="' + i + '">' + esc(line) + "</button>";
        }).join("") + "</div>"
        : "<p>" + esc(aiPreview.text || "") + "</p>";
      html += '<div class="xc-ai-preview">' + body + '<div class="xc-ai-actions"><button type="button" class="xc-ai-dismiss" data-act="xc-ai-dismiss" data-slot="' + esc(slotName) + '">' + esc(tr("Dismiss")) + '</button><button type="button" class="xc-ai-apply" data-act="xc-ai-apply" data-slot="' + esc(slotName) + '">' + esc(tr("Apply")) + "</button></div></div>";
    }
    if (aiToast && aiToastSlot === slotName) html += '<p class="xc-ai-toast" role="status">' + esc(aiToast) + "</p>";
    return html;
  }
  function runAi(slotName, index, kind, tone) {
    var slot = slots[slotName] || slots.post;
    var draft = String((slot.posts[index] && slot.posts[index].text) || "");
    var source = kind === "suggest" ? String(slot.sourceText || "") : draft;
    aiMenu = "";
    aiTones = false;
    if (kind === "suggest" && !source.trim()) {
      aiBusy = null;
      showAiToast(slotName, tr("Nothing to reply to yet."));
      paint();
      return;
    }
    if (kind !== "suggest" && !draft.trim()) {
      aiBusy = null;
      showAiToast(slotName, tr("Write something first."));
      paint();
      return;
    }
    aiPreview = null;
    aiToast = "";
    aiBusy = { slot: slotName };
    var job = ++aiJob;
    paint();
    function finish() {
      var ai = window.ViktorychOnDeviceAi;
      if (job !== aiJob) return;
      if (!ai || !ai.compose) {
        aiBusy = null;
        showAiToast(slotName, tr("Could not rewrite that on this device."));
        paint();
        return;
      }
      ai.compose(source, { kind: kind, tone: tone || "", scope: "post", server: false }).then(function (row) {
        if (job !== aiJob) return;
        aiBusy = null;
        var text = row && row.text ? String(row.text).trim() : "";
        var suggestions = row && row.suggestions ? row.suggestions.map(function (line) { return String(line || "").trim(); }).filter(Boolean).slice(0, 3) : [];
        if (kind === "suggest" && suggestions.length) {
          aiPreview = { slot: slotName, index: index, text: suggestions[0], suggestions: suggestions, pick: 0 };
          paint();
          return;
        }
        if (text) {
          aiPreview = { slot: slotName, index: index, text: text, suggestions: [], pick: 0 };
          paint();
          return;
        }
        showAiToast(slotName, tr("Could not rewrite that on this device."));
        paint();
      }).catch(function () {
        if (job !== aiJob) return;
        aiBusy = null;
        showAiToast(slotName, tr("Could not rewrite that on this device."));
        paint();
      });
    }
    if (window.ViktorychOnDeviceAi) finish();
    else if (window.ViktorychDevice && window.ViktorychDevice.ensure) window.ViktorychDevice.ensure("ondevice").then(finish);
    else finish();
  }
  function tool(slotName, act, label, glyph, extra) {
    return '<button class="xc-tool" type="button" data-act="' + act + '" data-slot="' + esc(slotName) + '"' + (extra || "") + ' aria-label="' + esc(label) + '">' + glyph + "</button>";
  }
  function tools(slotName, withPost) {
    var recording = recorder && recordSlot === slotName;
    var icons = '<div class="xc-iconrow">'
      + aiButton(slotName)
      + tool(slotName, "xc-file", tr("Photos"), icon(ICONS.image), ' data-kind="image"')
      + tool(slotName, "xc-file", tr("Camera"), icon(ICONS.camera), ' data-kind="camera"')
      + tool(slotName, "xc-gif", tr("GIF"), '<span class="xc-gif">GIF</span>')
      + tool(slotName, "xc-voice", tr("Voice"), icon(ICONS.mic), ' aria-pressed="' + (recording ? "true" : "false") + '"' + (recording ? " data-recording=\"1\"" : ""))
      + tool(slotName, "xc-poll", tr("Add a poll"), icon(ICONS.poll), ' aria-pressed="' + (slots[slotName].poll ? "true" : "false") + '"')
      + tool(slotName, "xc-location", tr("Add location"), icon(ICONS.pin))
      + tool(slotName, "xc-schedule", tr("Schedule post"), icon(ICONS.cal))
      + tool(slotName, "xc-emoji", tr("Emoji"), icon(ICONS.emoji), ' aria-pressed="' + (slots[slotName].emoji ? "true" : "false") + '"')
      + (slotName === "reply" ? '<button class="xc-tool" type="button" data-gift="reply" data-parent="' + esc(slots.reply.replyTo || slots.reply.targetKey || "") + '" data-handle="' + esc(slots.reply.context || "") + '" aria-label="' + esc(tr("Send a gift")) + '">' + esc(tr("Gift")) + "</button>" : "")
      + "</div>";
    if (withPost === "icons") return '<div class="xc-tools">' + icons + "</div>";
    return '<div class="xc-tools">' + icons + endChrome(slotName, withPost) + "</div>";
  }
  function endChrome(slotName, withPost) {
    var info = measure(slots[slotName], 0);
    var split = info.weight > 0 ? '<span class="xc-split" aria-hidden="true"></span>' : "";
    var post = withPost ? '<button class="xc-post-btn" type="button" data-act="xc-publish" data-slot="' + esc(slotName) + '"' + (canPost(slots[slotName]) ? "" : " disabled") + ">" + esc(tr("Post")) + "</button>" : "";
    return '<span class="xc-end" data-xc="end" data-slot="' + esc(slotName) + '"><span data-xc="count" data-slot="' + esc(slotName) + '" data-index="0">' + meter(info) + "</span>" + split
      + '<button class="xc-plus" type="button" data-act="xc-add-post" data-slot="' + esc(slotName) + '" aria-label="' + esc(tr("Add another post")) + '">' + icon(ICONS.plus) + "</button>" + post + "</span>";
  }
  function hiddenFiles(slotName) {
    return '<input class="xc-file" data-xc="file" data-slot="' + esc(slotName) + '" data-kind="image" type="file" accept="image/jpeg,image/png,image/webp" multiple tabindex="-1">'
      + '<input class="xc-file" data-xc="file" data-slot="' + esc(slotName) + '" data-kind="camera" type="file" accept="image/*" capture="environment" tabindex="-1">'
      + '<input class="xc-file" data-xc="file" data-slot="' + esc(slotName) + '" data-kind="gif" type="file" accept="image/gif" tabindex="-1">'
      + '<input class="xc-file" data-xc="file" data-slot="' + esc(slotName) + '" data-kind="video" type="file" accept="video/mp4,video/webm,video/quicktime" tabindex="-1">';
  }
  function mediaHtml(slotName) {
    var slot = slots[slotName];
    if (!slot.media.length) return "";
    var shots = slot.media.map(function (item, index) {
      var body = item.kind === "video"
        ? '<video src="' + esc(item.url) + '" muted></video>'
        : item.kind === "audio"
          ? '<audio src="' + esc(item.url) + '" controls></audio>'
          : '<img src="' + esc(item.url) + '" alt="' + esc(item.alt || "") + '">';
      return '<div class="xc-shot" draggable="true" data-drag="media" data-slot="' + esc(slotName) + '" data-index="' + index + '">' + body
        + '<div class="xc-shot-tools"><button type="button" data-act="xc-alt" data-slot="' + esc(slotName) + '" data-index="' + index + '" aria-label="' + esc(tr("Alt text")) + '">ALT</button>'
        + '<button type="button" data-act="xc-media-move" data-slot="' + esc(slotName) + '" data-index="' + index + '" data-dir="-1" aria-label="' + esc(tr("Move earlier")) + '">‹</button>'
        + '<button type="button" data-act="xc-media-move" data-slot="' + esc(slotName) + '" data-index="' + index + '" data-dir="1" aria-label="' + esc(tr("Move later")) + '">›</button>'
        + '<button type="button" data-act="xc-remove-media" data-slot="' + esc(slotName) + '" data-index="' + index + '" aria-label="' + esc(tr("Remove")) + '">×</button></div></div>'
        + (panel === "alt:" + index ? '<label class="xc-line"><span class="xc-sr">' + esc(tr("Alt text")) + '</span><input class="xc-alt" data-xc="alt" data-slot="' + esc(slotName) + '" data-index="' + index + '" maxlength="1000" placeholder="' + esc(tr("Add a description")) + '" value="' + esc(item.alt || "") + '"></label>' : "");
    }).join("");
    return '<div class="xc-media' + (slot.media.length === 1 ? " one" : "") + '">' + shots + "</div>";
  }
  function pollHtml(slotName) {
    var slot = slots[slotName];
    if (!slot.poll) return "";
    var options = slot.poll.options.map(function (value, index) {
      return '<div class="xc-poll-row"><label class="xc-sr" for="xc-poll-' + index + '">' + esc(tr("Choice {n}", { n: index + 1 })) + '</label><input id="xc-poll-' + index + '" data-xc="poll-opt" data-slot="' + esc(slotName) + '" data-i="' + index + '" maxlength="25" placeholder="' + esc(tr("Choice {n}", { n: index + 1 })) + '" value="' + esc(value || "") + '">'
        + (slot.poll.options.length > 2 ? '<button type="button" data-act="xc-poll-del" data-slot="' + esc(slotName) + '" data-i="' + index + '" aria-label="' + esc(tr("Remove")) + '">×</button>' : "") + "</div>";
    }).join("");
    var durations = DURATIONS.map(function (row) {
      return '<option value="' + row[0] + '"' + (slot.poll.minutes === row[0] ? " selected" : "") + ">" + esc(tr(row[1])) + "</option>";
    }).join("");
    var add = slot.poll.options.length < 4 ? '<button type="button" class="xc-linkish" data-act="xc-poll-add" data-slot="' + esc(slotName) + '">' + esc(tr("Add a choice")) + "</button>" : "";
    return '<div class="xc-poll"><span class="xc-sr">' + esc(tr("Add a poll")) + "</span>" + options + add
      + '<label class="xc-line"><span>' + esc(tr("Poll length")) + '</span><select data-xc="poll-min" data-slot="' + esc(slotName) + '">' + durations + "</select></label>"
      + '<button type="button" class="xc-linkish" data-act="xc-poll-remove" data-slot="' + esc(slotName) + '">' + esc(tr("Remove poll")) + "</button></div>";
  }
  function emojiHtml(slotName) {
    if (!slots[slotName].emoji) return "";
    return '<div class="xc-emoji">' + EMOJI.map(function (item, index) {
      return '<button type="button" data-act="xc-emoji-add" data-slot="' + esc(slotName) + '" data-i="' + index + '" aria-label="' + esc(item) + '">' + item + "</button>";
    }).join("") + "</div>";
  }
  function threadHtml(slotName) {
    var slot = slots[slotName];
    if (slot.posts.length < 2) return "";
    return slot.posts.slice(1).map(function (post, offset) {
      var index = offset + 1;
      var id = fieldId(slotName, index);
      return '<div class="xc-part" draggable="true" data-drag="post" data-slot="' + esc(slotName) + '" data-index="' + index + '"><div class="xc-part-tools"><strong>' + esc(tr("Add another post")) + '</strong>'
        + '<button type="button" data-act="xc-post-move" data-slot="' + esc(slotName) + '" data-index="' + index + '" data-dir="-1" aria-label="' + esc(tr("Move earlier")) + '">↑</button>'
        + '<button type="button" data-act="xc-post-move" data-slot="' + esc(slotName) + '" data-index="' + index + '" data-dir="1" aria-label="' + esc(tr("Move later")) + '">↓</button>'
        + '<button type="button" data-act="xc-remove-post" data-slot="' + esc(slotName) + '" data-index="' + index + '">' + esc(tr("Remove post")) + "</button></div>"
        + '<div class="xc-field"><div class="xc-highlight" aria-hidden="true">' + marks(post.text || "") + '</div><textarea class="xc-text xc-next" dir="auto" data-xc="text" data-slot="' + esc(slotName) + '" data-index="' + index + '" id="' + esc(id) + '" maxlength="2000" aria-label="' + esc(tr("Add another post")) + '">' + esc(post.text || "") + '</textarea><div class="xc-suggest" data-xc="suggest" hidden></div></div>'
        + '<span data-xc="count" data-slot="' + esc(slotName) + '" data-index="' + index + '">' + meter(measure(slot, index)) + "</span></div>";
    }).join("");
  }
  function cardHtml(text) {
    var url = firstUrl(text);
    if (!url) return "";
    var shown = url;
    try { shown = new URL(/^https?:\/\//i.test(url) ? url : "https://" + url).hostname; } catch (err) { shown = url; }
    return '<a class="xc-card" href="' + esc(/^https?:\/\//i.test(url) ? url : "https://" + url) + '" target="_blank" rel="noopener noreferrer"><span class="xc-card-host">' + esc(shown) + '</span><span class="xc-card-url">' + esc(url) + "</span></a>";
  }
  function contextHtml(slot) {
    if (slot.quoteUrl || slot.appQuote || slot.quoteBody) {
      var who = slot.quoteName || (slot.context ? "@" + slot.context : tr("Quoting"));
      return '<p class="xc-context">' + esc(tr("Quoting")) + "</p>" + (slot.quoteBody ? '<div class="xc-quote-card"><strong>' + esc(who) + "</strong><p>" + esc(slot.quoteBody) + "</p></div>" : "");
    }
    if ((slot.replyTo || slot.appParent) && slot.context) return '<p class="xc-context">' + esc(tr("Replying to @{handle}", { handle: slot.context })) + "</p>";
    return "";
  }
  function audienceHtml(slotName) {
    var slot = slots[slotName];
    var open = panel === "audience";
    var menu = open ? '<div class="xc-menu" role="menu" aria-label="' + esc(tr("Audience")) + '">' + AUDIENCES.map(function (row) {
      return '<button type="button" role="menuitemradio" aria-checked="' + (slot.audience === row[0] ? "true" : "false") + '" data-act="xc-audience" data-slot="' + esc(slotName) + '" data-value="' + row[0] + '">' + esc(tr(row[1])) + "</button>";
    }).join("") + "</div>" : "";
    var label = tr(labelOf(AUDIENCES, slot.audience));
    return '<span class="xc-aud-wrap"><button class="xc-audience" type="button" data-act="xc-audience-menu" data-slot="' + esc(slotName) + '" aria-haspopup="menu" aria-expanded="' + (open ? "true" : "false") + '" aria-label="' + esc(tr("Audience")) + '">'
      + '<span class="xc-aud-marquee" data-xc-marquee><span class="xc-aud-clip"><span class="xc-aud-track">'
      + '<span class="xc-aud-copy"><span class="xc-aud-text">' + esc(label) + "</span></span>"
      + '<span class="xc-aud-copy" aria-hidden="true"><span class="xc-aud-text">' + esc(label) + "</span></span>"
      + "</span></span></span>" + icon(ICONS.chev) + "</button>" + menu + "</span>";
  }
  function actionRow(slotName) {
    var post = '<button class="xc-post-btn" type="button" data-act="xc-publish" data-slot="' + esc(slotName) + '"' + (canPost(slots[slotName]) ? "" : " disabled") + ">" + esc(tr("Post")) + "</button>";
    var plus = '<button class="xc-plus" type="button" data-act="xc-add-post" data-slot="' + esc(slotName) + '" aria-label="' + esc(tr("Add another post")) + '">' + icon(ICONS.plus) + "</button>";
    var count = '<span data-xc="count" data-slot="' + esc(slotName) + '" data-index="0">' + meter(measure(slots[slotName], 0)) + "</span>";
    var fold = slotName === "post"
      ? '<button class="xc-tool xc-fold-btn" type="button" data-act="xc-fold" data-slot="post" aria-label="' + esc(tr("Collapse composer")) + '">' + icon(ICONS.chev) + "</button>"
      : "";
    return '<div class="xc-action">' + audienceHtml(slotName) + count + plus + fold + post + "</div>";
  }
  function textBlock(slotName, index, placeholder) {
    var slot = slots[slotName];
    var post = slot.posts[index] || { text: "" };
    var id = fieldId(slotName, index);
    var described = id === "compose-text" ? ' aria-describedby="compose-note"' : "";
    return '<div class="xc-field"><div class="xc-highlight" aria-hidden="true">' + marks(post.text || "") + '</div><textarea class="xc-text" dir="auto" data-xc="text" data-slot="' + esc(slotName) + '" data-index="' + index + '" id="' + esc(id) + '"' + described + ' placeholder="' + esc(placeholder) + '" maxlength="2000" aria-label="' + esc(placeholder) + '">' + esc(post.text || "") + '</textarea><div class="xc-suggest" data-xc="suggest" hidden></div></div>';
  }
  function extraBits(slotName) {
    var slot = slots[slotName];
    var when = "";
    if (slot.scheduleAt) {
      var stamp = "";
      try { stamp = new Date(slot.scheduleAt).toLocaleString(); } catch (err) { stamp = ""; }
      when = '<p class="xc-loc">' + esc(tr("Schedule")) + (stamp ? " · " + esc(stamp) : "") + "</p>";
    }
    var place = slot.location ? '<p class="xc-loc">' + esc(slot.location) + "</p>" : "";
    return place + when + cardHtml(slot.posts[0].text || "") + (slot.scheduleAt && slot.posts.length > 1 ? '<p class="xc-note">' + esc(tr("A scheduled post is one post.")) + "</p>" : "");
  }
  function box(slotName, sheet) {
    var slot = slots[slotName];
    var face = host && host.faceHtml ? host.faceHtml() : '<span class="ava initials">Y</span>';
    var placeholder = slotName === "post" ? tr("What's happening?") : tr("Post your reply");
    var homeNote = fieldId(slotName, 0) === "compose-text";
    var noteText = homeNote ? tr("Draft stays on this device.") : tr("You press Post on X.");
    var autoBtn = "";
    if (!sheet && slotName === "post") {
      var prefs = readFold();
      autoBtn = '<button class="xc-auto" type="button" role="switch" aria-checked="' + (prefs.auto ? "true" : "false") + '" data-act="xc-fold-auto" data-slot="post" aria-label="' + esc(tr("Collapse when scrolling")) + '">' + esc(tr("On scroll")) + "</button>";
    }
    var note = homeNote
      ? '<p class="xc-note' + (sheet ? " xc-sr" : "") + '" id="compose-note"><span class="xc-note-text">' + esc(noteText) + "</span>" + (sheet ? "" : autoBtn) + "</p>"
      : (sheet ? "" : '<p class="xc-note"><span class="xc-note-text">' + esc(noteText) + "</span></p>");
    var lists = slot.audience === "lists" && typeof window !== "undefined" && window.AudienceLists && window.AudienceLists.checksHtml ? window.AudienceLists.checksHtml(slot.listIds || []) : "";
    var inlineTools = sheet ? "" : tools(slotName, "icons");
    var inlineAction = sheet ? "" : lists + actionRow(slotName);
    var folded = !sheet && slotName === "post" && homeFolded();
    var homeAttr = !sheet && slotName === "post" ? ' data-home-compose="1" aria-expanded="' + (folded ? "false" : "true") + '"' : "";
    return '<div class="xc' + (sheet ? "" : " xc-inline") + (folded ? " xc-folded" : "") + '" data-slot="' + esc(slotName) + '"' + homeAttr + '>' + face + '<div class="xc-main">'
      + contextHtml(slot) + (sheet ? audienceHtml(slotName) + lists : "") + textBlock(slotName, 0, placeholder) + note + aiExtra(slotName)
      + mediaHtml(slotName) + pollHtml(slotName) + emojiHtml(slotName) + extraBits(slotName) + hiddenFiles(slotName)
      + inlineTools + inlineAction + threadHtml(slotName) + "</div></div>";
  }
  function replyRow(slotName) {
    return '<div class="xc-reply-line"><button class="xc-reply-row" type="button" data-act="xc-reply-menu" data-slot="' + esc(slotName) + '" aria-haspopup="menu" aria-expanded="' + (panel === "reply" ? "true" : "false") + '">' + icon(ICONS.globe) + "<span>" + esc(tr(labelOf(REPLIES, slots[slotName].replyControl))) + "</span></button>" + intentLink(slotName, 0) + "</div>";
  }
  function panels(slotName) {
    if (panel === "confirm") {
      return '<div class="xc-panel xc-confirm" role="alertdialog" aria-label="' + esc(tr("Save draft?")) + '"><p>' + esc(tr("Save draft?")) + '</p><button type="button" data-act="xc-save-draft" data-slot="' + esc(slotName) + '">' + esc(tr("Save draft")) + '</button><button type="button" data-act="xc-discard" data-slot="' + esc(slotName) + '">' + esc(tr("Discard")) + "</button></div>";
    }
    if (panel === "reply") {
      return '<div class="xc-panel xc-menu" role="menu" aria-label="' + esc(tr("Who can reply?")) + '"><p class="xc-note">' + esc(tr("Who can reply?")) + "</p>" + REPLIES.map(function (row) {
        return '<button type="button" role="menuitemradio" aria-checked="' + (slots[slotName].replyControl === row[0] ? "true" : "false") + '" data-act="xc-reply-pick" data-slot="' + esc(slotName) + '" data-value="' + row[0] + '">' + esc(tr(row[1])) + "</button>";
      }).join("") + '<p class="xc-note">' + esc(tr("Verified accounts proved a linked profile in this app.")) + "</p></div>";
    }
    if (panel === "gif") {
      var grid = gifItems.map(function (item, index) {
        return '<button type="button" data-act="xc-gif-pick" data-slot="' + esc(slotName) + '" data-i="' + index + '"><img src="' + esc(item.url) + '" alt=""></button>';
      }).join("");
      return '<div class="xc-panel" role="dialog" aria-label="' + esc(tr("GIF")) + '"><div class="xc-line"><label><span class="xc-sr">' + esc(tr("Search GIFs")) + '</span><input data-xc="gif-q" data-slot="' + esc(slotName) + '" placeholder="' + esc(tr("Search GIFs")) + '" value="' + esc(gifQ) + '"></label></div>'
        + '<p class="xc-note">' + esc(gifError || tr("Pick a GIF from this device.")) + '</p>'
        + (gifBusy ? '<p class="xc-note">' + esc(tr("Working…")) + "</p>" : "")
        + '<div class="xc-gif-grid">' + grid + '</div><div class="xc-line"><button type="button" class="xc-linkish" data-act="xc-file" data-slot="' + esc(slotName) + '" data-kind="gif">' + esc(tr("Pick a GIF from this device.")) + "</button></div></div>";
    }
    if (panel === "location") {
      return '<div class="xc-panel" role="dialog" aria-label="' + esc(tr("Add location")) + '"><div class="xc-line"><label><span>' + esc(tr("Add location")) + '</span><input data-xc="location" data-slot="' + esc(slotName) + '" maxlength="80" value="' + esc(slots[slotName].location || "") + '"></label></div><div class="xc-line"><button type="button" class="xc-linkish" data-act="xc-locate" data-slot="' + esc(slotName) + '">' + esc(tr("Use current location")) + '</button></div><p class="xc-note">' + esc(tr("The tag is a place name. Current location does not store precise coordinates.")) + '</p><div class="xc-line"><button type="button" class="xc-linkish" data-act="xc-location-clear" data-slot="' + esc(slotName) + '">' + esc(tr("Remove location")) + "</button></div></div>";
    }
    if (panel === "schedule") {
      var value = "";
      if (slots[slotName].scheduleAt) {
        var date = new Date(slots[slotName].scheduleAt);
        var pad = function (n) { return n < 10 ? "0" + n : String(n); };
        value = date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
      }
      return '<div class="xc-panel" role="dialog" aria-label="' + esc(tr("Schedule post")) + '"><div class="xc-line"><label><span>' + esc(tr("Date and time")) + '</span><input type="datetime-local" data-xc="schedule" data-slot="' + esc(slotName) + '" value="' + esc(value) + '"></label></div><p class="xc-note">' + esc(tr("If you’re signed in, the server publishes this when it’s due. Otherwise it stays on this device until the app is open.")) + '</p><div class="xc-line"><button type="button" class="xc-linkish" data-act="xc-schedule-clear" data-slot="' + esc(slotName) + '">' + esc(tr("Remove schedule")) + "</button></div></div>";
    }
    if (panel === "drafts") return '<div class="xc-panel" role="dialog" aria-label="' + esc(tr("Drafts")) + '">' + draftsHtml(slotName) + "</div>";
    return "";
  }
  function draftsHtml(slotName) {
    var items = draftDoc().items.filter(function (item) { return item && item.id.indexOf("current:") !== 0; });
    if (!items.length) return '<p class="xc-note">' + esc(tr("No drafts yet")) + "</p>";
    return items.slice(0, 20).map(function (item) {
      var line = String((item.posts && item.posts[0]) || "").replace(/\s+/g, " ").slice(0, 80);
      return '<div class="xc-draft"><button class="xc-draft-open" type="button" data-act="xc-open-draft" data-id="' + esc(item.id) + '" data-slot="' + esc(item.slot || slotName) + '">' + esc(line || tr("Drafts")) + '</button><button type="button" data-act="xc-delete-draft" data-id="' + esc(item.id) + '">' + esc(tr("Delete draft")) + "</button></div>";
    }).join("");
  }
  function header(slotName) {
    return '<div class="xc-top"><button class="xc-tool xc-close" type="button" data-act="close-modal" aria-label="' + esc(tr("Close")) + '">' + icon(ICONS.close) + '</button><div class="grow"></div><button class="xc-drafts-link" type="button" data-act="xc-drafts" data-slot="' + esc(slotName) + '">' + esc(tr("Drafts")) + "</button>" + postButton(slotName) + "</div>";
  }
  function inlineHtml(place, post) {
    bindUi();
    var slotName = place === "reply" ? "reply" : "post";
    if (slotName === "reply" && post) seedReply(post);
    return box(slotName, false);
  }
  function modalHtml() {
    bindUi();
    var slotName = slots[modalSlot] ? modalSlot : "post";
    return '<div class="modal-back" data-act="close-modal"><div class="modal xc-modal" role="dialog" aria-modal="true" aria-label="' + esc(tr("Post")) + '" data-act="stop">'
      + header(slotName) + '<div class="xc-scroll">' + box(slotName, true) + "</div>" + replyRow(slotName) + '<div class="xc-foot">' + tools(slotName, false) + "</div>" + panels(slotName) + "</div></div>";
  }

  function snapshot(slotName) {
    var slot = slots[slotName];
    return {
      id: "current:" + slotName, slot: slotName, at: Date.now(),
      posts: slot.posts.map(function (post) { return String(post.text || "").slice(0, 2000); }),
      replies: slot.posts.map(function (post) { return String(post.replyTo || "").slice(0, 80); }),
      link: String(slot.link || "").slice(0, 300),
      hashtags: (slot.hashtags || []).slice(0, 10),
      replyTo: String(slot.replyTo || "").slice(0, 22),
      quoteUrl: String(slot.quoteUrl || "").slice(0, 300),
      context: String(slot.context || "").slice(0, 32),
      audience: slot.audience, replyControl: slot.replyControl, location: slot.location || "",
      poll: slot.poll, scheduleAt: slot.scheduleAt || 0
    };
  }
  function applySnapshot(slotName, item) {
    if (!item) return;
    var slot = slots[slotName];
    var posts = Array.isArray(item.posts) && item.posts.length ? item.posts.slice(0, 25) : [""];
    slot.posts = posts.map(function (text, index) {
      return { text: String(text || ""), replyTo: String((item.replies && item.replies[index]) || "") };
    });
    slot.link = String(item.link || "");
    slot.hashtags = Array.isArray(item.hashtags) ? item.hashtags.slice(0, 10) : [];
    slot.replyTo = String(item.replyTo || slot.replyTo || "");
    slot.quoteUrl = String(item.quoteUrl || slot.quoteUrl || "");
    if (!slot.context) slot.context = String(item.context || "");
    if (item.audience) slot.audience = item.audience;
    if (item.replyControl) slot.replyControl = item.replyControl;
    slot.location = String(item.location || "");
    slot.poll = item.poll && item.poll.options ? item.poll : null;
    slot.scheduleAt = Number(item.scheduleAt) || 0;
    var kept = draftMedia[item.id];
    if (kept) slot.media = kept.slice();
  }
  function saveSoon(slotName) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var doc = draftDoc();
      var snap = snapshot(slotName);
      var next = doc.items.filter(function (item) { return item.id !== snap.id; });
      next.unshift(snap);
      writeStore(DRAFT_KEY, { items: next.slice(0, 21) });
    }, 400);
  }
  function toast(message) {
    if (host && host.toast) host.toast(message);
  }
  function paint() {
    var active = document.activeElement;
    var id = active && active.id;
    var caret = active && typeof active.selectionStart === "number" ? active.selectionStart : null;
    if (host && host.render) host.render();
    if (!id) return;
    var el = document.getElementById(id);
    if (!el) return;
    el.focus();
    if (caret != null && el.setSelectionRange) {
      try { el.setSelectionRange(caret, caret); } catch (err) { /* the field still has the text */ }
    }
  }
  function syncText(slotName, index) {
    var text = slots[slotName].posts[index].text;
    document.querySelectorAll("textarea[data-xc='text']").forEach(function (node) {
      if (node.getAttribute("data-slot") === slotName && Number(node.getAttribute("data-index") || 0) === index && node.value !== text) node.value = text;
    });
    if (slotName === "post" && index === 0 && host && host.setSeed) host.setSeed(text);
  }
  function grow(area) {
    if (!area) return;
    if (area.closest && area.closest(".xc-folded")) {
      area.style.height = "24px";
      return;
    }
    area.style.height = "auto";
    var next = Math.max(area.scrollHeight, area.classList.contains("xc-next") ? 72 : 52);
    area.style.height = next + "px";
  }
  function paintChrome(slotName) {
    document.querySelectorAll("[data-xc='count'][data-slot='" + slotName + "']").forEach(function (node) {
      node.innerHTML = meter(measure(slots[slotName], Number(node.getAttribute("data-index") || 0)));
    });
    var ok = canPost(slots[slotName]);
    document.querySelectorAll(".xc-post-btn[data-slot='" + slotName + "']").forEach(function (node) { node.disabled = !ok; });
    document.querySelectorAll("a.xc-intent").forEach(function (node) {
      if (node.getAttribute("data-slot") !== slotName) return;
      var index = Number(node.getAttribute("data-index") || 0);
      var info = measure(slots[slotName], index);
      var text = String((slots[slotName].posts[index] || {}).text || "").trim();
      if (info.left >= 0 && text) {
        node.href = intentFor(slots[slotName], index);
        node.removeAttribute("aria-disabled");
      } else {
        node.removeAttribute("href");
        node.setAttribute("aria-disabled", "true");
      }
    });
    document.querySelectorAll("textarea[data-xc='text'][data-slot='" + slotName + "']").forEach(function (area) {
      var hi = area.parentElement && area.parentElement.querySelector(".xc-highlight");
      var index = Number(area.getAttribute("data-index") || 0);
      if (hi) hi.innerHTML = marks(slots[slotName].posts[index].text || "");
      grow(area);
    });
  }
  function paintSuggest(area) {
    var boxNode = area.parentElement && area.parentElement.querySelector("[data-xc='suggest']");
    if (!boxNode) return;
    var token = core.tokenAt(area.value, area.selectionStart);
    if (!token) { boxNode.hidden = true; boxNode.innerHTML = ""; return; }
    var rows = host && host.suggest ? host.suggest(token.kind) : [];
    var list = core.suggestTokens(token.kind, token.query, rows);
    if (!list.length) { boxNode.hidden = true; boxNode.innerHTML = ""; return; }
    boxNode.hidden = false;
    boxNode.innerHTML = list.map(function (item) {
      var shown = (token.kind === "tag" ? "#" : "@") + item;
      return '<button type="button" data-act="xc-pick" data-slot="' + esc(area.getAttribute("data-slot")) + '" data-index="' + esc(area.getAttribute("data-index") || "0") + '" data-start="' + token.start + '" data-kind="' + token.kind + '" data-value="' + esc(item) + '">' + esc(shown) + "</button>";
    }).join("");
  }
  function copyText(value) {
    var text = String(value || "");
    if (!text) { toast(tr("Nothing copied")); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast(tr("Copied")); }).catch(function () { toast(tr("Nothing copied")); });
    else toast(tr("Nothing copied"));
  }
  function moveItem(list, from, dir) {
    var to = from + dir;
    if (!list || to < 0 || to >= list.length) return;
    var item = list.splice(from, 1)[0];
    list.splice(to, 0, item);
  }
  function addFiles(slotName, list, kind) {
    var slot = slots[slotName];
    if (slot.poll) {
      toast(tr("Use up to 4 images, or 1 video, or 1 GIF. Don’t mix them."));
      return;
    }
    var incoming = Array.prototype.slice.call(list || []);
    if (!incoming.length) return;
    var next = slot.media.slice();
    incoming.forEach(function (file) {
      if (!file || file.size > MAX_BYTES) return;
      var typed = fileType(file);
      var useKind = kind;
      if (kind === "camera") useKind = "image";
      if (kind === "image" && typed === "image/gif") useKind = "gif";
      var type = useKind === "gif" ? "image/gif" : useKind === "video" ? (typed.indexOf("video/") === 0 ? typed : "video/mp4") : useKind === "audio" ? (typed.indexOf("audio/") === 0 ? typed : "audio/webm") : (typed.indexOf("image/") === 0 && typed !== "image/gif" ? typed : "image/png");
      next.push({ file: file, type: type, alt: "", url: URL.createObjectURL(file), kind: useKind === "camera" ? "image" : useKind });
    });
    var check = core.classifyMedia(next.map(function (item) { return { type: item.type }; }));
    if (!check.ok) {
      next.slice(slot.media.length).forEach(function (item) { URL.revokeObjectURL(item.url); });
      toast(tr("Use up to 4 images, or 1 video, or 1 GIF. Don’t mix them."));
      return;
    }
    slot.media = next;
    panel = "";
    paint();
  }
  function insertText(slotName, index, extra) {
    var post = slots[slotName].posts[index];
    if (!post) return;
    var area = document.getElementById(fieldId(slotName, index));
    var text = String(post.text || "");
    var start = area && typeof area.selectionStart === "number" ? area.selectionStart : text.length;
    var end = area && typeof area.selectionEnd === "number" ? area.selectionEnd : start;
    post.text = (text.slice(0, start) + extra + text.slice(end)).slice(0, 2000);
    syncText(slotName, index);
  }
  function payloadOf(slotName) {
    var slot = slots[slotName];
    return {
      posts: slot.posts.map(function (post, index) {
        return {
          text: String(post.text || "").slice(0, 2000),
          media: index === 0 ? slot.media.map(function (item) { return { file: item.file, alt: item.alt || "", type: item.type, kind: item.kind }; }) : [],
          poll: index === 0 && pollReady(slot) ? { options: slot.poll.options.map(function (item) { return String(item || "").trim(); }).filter(Boolean), minutes: slot.poll.minutes } : null,
          location: index === 0 ? slot.location : "",
          audience: slot.audience,
          listIds: slot.audience === "lists" && typeof window !== "undefined" && window.AudienceLists && window.AudienceLists.selectedLists ? window.AudienceLists.selectedLists(document) : [],
          replyControl: slot.replyControl,
          scheduleAt: index === 0 ? (slot.scheduleAt || 0) : 0
        };
      }).filter(function (post) { return post.text.trim() || post.media.length || post.poll; }),
      parentId: slot.appParent || "",
      quoteId: slot.appQuote || "",
      replyTo: slot.replyTo || "",
      quoteUrl: slot.quoteUrl || "",
      link: slot.link || ""
    };
  }
  function clearContent(slotName) {
    var slot = slots[slotName];
    slot.media.forEach(function (media) { if (media.url) URL.revokeObjectURL(media.url); });
    var keepParent = slot.appParent;
    var keepQuote = slot.appQuote;
    var keepReply = slot.replyTo;
    var keepUrl = slot.quoteUrl;
    var keepContext = slot.context;
    var keepSource = slot.sourceText;
    var keepKey = slot.targetKey;
    var keepBody = slot.quoteBody;
    var keepName = slot.quoteName;
    slots[slotName] = blank();
    slots[slotName].appParent = keepParent;
    slots[slotName].appQuote = keepQuote;
    slots[slotName].replyTo = keepReply;
    slots[slotName].quoteUrl = keepUrl;
    slots[slotName].context = keepContext;
    slots[slotName].sourceText = keepSource;
    slots[slotName].targetKey = keepKey;
    slots[slotName].quoteBody = keepBody;
    slots[slotName].quoteName = keepName;
    if (slotName === "post" && host && host.setSeed) host.setSeed("");
  }
  function publish(slotName) {
    if (panel === "confirm") return;
    slotName = slots[slotName] ? slotName : (host && host.modalOpen && host.modalOpen() ? modalSlot : "post");
    var slot = slots[slotName];
    if (slot.poll && !pollReady(slot)) { toast(tr("A poll needs two choices.")); return; }
    if (slot.scheduleAt && slot.posts.length > 1) { toast(tr("A scheduled post is one post.")); return; }
    if (!canPost(slot)) {
      toast(measure(slot, 0).left < 0 ? tr("Over the limit") : tr("Post"));
      return;
    }
    var payload = payloadOf(slotName);
    clearContent(slotName);
    panel = "";
    aiMenu = "";
    if (host && host.publish) host.publish(payload);
    else if (payload.posts[0]) window.open(intentFor(slot, 0), "_blank", "noopener");
  }
  function closeSheet() {
    panel = "";
    if (host && host.closeModal) host.closeModal();
    else paint();
  }
  function requestClose() {
    if (!(host && host.modalOpen && host.modalOpen())) return false;
    if (panel === "confirm") { discard(modalSlot); return true; }
    if (panel || aiMenu) { panel = ""; aiMenu = ""; aiTones = false; paint(); return true; }
    if (dirty(modalSlot)) { panel = "confirm"; paint(); return true; }
    return false;
  }
  function onEscape() {
    if (aiMenu && !(host && host.modalOpen && host.modalOpen())) {
      aiMenu = "";
      aiTones = false;
      paint();
      return true;
    }
    if (host && host.modalOpen && host.modalOpen()) return requestClose();
    return false;
  }
  function discard(slotName) {
    clearContent(slotName || modalSlot);
    if ((slotName || modalSlot) === "post" && host && host.saveLocal) host.saveLocal("");
    panel = "";
    closeSheet();
  }
  function saveNamed(slotName) {
    var doc = draftDoc();
    var snap = snapshot(slotName);
    snap.id = "d" + Date.now();
    draftMedia[snap.id] = (slots[slotName].media || []).slice();
    doc.items = [snap].concat(doc.items.filter(function (item) { return String(item.id).indexOf("current:") !== 0; })).slice(0, 21);
    writeStore(DRAFT_KEY, doc);
    if (slotName === "post" && host && host.saveLocal) host.saveLocal(slots[slotName].posts[0].text || "");
    if (slotName === "post" && host && host.setSeed) host.setSeed(slots[slotName].posts[0].text || "");
    panel = "";
    toast(tr("Draft saved on this device"));
    closeSheet();
  }
  function seedReply(post) {
    var id = String((post && (post.statusId || post.id)) || "");
    if (/^\d{5,22}$/.test(id) && !slots.reply.replyTo) slots.reply.replyTo = id;
    if (/^[a-f0-9]{32}$/.test(id)) slots.reply.appParent = id;
    if (!slots.reply.context) slots.reply.context = String((post && post.handle) || "").replace(/^@/, "");
    if (!slots.reply.targetKey) slots.reply.targetKey = String((post && post.id) || "");
    if (post && (post.text || post.body)) slots.reply.sourceText = String(post.text || post.body).slice(0, 2000);
  }
  function preparePost(text) {
    modalSlot = "post";
    if (text) slots.post.posts[0].text = String(text).slice(0, 2000);
    if (host && host.setSeed) host.setSeed(slots.post.posts[0].text || "");
  }
  function openReply(post) {
    modalSlot = "reply";
    slots.reply.quoteUrl = "";
    slots.reply.appQuote = "";
    seedReply(post || {});
    if (host && host.openModal) host.openModal();
  }
  function openQuote(post) {
    var id = String((post && (post.statusId || post.id)) || "");
    modalSlot = "quote";
    slots.quote = blank();
    if (/^\d{5,22}$/.test(id)) slots.quote.quoteUrl = "https://x.com/i/status/" + id;
    if (/^[a-f0-9]{32}$/.test(id)) slots.quote.appQuote = id;
    slots.quote.quoteBody = String((post && (post.text || post.body)) || "").slice(0, 500);
    slots.quote.quoteName = String((post && (post.author || post.name || post.handle)) || "").slice(0, 80);
    slots.quote.context = String((post && post.handle) || "").replace(/^@/, "");
    slots.quote.targetKey = String((post && post.id) || "");
    if (host && host.openModal) host.openModal();
  }
  function searchGif(slotName) {
    gifError = "";
    if (!gifQ.trim()) { gifItems = []; paint(); return; }
    if (!host || !host.signedIn || !host.signedIn() || !host.gifSearch) {
      gifBusy = false;
      gifItems = [];
      gifError = tr("GIF search isn’t available right now.");
      paint();
      return;
    }
    gifBusy = true;
    paint();
    host.gifSearch(gifQ.trim()).then(function (res) {
      gifBusy = false;
      gifItems = res && res.gifs ? res.gifs.slice(0, 12) : [];
      if (!gifItems.length) gifError = tr("GIF search isn’t available right now.");
      paint();
    }).catch(function () {
      gifBusy = false;
      gifItems = [];
      gifError = tr("GIF search isn’t available right now.");
      paint();
    });
  }
  function toggleVoice(slotName) {
    if (recorder) { recorder.stop(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
      toast(tr("Microphone isn’t available on this device."));
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var mime = "";
      try { if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported("audio/webm")) mime = "audio/webm"; } catch (err) { mime = ""; }
      try { recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
      catch (err) { recorder = new MediaRecorder(stream); }
      recordSlot = slotName;
      var chunks = [];
      recorder.ondataavailable = function (event) { if (event.data && event.data.size) chunks.push(event.data); };
      recorder.onstop = function () {
        stream.getTracks().forEach(function (track) { track.stop(); });
        var type = (recorder && recorder.mimeType) || mime || "audio/webm";
        var blob = new Blob(chunks, { type: type });
        var file = new File([blob], "voice.webm", { type: type });
        recorder = null;
        recordSlot = "";
        addFiles(slotName, [file], "audio");
      };
      recorder.start();
      paint();
    }).catch(function () { toast(tr("Microphone isn’t available on this device.")); });
  }

  function onAct(act, el) {
    var slotName = el.getAttribute("data-slot") || modalSlot;
    var slot = slots[slotName] || slots.post;
    if (act === "xc-fold") {
      var foldPrefs = readFold();
      writeFold({ open: false, auto: foldPrefs.auto });
      scrollFold = false;
      var active = document.activeElement;
      if (active && active.blur && active.closest && active.closest("[data-home-compose='1']")) active.blur();
      applyFoldDom(true);
      return true;
    }
    if (act === "xc-fold-auto") {
      var autoPrefs = readFold();
      var nextAuto = !autoPrefs.auto;
      writeFold({ open: autoPrefs.open, auto: nextAuto });
      if (!nextAuto) scrollFold = false;
      paint();
      return true;
    }
    if (act === "xc-ai") {
      aiTones = false;
      aiMenu = aiMenu === slotName ? "" : slotName;
      panel = "";
      var aiHost = el.closest ? el.closest(".xc-ai") : null;
      if (!aiHost) { paint(); return true; }
      var existingPop = aiHost.querySelector(".xc-ai-pop");
      if (existingPop) existingPop.remove();
      var aiBtn = aiHost.querySelector(".xc-ai-btn");
      if (aiBtn) aiBtn.setAttribute("aria-expanded", aiMenu === slotName ? "true" : "false");
      if (aiMenu === slotName) {
        menuOpenedAt = Date.now();
        aiHost.insertAdjacentHTML("beforeend", aiMenuHtml(slotName));
      }
      return true;
    }
    if (act === "xc-ai-tones") { aiMenu = slotName; aiTones = !aiTones; paint(); return true; }
    if (act === "xc-ai-run") { runAi(slotName, Number(el.getAttribute("data-index") || 0), el.getAttribute("data-kind") || "grammar", el.getAttribute("data-tone") || ""); return true; }
    if (act === "xc-ai-pick") { if (aiPreview && aiPreview.slot === slotName) aiPreview.pick = Number(el.getAttribute("data-i") || 0); paint(); return true; }
    if (act === "xc-ai-dismiss") { aiPreview = null; aiBusy = null; aiJob += 1; paint(); return true; }
    if (act === "xc-ai-apply") {
      if (aiPreview && aiPreview.slot === slotName) {
        var chosen = aiPreview.suggestions && aiPreview.suggestions.length ? (aiPreview.suggestions[aiPreview.pick] || aiPreview.suggestions[0]) : aiPreview.text;
        var at = aiPreview.index || 0;
        if (slot.posts[at]) slot.posts[at].text = String(chosen || "");
        syncText(slotName, at);
        saveSoon(slotName);
      }
      aiPreview = null;
      paint();
      return true;
    }
    if (act === "xc-file") {
      var root = el.closest(".xc-modal") || el.closest(".xc") || document;
      var input = root.querySelector('input[data-kind="' + (el.getAttribute("data-kind") || "image") + '"][data-slot="' + slotName + '"]') || root.querySelector('input[data-kind="' + (el.getAttribute("data-kind") || "image") + '"]');
      if (input) input.click();
      return true;
    }
    if (act === "xc-gif") { panel = panel === "gif" ? "" : "gif"; gifError = ""; paint(); return true; }
    if (act === "xc-gif-pick") {
      var item = gifItems[Number(el.getAttribute("data-i")) || 0];
      if (item && host && host.gifFile) {
        host.gifFile(item.url).then(function (blob) {
          if (!blob) { toast(tr("GIF search isn’t available right now.")); return; }
          addFiles(slotName, [new File([blob], "animation.gif", { type: "image/gif" })], "gif");
        }).catch(function () { toast(tr("GIF search isn’t available right now.")); });
      } else toast(tr("Pick a GIF from this device."));
      return true;
    }
    if (act === "xc-voice") { toggleVoice(slotName); return true; }
    if (act === "xc-poll") {
      if (slot.media.length) { toast(tr("Use up to 4 images, or 1 video, or 1 GIF. Don’t mix them.")); return true; }
      slot.poll = slot.poll ? null : { options: ["", ""], minutes: 1440 };
      paint();
      return true;
    }
    if (act === "xc-poll-add") { if (slot.poll && slot.poll.options.length < 4) slot.poll.options.push(""); paint(); return true; }
    if (act === "xc-poll-del") { if (slot.poll && slot.poll.options.length > 2) slot.poll.options.splice(Number(el.getAttribute("data-i")) || 0, 1); paint(); return true; }
    if (act === "xc-poll-remove") { slot.poll = null; paint(); return true; }
    if (act === "xc-location") { panel = panel === "location" ? "" : "location"; paint(); return true; }
    if (act === "xc-locate") {
      if (!navigator.geolocation) { toast(tr("Location isn’t available on this device.")); return true; }
      navigator.geolocation.getCurrentPosition(function () {
        slot.location = tr("Current location");
        panel = "";
        paint();
      }, function () { toast(tr("Location isn’t available on this device.")); }, { timeout: 8000, maximumAge: 600000 });
      return true;
    }
    if (act === "xc-location-clear") { slot.location = ""; panel = ""; paint(); return true; }
    if (act === "xc-schedule") {
      if (slot.posts.length > 1) { toast(tr("A scheduled post is one post.")); return true; }
      panel = panel === "schedule" ? "" : "schedule";
      paint();
      return true;
    }
    if (act === "xc-schedule-clear") { slot.scheduleAt = 0; panel = ""; paint(); return true; }
    if (act === "xc-emoji") { slot.emoji = !slot.emoji; paint(); return true; }
    if (act === "xc-emoji-add") {
      insertText(slotName, 0, EMOJI[Number(el.getAttribute("data-i")) || 0] || "");
      slot.emoji = false;
      paintChrome(slotName);
      saveSoon(slotName);
      return true;
    }
    if (act === "xc-add-post") {
      if (slot.scheduleAt) { toast(tr("A scheduled post is one post.")); return true; }
      if (slot.posts.length >= 25) return true;
      slot.posts.push({ text: "", replyTo: "" });
      paint();
      return true;
    }
    if (act === "xc-remove-post") {
      var at = Number(el.getAttribute("data-index") || 0);
      if (at > 0) slot.posts.splice(at, 1);
      paint();
      return true;
    }
    if (act === "xc-post-move") { moveItem(slot.posts, Number(el.getAttribute("data-index") || 0), Number(el.getAttribute("data-dir")) || 0); paint(); return true; }
    if (act === "xc-media-move") { moveItem(slot.media, Number(el.getAttribute("data-index") || 0), Number(el.getAttribute("data-dir")) || 0); paint(); return true; }
    if (act === "xc-remove-media") {
      var media = slot.media.splice(Number(el.getAttribute("data-index") || 0), 1)[0];
      if (media && media.url) URL.revokeObjectURL(media.url);
      paint();
      return true;
    }
    if (act === "xc-alt") { panel = panel === "alt:" + el.getAttribute("data-index") ? "" : "alt:" + el.getAttribute("data-index"); paint(); return true; }
    if (act === "xc-audience-menu") {
      panel = panel === "audience" ? "" : "audience";
      if (panel === "audience") menuOpenedAt = Date.now();
      paint();
      return true;
    }
    if (act === "xc-audience") { slot.audience = el.getAttribute("data-value") || "everyone"; panel = ""; paint(); return true; }
    if (act === "xc-reply-menu") { panel = panel === "reply" ? "" : "reply"; paint(); return true; }
    if (act === "xc-reply-pick") { slot.replyControl = el.getAttribute("data-value") || "everyone"; panel = ""; paint(); return true; }
    if (act === "xc-pick") {
      var index = Number(el.getAttribute("data-index") || 0);
      var start = Number(el.getAttribute("data-start") || 0);
      var value = el.getAttribute("data-value") || "";
      var kind = el.getAttribute("data-kind") === "tag" ? "#" : "@";
      var text = slot.posts[index].text;
      var end = start + 1;
      while (end < text.length && /[A-Za-z0-9_]/.test(text.charAt(end))) end += 1;
      slot.posts[index].text = text.slice(0, start) + kind + value + " " + text.slice(end);
      syncText(slotName, index);
      paintChrome(slotName);
      document.querySelectorAll("[data-xc='suggest']").forEach(function (node) { node.hidden = true; node.innerHTML = ""; });
      return true;
    }
    if (act === "xc-drafts") { panel = panel === "drafts" ? "" : "drafts"; paint(); return true; }
    if (act === "xc-open-draft") {
      var found = draftDoc().items.find(function (item) { return item.id === el.getAttribute("data-id"); });
      if (found) applySnapshot(found.slot || slotName, found);
      panel = "";
      paint();
      return true;
    }
    if (act === "xc-delete-draft") {
      var left = draftDoc();
      left.items = left.items.filter(function (item) { return item.id !== el.getAttribute("data-id"); });
      delete draftMedia[el.getAttribute("data-id")];
      writeStore(DRAFT_KEY, left);
      paint();
      return true;
    }
    if (act === "xc-save-draft") { saveNamed(slotName); return true; }
    if (act === "xc-discard") { discard(slotName); return true; }
    if (act === "xc-publish") { publish(slotName); return true; }
    if (act === "xc-reply") {
      var replyPost = host && host.post ? host.post(el.getAttribute("data-id")) : null;
      if (replyPost) openReply(replyPost);
      return true;
    }
    if (act === "xc-quote") {
      var quotePost = host && host.post ? host.post(el.getAttribute("data-id")) : null;
      if (quotePost) openQuote(quotePost);
      return true;
    }
    if (act === "xc-partial-toggle") {
      var prefs = readPartial();
      prefs.on = !prefs.on;
      if (prefs.on) prefs.nextAt = 0;
      writePartial(prefs);
      paint();
      if (prefs.on) scan();
      return true;
    }
    if (act === "xc-partial-save") {
      var input = document.getElementById("xc-handle");
      var saved = readPartial();
      saved.handle = cleanHandle(input && input.value);
      partialDraft = input && input.value ? String(input.value).replace(/^@/, "").slice(0, 15) : "";
      if (String(input && input.value || "").trim() && !saved.handle) saved.handle = "";
      writePartial(saved);
      toast(tr("Saved on this device"));
      return true;
    }
    return false;
  }

  function onInput(event) {
    var el = event.target;
    if (!el || !el.getAttribute) return;
    var kind = el.getAttribute("data-xc");
    if (!kind) return;
    var slotName = el.getAttribute("data-slot") || "";
    var slot = slots[slotName];
    if (kind === "text" && slot) {
      var index = Number(el.getAttribute("data-index") || 0);
      if (!slot.posts[index]) return;
      slot.posts[index].text = el.value;
      if (index === 0) slot.link = firstUrl(el.value);
      syncText(slotName, index);
      paintChrome(slotName);
      paintSuggest(el);
      saveSoon(slotName);
    } else if (kind === "alt" && slot) {
      var item = slot.media[Number(el.getAttribute("data-index") || 0)];
      if (item) item.alt = el.value.slice(0, 1000);
    } else if (kind === "poll-opt" && slot && slot.poll) {
      slot.poll.options[Number(el.getAttribute("data-i")) || 0] = el.value.slice(0, 25);
      paintChrome(slotName);
    } else if (kind === "location" && slot) {
      slot.location = el.value.slice(0, 80);
    } else if (kind === "schedule" && slot) {
      var at = el.value ? new Date(el.value).getTime() : 0;
      slot.scheduleAt = at && at > Date.now() ? at : 0;
    } else if (kind === "gif-q") {
      gifQ = el.value.slice(0, 40);
    } else if (kind === "handle") {
      partialDraft = String(el.value || "").replace(/^@/, "").slice(0, 15);
    }
  }
  function onChange(event) {
    var el = event.target;
    if (!el || !el.getAttribute) return;
    if (el.getAttribute("data-xc") === "file") {
      var kind = el.getAttribute("data-kind");
      addFiles(el.getAttribute("data-slot"), el.files, kind === "camera" ? "image" : kind);
      el.value = "";
      return;
    }
    if (el.getAttribute("data-xc") === "poll-min") {
      var slot = slots[el.getAttribute("data-slot")];
      if (slot && slot.poll) slot.poll.minutes = Number(el.value) || 1440;
    }
  }
  function bindUi() {
    if (bound) return;
    bound = true;
    document.addEventListener("input", onInput);
    document.addEventListener("change", onChange);
    function expandFrom(event) {
      var target = event.target;
      if (!target || !target.closest) return;
      if (!target.closest(".xc-inline.xc-folded[data-home-compose='1']")) return;
      expandHome();
    }
    document.addEventListener("pointerdown", expandFrom, true);
    document.addEventListener("mousedown", expandFrom, true);
    document.addEventListener("focusin", function (event) {
      var target = event.target;
      if (!target || !target.closest || !target.getAttribute || target.getAttribute("data-xc") !== "text") return;
      if (!target.closest(".xc-inline.xc-folded[data-home-compose='1']")) return;
      expandHome();
    });
    document.addEventListener("click", function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var node = target.closest(".xc-inline.xc-folded[data-home-compose='1']");
      if (!node) return;
      if (target.closest("button, a, textarea, input, select")) return;
      var area = node.querySelector("textarea[data-xc='text']");
      if (area && area.focus) area.focus();
    });
    var lastScroll = window.pageYOffset || 0;
    function onHomeScroll() {
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      var prefs = readFold();
      var down = y > lastScroll + 16;
      var nearTop = y < 16;
      lastScroll = y;
      if (!prefs.auto || !prefs.open || homeBusy()) return;
      if (down && y > 56) {
        if (!scrollFold) {
          scrollFold = true;
          applyFoldDom(true);
        }
      } else if (nearTop && scrollFold) {
        scrollFold = false;
        applyFoldDom(false);
      }
    }
    try { window.addEventListener("scroll", onHomeScroll, { passive: true }); }
    catch (err) { window.addEventListener("scroll", onHomeScroll); }
    if (window.matchMedia) {
      try {
        var foldMq = window.matchMedia("(max-width: 700px)");
        var onFoldMq = function () {
          var saved = readStore(FOLD_KEY);
          if (saved && typeof saved.open === "boolean") return;
          scrollFold = false;
          applyFoldDom(homeFolded());
        };
        if (foldMq.addEventListener) foldMq.addEventListener("change", onFoldMq);
        else if (foldMq.addListener) foldMq.addListener(onFoldMq);
      } catch (err2) { /* the first paint keeps the width it opened with */ }
    }
    document.addEventListener("paste", function (event) {
      var el = event.target;
      if (!el || !el.getAttribute || el.getAttribute("data-xc") !== "text") return;
      var items = event.clipboardData && event.clipboardData.items;
      if (!items) return;
      var files = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === "file" && String(items[i].type || "").indexOf("image/") === 0) {
          var file = items[i].getAsFile();
          if (file) files.push(file);
        }
      }
      if (!files.length) return;
      event.preventDefault();
      addFiles(el.getAttribute("data-slot"), files, files[0].type === "image/gif" ? "gif" : "image");
    });
    document.addEventListener("click", function (event) {
      var link = event.target.closest && event.target.closest("a.xc-intent");
      if (!link) return;
      if (link.getAttribute("aria-disabled") === "true" || !link.getAttribute("href")) {
        event.preventDefault();
        toast(tr("Over the limit"));
        return;
      }
      var slotName = link.getAttribute("data-slot") || "post";
      var index = Number(link.getAttribute("data-index") || 0);
      var text = slots[slotName] && slots[slotName].posts[index] ? slots[slotName].posts[index].text : "";
      if (host && host.saveLocal && slotName === "post") host.saveLocal(text);
      toast(tr("Saved on this device. X opened in a new tab"));
    }, true);
    document.addEventListener("click", function (event) {
      if (!aiMenu && panel !== "audience") return;
      if (Date.now() - menuOpenedAt < 350) return;
      var target = event.target;
      if (target && target.closest && (target.closest(".xc-ai") || target.closest(".xc-aud-wrap") || target.closest(".xc-panel"))) return;
      var changed = false;
      if (aiMenu) { aiMenu = ""; aiTones = false; changed = true; }
      if (panel === "audience") { panel = ""; changed = true; }
      if (changed) paint();
    }, true);
    document.addEventListener("keydown", function (event) {
      var open = host && host.modalOpen && host.modalOpen();
      var typing = event.target && event.target.getAttribute && event.target.getAttribute("data-xc") === "text";
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && (open || typing)) {
        event.preventDefault();
        publish(open ? modalSlot : (event.target.getAttribute("data-slot") || "post"));
        return;
      }
      if (event.key === "Escape" && aiMenu && !open) {
        aiMenu = "";
        aiTones = false;
        paint();
      }
    });
    document.addEventListener("dragstart", function (event) {
      var el = event.target.closest && event.target.closest("[data-drag]");
      if (!el) return;
      dragFrom = { kind: el.getAttribute("data-drag"), index: Number(el.getAttribute("data-index")), slot: el.getAttribute("data-slot") };
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    document.addEventListener("dragover", function (event) {
      var el = event.target.closest && event.target.closest("[data-drag]");
      if (!el || !dragFrom) return;
      event.preventDefault();
    });
    document.addEventListener("drop", function (event) {
      var el = event.target.closest && event.target.closest("[data-drag]");
      if (!el || !dragFrom || el.getAttribute("data-drag") !== dragFrom.kind) return;
      event.preventDefault();
      var slot = slots[el.getAttribute("data-slot") || dragFrom.slot];
      if (!slot) return;
      var to = Number(el.getAttribute("data-index"));
      var list = dragFrom.kind === "media" ? slot.media : slot.posts;
      moveItem(list, dragFrom.index, to - dragFrom.index);
      dragFrom = null;
      paint();
    });
    document.addEventListener("mousedown", function (event) {
      if (event.target.closest && event.target.closest(".xc-suggest")) event.preventDefault();
    });
    var gifTimer = 0;
    document.addEventListener("input", function (event) {
      if (!event.target || event.target.getAttribute("data-xc") !== "gif-q") return;
      clearTimeout(gifTimer);
      gifTimer = setTimeout(function () { searchGif(event.target.getAttribute("data-slot") || modalSlot); }, 350);
    });
  }

  function scan() {
    var prefs = readPartial();
    if (!prefs.on || scanning) return;
    var handle = cleanHandle(prefs.handle) || linkedHandle();
    if (!handle) return;
    if (prefs.nextAt && Date.now() < prefs.nextAt) return;
    if (!host || !host.recentPosts) return;
    scanning = true;
    host.recentPosts(handle).then(function (pack) {
      var posts = (pack && pack.posts) || [];
      var limited = !!(pack && pack.limited);
      return Promise.all(posts.slice(0, 3).map(function (post) {
        if (!host.conversation) return { replies: [], limited: false };
        return host.conversation(post.statusId || post.id);
      })).then(function (pages) {
        var notes = [];
        pages.forEach(function (page, index) {
          if (!page) return;
          if (page.limited) limited = true;
          var parent = posts[index] && (posts[index].statusId || posts[index].id);
          notes = notes.concat(core.partialNotesFromReplies(page.replies || [], handle, parent));
        });
        if (notes.length && host.ingest) host.ingest(notes);
        var delay = core.nextPollDelay(prefs.gap, limited ? "backoff" : "ok");
        writePartial({ on: true, handle: prefs.handle, nextAt: Date.now() + delay, gap: delay, wait: limited });
      });
    }).catch(function () {
      var delay = core.nextPollDelay(prefs.gap, "backoff");
      writePartial({ on: true, handle: prefs.handle, nextAt: Date.now() + delay, gap: delay, wait: true });
    }).then(function () { scanning = false; });
  }
  function scheduleScan() {
    if (timer) return;
    var prefs = readPartial();
    var wait = prefs.on ? 8000 : 30000;
    if (prefs.on && prefs.nextAt) wait = Math.max(8000, Math.min(60000, prefs.nextAt - Date.now()));
    timer = setTimeout(function () {
      timer = 0;
      scan();
      scheduleScan();
    }, wait);
  }
  function settingsHtml() {
    var prefs = readPartial();
    if (partialDraft == null) partialDraft = prefs.handle || "";
    var on = prefs.on;
    return '<div class="set-block xc-settings"><h2>' + esc(tr("Direct posting stays off")) + "</h2><p class=\"phandle\">" + esc(tr("X charges for each post and for reading mentions. This app opens X’s own composer instead, which costs nothing here.")) + "</p>"
      + "<h2>" + esc(tr("Link X account")) + "</h2><p class=\"phandle\">" + esc(tr("Linking stays off. There is no free allowance for posting or for the mention inbox, so this app does not connect an X login.")) + "</p>"
      + "<h2>" + esc(tr("Partial X mentions")) + "</h2><p class=\"phandle\">" + esc(tr("This is not X’s mention inbox. It checks replies on a few of your recent public posts with the same public sources this app already uses.")) + "</p>"
      + '<button class="tab-switch' + (on ? " on" : "") + '" type="button" role="switch" aria-checked="' + (on ? "true" : "false") + '" data-act="xc-partial-toggle"><span>' + esc(tr("Check replies on my public posts")) + "</span><i></i></button>"
      + '<label class="field"><span>' + esc(tr("Public X handle")) + '</span><input id="xc-handle" data-xc="handle" maxlength="15" autocomplete="off" value="' + esc(partialDraft) + '"></label>'
      + '<p class="phandle">' + esc(tr("A saved public profile on this device is used when this box is empty. It is not an X login.")) + "</p>"
      + (prefs.wait ? '<p class="phandle">' + esc(tr("The last check did not finish. The next one waits longer.")) + "</p>" : "")
      + '<button class="primary" type="button" data-act="xc-partial-save">' + esc(tr("Save")) + "</button></div>";
  }
  function mentionsBanner() {
    var prefs = readPartial();
    if (!prefs.on) return "";
    return '<p class="xc-banner">' + esc(tr("Partial. Replies on recent public posts, not X's mention inbox.")) + "</p>";
  }
  function afterRender() {
    bindUi();
    scheduleScan();
    document.querySelectorAll("textarea[data-xc='text']").forEach(grow);
    tuneAudience();
    if (host && host.flushSchedule) host.flushSchedule();
  }

  var saved = draftDoc().items.find(function (item) { return item && item.id === "current:post"; });
  try { if (saved) applySnapshot("post", saved); }
  catch (err) { /* a damaged draft stays out of the box */ }

  globalThis.ViktorychXCompose = {
    inlineHtml: inlineHtml,
    modalHtml: modalHtml,
    settingsHtml: settingsHtml,
    mentionsBanner: mentionsBanner,
    onAct: onAct,
    afterRender: afterRender,
    preparePost: preparePost,
    openReply: openReply,
    openQuote: openQuote,
    requestClose: requestClose,
    onEscape: onEscape,
    publish: publish,
    bind: function (next) { host = next || null; }
  };
})();
