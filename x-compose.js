/* Composer that opens X's own post screen. No paid X API calls. */
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
      preparePost: function () {}
    };
    return;
  }

  var DRAFT_KEY = "viktorychapp-x-drafts-v1";
  var PARTIAL_KEY = "viktorychapp-x-partial-v1";
  var MAX_BYTES = 20 * 1024 * 1024;
  var EMOJI = ["😀", "😂", "🥹", "😊", "😍", "😘", "😎", "🤔", "😅", "😭", "😡", "🤯", "😴", "🤝", "👍", "👎", "👏", "🙏", "🔥", "✨", "💯", "❤️", "💙", "🎉", "✅", "❌", "⭐", "📌", "💬", "👀", "🚀", "🌈", "☀️", "🌙", "⚡", "🎵", "📷", "🎬", "🏆", "💡"];
  var host = null;
  var modalSlot = "post";
  var partialDraft = null;
  var showDrafts = false;
  var scanning = false;
  var timer = 0;
  var saveTimer = 0;
  var bound = false;
  var aiMenu = "";
  var aiTones = false;
  var aiBusy = null;
  var aiPreview = null;
  var aiToast = "";
  var aiToastSlot = "";
  var aiToastTimer = 0;
  var aiJob = 0;

  function blank() {
    return { posts: [{ text: "", replyTo: "" }], media: [], link: "", hashtags: [], replyTo: "", quoteUrl: "", context: "", targetKey: "", sourceText: "", emoji: false };
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
    gif: "",
    emoji: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm-4-7a4 4 0 0 0 8 0M9 10h.01M15 10h.01",
    plus: "M12 5v14M5 12h14",
    spark: "M12 2.2l1.7 5.4 5.5 1.5-5.5 1.6L12 16.2l-1.7-5.5L4.8 9.1l5.5-1.5L12 2.2zM18.2 13.2l.8 2.4 2.5.7-2.5.7-.8 2.5-.8-2.5-2.4-.7 2.4-.7.8-2.4z"
  };

  function readStore(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (err) { return null; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* this device is full */ }
  }
  function draftDoc() {
    var doc = readStore(DRAFT_KEY);
    return doc && Array.isArray(doc.items) ? doc : { items: [] };
  }
  function readPartial() {
    var doc = readStore(PARTIAL_KEY);
    var gap = Number(doc && doc.gap) || core.POLL_BASE_MS;
    return {
      on: !!(doc && doc.on),
      handle: String((doc && doc.handle) || "").replace(/^@/, "").slice(0, 15),
      nextAt: Number(doc && doc.nextAt) || 0,
      gap: gap,
      wait: !!(doc && doc.wait)
    };
  }
  function writePartial(prefs) {
    writeStore(PARTIAL_KEY, {
      on: !!prefs.on,
      handle: String(prefs.handle || "").replace(/^@/, "").slice(0, 15),
      nextAt: Number(prefs.nextAt) || 0,
      gap: Number(prefs.gap) || core.POLL_BASE_MS,
      wait: !!prefs.wait
    });
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
  function measure(slot, index) {
    var post = (slot.posts || [])[index] || { text: "" };
    var weight = core.composeWeight({
      text: post.text,
      hashtags: index === 0 ? slot.hashtags : [],
      url: index === 0 && !slot.quoteUrl ? slot.link : "",
      quote: !!(index === 0 && slot.quoteUrl)
    });
    var hasMedia = index === 0 && slot.media.length > 0;
    var hasText = String(post.text || "").trim().length > 0 || (index === 0 && (slot.hashtags || []).length > 0);
    var hasLink = index === 0 && /^https?:\/\//i.test(slot.link || slot.quoteUrl || "");
    var ok = weight <= 280 && (hasText || hasMedia || hasLink) && (weight > 0 || hasMedia);
    return { weight: weight, left: 280 - weight, ok: ok };
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
  function meter(info) {
    var circ = 50.27;
    var ratio = Math.max(0, Math.min(1, info.weight / 280));
    var cls = info.left < 0 ? "over" : info.left <= 20 ? "near" : "";
    var label = info.left <= 20 ? '<span>' + esc(String(info.left)) + '</span>' : "";
    return '<span class="xc-count ' + cls + '" aria-label="' + esc(tr("Characters left")) + '"><svg class="xc-meter" viewBox="0 0 20 20" aria-hidden="true"><circle class="xc-meter-track" cx="10" cy="10" r="8"></circle><circle class="xc-meter-val" cx="10" cy="10" r="8" stroke-dasharray="' + circ + '" stroke-dashoffset="' + (circ * (1 - ratio)).toFixed(2) + '"></circle></svg>' + label + '</span>';
  }
  function postLink(slotName, index, label, id) {
    var slot = slots[slotName];
    var info = measure(slot, index);
    var href = info.ok ? ' href="' + esc(intentFor(slot, index)) + '"' : "";
    var disabled = info.ok ? "" : ' aria-disabled="true"';
    var named = id ? ' id="' + esc(id) + '"' : "";
    var tip = index === 0 && slotName === "post" ? ' title="' + esc(tr("The draft stays on this device. You press Post on X.")) + '"' : "";
    return '<a class="save xc-post" target="_blank" rel="noopener noreferrer"' + named + tip + ' data-slot="' + esc(slotName) + '" data-index="' + index + '"' + href + disabled + ">" + esc(label) + "</a>";
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
    return slotName === "reply" || !!(slot && slot.replyTo);
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
      + tones
      + suggest
      + "</div>";
  }
  function aiButton(slotName) {
    if (!composeHelpOn()) return "";
    var open = aiMenu === slotName;
    return '<div class="xc-ai"><button class="xc-tool xc-ai-btn" type="button" data-act="xc-ai" data-slot="' + esc(slotName) + '" aria-label="' + esc(tr("Writing tools")) + '" aria-haspopup="menu" aria-expanded="' + (open ? "true" : "false") + '">' + icon(ICONS.spark) + "</button>"
      + (open ? aiMenuHtml(slotName) : "")
      + "</div>";
  }
  function aiExtra(slotName) {
    var html = "";
    if (aiBusy && aiBusy.slot === slotName) {
      html += '<div class="xc-ai-preview" role="status"><span class="xc-ai-spin" aria-hidden="true"></span><span>' + esc(tr("Working…")) + "</span></div>";
    } else if (aiPreview && aiPreview.slot === slotName) {
      var body = "";
      if (aiPreview.suggestions && aiPreview.suggestions.length) {
        body = '<div class="xc-ai-choices">' + aiPreview.suggestions.map(function (line, i) {
          return '<button type="button" class="xc-ai-choice' + (i === aiPreview.pick ? " on" : "") + '" data-act="xc-ai-pick" data-slot="' + esc(slotName) + '" data-i="' + i + '">' + esc(line) + "</button>";
        }).join("") + "</div>";
      } else {
        body = "<p>" + esc(aiPreview.text || "") + "</p>";
      }
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
  function tools(slotName) {
    return '<div class="xc-tools">'
      + '<button class="xc-tool" type="button" data-act="xc-file" data-slot="' + esc(slotName) + '" data-kind="image" aria-label="' + esc(tr("Image")) + '">' + icon(ICONS.image) + "</button>"
      + '<button class="xc-tool" type="button" data-act="xc-file" data-slot="' + esc(slotName) + '" data-kind="gif" aria-label="' + esc(tr("GIF")) + '"><span class="xc-gif">GIF</span></button>'
      + '<button class="xc-tool" type="button" data-act="xc-file" data-slot="' + esc(slotName) + '" data-kind="video" aria-label="' + esc(tr("Video")) + '"><span class="xc-gif">▶</span></button>'
      + '<button class="xc-tool" type="button" data-act="xc-emoji" data-slot="' + esc(slotName) + '" aria-label="' + esc(tr("Emoji")) + '">' + icon(ICONS.emoji) + "</button>"
      + (slotName === "reply" ? '<button class="xc-tool" type="button" data-gift="reply" data-parent="' + esc(slots.reply.replyTo || slots.reply.targetKey || "") + '" data-handle="' + esc(slots.reply.context || "") + '" aria-label="' + esc(tr("Send a gift")) + '">' + esc(tr("Gift")) + "</button>" : "")
      + aiButton(slotName)
      + '<button class="xc-tool" type="button" data-act="xc-add-post" data-slot="' + esc(slotName) + '" aria-label="' + esc(tr("Add post")) + '">' + icon(ICONS.plus) + "</button>"
      + '<span class="xc-end" data-xc="end" data-slot="' + esc(slotName) + '"><span data-xc="count" data-slot="' + esc(slotName) + '" data-index="0">' + meter(measure(slots[slotName], 0)) + "</span>" + postLink(slotName, 0, tr("Post to X")) + "</span></div>";
  }
  function hiddenFiles(slotName) {
    return '<input class="xc-file" data-xc="file" data-slot="' + esc(slotName) + '" data-kind="image" type="file" accept="image/jpeg,image/png,image/webp" multiple>'
      + '<input class="xc-file" data-xc="file" data-slot="' + esc(slotName) + '" data-kind="gif" type="file" accept="image/gif">'
      + '<input class="xc-file" data-xc="file" data-slot="' + esc(slotName) + '" data-kind="video" type="file" accept="video/mp4,video/webm,video/quicktime">';
  }
  function mediaHtml(slotName) {
    var slot = slots[slotName];
    if (!slot.media.length) return "";
    var shots = slot.media.map(function (item, index) {
      var body = item.kind === "video"
        ? '<video src="' + esc(item.url) + '" muted></video>'
        : '<img src="' + esc(item.url) + '" alt="' + esc(item.alt || "") + '">';
      return '<div class="xc-shot">' + body + '<button type="button" data-act="xc-remove-media" data-slot="' + esc(slotName) + '" data-index="' + index + '" aria-label="' + esc(tr("Remove")) + '">×</button></div>'
        + '<label class="xc-row"><span class="sr">' + esc(tr("Alt text")) + '</span><input class="xc-alt" data-xc="alt" data-slot="' + esc(slotName) + '" data-index="' + index + '" maxlength="1000" placeholder="' + esc(tr("Add a description")) + '" value="' + esc(item.alt || "") + '"></label>';
    }).join("");
    return '<div class="xc-media">' + shots + '</div><p class="xc-limit">' + esc(tr("The link can’t carry pictures. Share pictures sends them to the X app, or attach them after X opens. Alt text is copied.")) + "</p>";
  }
  function emojiHtml(slotName) {
    if (!slots[slotName].emoji) return "";
    var buttons = EMOJI.map(function (item, index) {
      return '<button type="button" data-act="xc-emoji-add" data-slot="' + esc(slotName) + '" data-i="' + index + '">' + item + "</button>";
    }).join("");
    return '<div class="xc-emoji">' + buttons + "</div>";
  }
  function threadHtml(slotName) {
    var slot = slots[slotName];
    if (slot.posts.length < 2) return "";
    return slot.posts.slice(1).map(function (post, offset) {
      var index = offset + 1;
      var id = fieldId(slotName, index);
      return '<div class="xc-part"><div class="xc-row"><strong>' + esc(tr("Next post")) + '</strong><button type="button" data-act="xc-remove-post" data-slot="' + esc(slotName) + '" data-index="' + index + '">' + esc(tr("Remove post")) + '</button></div>'
        + '<div class="xc-field"><textarea class="xc-text xc-next" data-xc="text" data-slot="' + esc(slotName) + '" data-index="' + index + '" id="' + esc(id) + '" maxlength="2000">' + esc(post.text || "") + '</textarea><div class="xc-suggest" data-xc="suggest" hidden></div></div>'
        + '<p class="xc-note">' + esc(tr("Paste the new post link to reply with the next part")) + '</p>'
        + '<input class="xc-link" data-xc="replyto" data-slot="' + esc(slotName) + '" data-index="' + index + '" placeholder="https://x.com/i/status/…" value="' + esc(post.replyTo || "") + '">'
        + '<div class="xc-row"><button type="button" data-act="xc-copy" data-slot="' + esc(slotName) + '" data-index="' + index + '">' + esc(tr("Copy next post")) + "</button>" + postLink(slotName, index, tr("Open next on X")) + '<span data-xc="count" data-slot="' + esc(slotName) + '" data-index="' + index + '">' + meter(measure(slot, index)) + "</span></div></div>";
    }).join("");
  }
  function extraHtml(slotName) {
    var slot = slots[slotName];
    var tags = (slot.hashtags || []).map(function (tag) {
      return '<button class="xc-chip" type="button" data-act="xc-remove-tag" data-slot="' + esc(slotName) + '" data-tag="' + esc(tag) + '">#' + esc(tag) + "</button>";
    }).join("");
    var share = slot.media.length ? '<button type="button" data-act="xc-share" data-slot="' + esc(slotName) + '">' + esc(tr("Share pictures")) + "</button>" : "";
    return '<div class="xc-row"><input class="xc-link" data-xc="link" data-slot="' + esc(slotName) + '" placeholder="' + esc(tr("Add a link")) + '" value="' + esc(slot.link || "") + '"></div>'
      + '<div class="xc-row"><input class="xc-tag" data-xc="tag" data-slot="' + esc(slotName) + '" maxlength="50" placeholder="' + esc(tr("Hashtags added by X")) + '" aria-label="' + esc(tr("Hashtags added by X")) + '"><button type="button" data-act="xc-add-tag" data-slot="' + esc(slotName) + '">' + esc(tr("Add")) + "</button></div>"
      + (tags ? '<div class="xc-chips">' + tags + "</div>" : "")
      + '<div class="xc-row">' + share + '<button type="button" data-act="xc-copy" data-slot="' + esc(slotName) + '" data-index="0">' + esc(tr("Copy text")) + '</button><button type="button" data-act="xc-drafts" data-slot="' + esc(slotName) + '">' + esc(tr("Drafts")) + '</button><button type="button" data-act="xc-new-draft" data-slot="' + esc(slotName) + '">' + esc(tr("New draft")) + "</button></div>"
      + draftsHtml(slotName)
      + '<p class="xc-note">' + esc(tr("You press Post on X.")) + " " + esc(tr("Polls and scheduling stay on X. This path can’t set them.")) + "</p>";
  }
  function draftsHtml(slotName) {
    if (!showDrafts) return "";
    var open = host && host.modalOpen && host.modalOpen();
    if (open && slotName !== modalSlot) return "";
    var items = draftDoc().items.filter(function (item) { return item && item.slot === slotName && item.id.indexOf("current:") !== 0; });
    if (!items.length) return '<p class="xc-note">' + esc(tr("Drafts")) + "</p>";
    return '<div class="xc-drafts">' + items.slice(0, 20).map(function (item) {
      var line = String((item.posts && item.posts[0]) || "").replace(/\s+/g, " ").slice(0, 80);
      return '<div class="xc-draft"><button class="xc-draft-open" type="button" data-act="xc-open-draft" data-id="' + esc(item.id) + '">' + esc(line || tr("Drafts")) + '</button><button type="button" data-act="xc-delete-draft" data-id="' + esc(item.id) + '">' + esc(tr("Delete draft")) + "</button></div>";
    }).join("") + "</div>";
  }
  function box(slotName, wide) {
    var slot = slots[slotName];
    var id = fieldId(slotName, 0);
    var face = host && host.faceHtml ? host.faceHtml() : '<span class="ava initials">Y</span>';
    var context = slot.quoteUrl
      ? '<p class="xc-context">' + esc(tr("Quoting")) + "</p>"
      : (slot.replyTo && slot.context ? '<p class="xc-context">' + esc(tr("Replying to @{handle}", { handle: slot.context })) + "</p>" : "");
    var placeholder = slotName === "post" ? tr("What is happening?!") : tr("Post your reply");
    var described = id === "compose-text" ? ' aria-describedby="compose-note"' : "";
    var note = id === "compose-text" ? '<p class="xc-note" id="compose-note">' + esc(tr("The draft stays on this device. You press Post on X.")) + "</p>" : "";
    var foot = wide ? extraHtml(slotName) : (note ? "" : '<p class="xc-note">' + esc(tr("You press Post on X.")) + "</p>");
    return '<div class="xc' + (wide ? " xc-wide" : "") + '" data-slot="' + esc(slotName) + '">' + face + '<div class="xc-main">' + context
      + '<div class="xc-field"><textarea class="xc-text" data-xc="text" data-slot="' + esc(slotName) + '" data-index="0" id="' + esc(id) + '"' + described + ' placeholder="' + esc(placeholder) + '" maxlength="2000">' + esc(slot.posts[0].text || "") + '</textarea><div class="xc-suggest" data-xc="suggest" hidden></div></div>'
      + aiExtra(slotName)
      + mediaHtml(slotName)
      + emojiHtml(slotName)
      + hiddenFiles(slotName)
      + tools(slotName)
      + note
      + threadHtml(slotName)
      + foot
      + "</div></div>";
  }

  function snapshot(slotName) {
    var slot = slots[slotName];
    return {
      id: "current:" + slotName,
      slot: slotName,
      at: Date.now(),
      posts: slot.posts.map(function (post) { return String(post.text || "").slice(0, 2000); }),
      replies: slot.posts.map(function (post) { return String(post.replyTo || "").slice(0, 80); }),
      link: String(slot.link || "").slice(0, 300),
      hashtags: (slot.hashtags || []).slice(0, 10),
      replyTo: String(slot.replyTo || "").slice(0, 22),
      quoteUrl: String(slot.quoteUrl || "").slice(0, 300),
      context: String(slot.context || "").slice(0, 15)
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
    slot.quoteUrl = String(item.quoteUrl || "");
    if (!slot.context) slot.context = String(item.context || "");
    slot.media.forEach(function (media) { if (media.url) URL.revokeObjectURL(media.url); });
    slot.media = [];
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
  function paintChrome(slotName) {
    document.querySelectorAll("[data-xc='count'][data-slot='" + slotName + "']").forEach(function (node) {
      node.innerHTML = meter(measure(slots[slotName], Number(node.getAttribute("data-index") || 0)));
    });
    document.querySelectorAll("a.xc-post").forEach(function (node) {
      if (node.getAttribute("data-slot") !== slotName) return;
      var index = Number(node.getAttribute("data-index") || 0);
      var info = measure(slots[slotName], index);
      if (info.ok) {
        node.href = intentFor(slots[slotName], index);
        node.removeAttribute("aria-disabled");
      } else {
        node.removeAttribute("href");
        node.setAttribute("aria-disabled", "true");
      }
    });
    var end = document.querySelector('[data-xc="end"][data-slot="' + slotName + '"]');
    if (end) {
      var count = end.querySelector("[data-xc='count'], .xc-count");
      if (!count) end.insertAdjacentHTML("afterbegin", '<span data-xc="count" data-slot="' + slotName + '" data-index="0"></span>');
    }
  }
  function paintSuggest(area) {
    var box = area.parentElement && area.parentElement.querySelector("[data-xc='suggest']");
    if (!box) return;
    var token = core.tokenAt(area.value, area.selectionStart);
    if (!token) { box.hidden = true; box.innerHTML = ""; return; }
    var rows = host && host.suggest ? host.suggest(token.kind) : [];
    var list = core.suggestTokens(token.kind, token.query, rows);
    if (!list.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = list.map(function (item) {
      var shown = (token.kind === "tag" ? "#" : "@") + item;
      return '<button type="button" data-act="xc-pick" data-slot="' + esc(area.getAttribute("data-slot")) + '" data-index="' + esc(area.getAttribute("data-index") || "0") + '" data-start="' + token.start + '" data-kind="' + token.kind + '" data-value="' + esc(item) + '">' + esc(shown) + "</button>";
    }).join("");
  }
  function copyText(value) {
    var text = String(value || "");
    if (!text) { toast(tr("Nothing copied")); return; }
    var done = function () { toast(tr("Copied")); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(function () { toast(tr("Nothing copied")); });
    else toast(tr("Nothing copied"));
  }
  function altLines(slot) {
    return slot.media.map(function (item) { return item.alt ? tr("Alt text") + ": " + item.alt : ""; }).filter(Boolean).join("\n");
  }
  function plain(slot, index) {
    var post = slot.posts[index] || { text: "" };
    var tags = index === 0 ? (slot.hashtags || []).map(function (tag) { return "#" + tag; }).join(" ") : "";
    return [post.text, tags, index === 0 && !slot.quoteUrl ? slot.link : "", index === 0 ? altLines(slot) : ""].filter(Boolean).join("\n");
  }
  function addFiles(slotName, list, kind) {
    var slot = slots[slotName];
    var incoming = Array.prototype.slice.call(list || []);
    if (!incoming.length) return;
    var next = slot.media.slice();
    incoming.forEach(function (file) {
      if (!file || file.size > MAX_BYTES) return;
      var typed = { type: kind === "gif" ? "image/gif" : kind === "video" ? (fileType(file).indexOf("video/") === 0 ? fileType(file) : "video/mp4") : (fileType(file).indexOf("image/") === 0 && fileType(file) !== "image/gif" ? fileType(file) : "image/png") };
      next.push({ file: file, type: typed.type, alt: "", url: URL.createObjectURL(file), kind: kind });
    });
    var check = core.classifyMedia(next.map(function (item) { return { type: item.type }; }));
    if (!check.ok) {
      next.slice(slot.media.length).forEach(function (item) { URL.revokeObjectURL(item.url); });
      toast(tr("Use up to 4 images, or 1 video, or 1 GIF. Don’t mix them."));
      return;
    }
    slot.media = next;
    paint();
  }

  function preparePost(text) {
    modalSlot = "post";
    if (text) slots.post.posts[0].text = String(text);
    if (host && host.setSeed) host.setSeed(slots.post.posts[0].text || "");
  }
  function openReply(post) {
    var id = String((post && (post.statusId || post.id)) || "");
    modalSlot = "reply";
    if (/^\d{5,22}$/.test(id)) slots.reply.replyTo = id;
    slots.reply.context = String((post && post.handle) || "").replace(/^@/, "");
    slots.reply.targetKey = String((post && post.id) || "");
    slots.reply.sourceText = String((post && post.text) || "").slice(0, 2000);
    slots.reply.quoteUrl = "";
    if (host && host.openModal) host.openModal();
  }
  function openQuote(post) {
    var id = String((post && (post.statusId || post.id)) || "");
    modalSlot = "quote";
    slots.quote = blank();
    slots.quote.quoteUrl = /^\d{5,22}$/.test(id) ? "https://x.com/i/status/" + id : "";
    slots.quote.targetKey = String((post && post.id) || "");
    if (host && host.openModal) host.openModal();
  }

  function onAct(act, el) {
    var slotName = el.getAttribute("data-slot") || modalSlot;
    var slot = slots[slotName] || slots.post;
    if (act === "xc-ai") {
      aiTones = false;
      aiMenu = aiMenu === slotName ? "" : slotName;
      paint();
      return true;
    }
    if (act === "xc-ai-tones") {
      aiMenu = slotName;
      aiTones = !aiTones;
      paint();
      return true;
    }
    if (act === "xc-ai-run") {
      runAi(slotName, Number(el.getAttribute("data-index") || 0), el.getAttribute("data-kind") || "grammar", el.getAttribute("data-tone") || "");
      return true;
    }
    if (act === "xc-ai-pick") {
      if (aiPreview && aiPreview.slot === slotName) aiPreview.pick = Number(el.getAttribute("data-i") || 0);
      paint();
      return true;
    }
    if (act === "xc-ai-dismiss") {
      aiPreview = null;
      aiBusy = null;
      aiJob += 1;
      paint();
      return true;
    }
    if (act === "xc-ai-apply") {
      if (aiPreview && aiPreview.slot === slotName) {
        var chosen = aiPreview.suggestions && aiPreview.suggestions.length
          ? (aiPreview.suggestions[aiPreview.pick] || aiPreview.suggestions[0])
          : aiPreview.text;
        var at = aiPreview.index || 0;
        if (slot.posts[at]) slot.posts[at].text = String(chosen || "");
        syncText(slotName, at);
        saveSoon(slotName);
        if (slotName === "post" && at === 0 && host && host.setSeed) host.setSeed(slot.posts[0].text || "");
      }
      aiPreview = null;
      paint();
      return true;
    }
    if (act === "xc-file") {
      var root = el.closest(".xc");
      var input = root && root.querySelector('input[data-kind="' + (el.getAttribute("data-kind") || "image") + '"]');
      if (input) input.click();
      return true;
    }
    if (act === "xc-emoji") {
      slot.emoji = !slot.emoji;
      paint();
      return true;
    }
    if (act === "xc-emoji-add") {
      var glyph = EMOJI[Number(el.getAttribute("data-i")) || 0] || "";
      var post = slot.posts[0];
      post.text = String(post.text || "") + glyph;
      slot.emoji = false;
      syncText(slotName, 0);
      paint();
      return true;
    }
    if (act === "xc-add-post") {
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
    if (act === "xc-remove-media") {
      var media = slot.media.splice(Number(el.getAttribute("data-index") || 0), 1)[0];
      if (media && media.url) URL.revokeObjectURL(media.url);
      paint();
      return true;
    }
    if (act === "xc-add-tag") {
      var field = el.closest(".xc") && el.closest(".xc").querySelector("[data-xc='tag']");
      var clean = String((field && field.value) || "").replace(/^#/, "").trim();
      if (/^[A-Za-z0-9_]{1,50}$/.test(clean) && slot.hashtags.indexOf(clean) < 0 && slot.hashtags.length < 10) slot.hashtags.push(clean);
      if (field) field.value = "";
      paint();
      return true;
    }
    if (act === "xc-remove-tag") {
      slot.hashtags = slot.hashtags.filter(function (tag) { return tag !== el.getAttribute("data-tag"); });
      paint();
      return true;
    }
    if (act === "xc-copy") {
      copyText(plain(slot, Number(el.getAttribute("data-index") || 0)));
      return true;
    }
    if (act === "xc-share") {
      var files = slot.media.map(function (item) { return item.file; }).filter(Boolean);
      var text = plain(slot, 0);
      if (files.length && navigator.share && navigator.canShare && navigator.canShare({ files: files })) {
        navigator.share({ files: files, text: text }).catch(function () { toast(tr("Share failed")); });
      } else {
        copyText(text);
        toast(tr("Share pictures when the X app can take files. Otherwise attach them after X opens."));
      }
      return true;
    }
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
    if (act === "xc-drafts") { showDrafts = !showDrafts; modalSlot = slotName; paint(); return true; }
    if (act === "xc-new-draft") {
      var doc = draftDoc();
      var snap = snapshot(slotName);
      snap.id = "d" + Date.now();
      doc.items = [snap].concat(doc.items.filter(function (item) { return item.id !== "current:" + slotName; })).slice(0, 21);
      writeStore(DRAFT_KEY, doc);
      var keepReply = slot.replyTo;
      var keepContext = slot.context;
      var keepKey = slot.targetKey;
      slots[slotName] = blank();
      slots[slotName].replyTo = keepReply;
      slots[slotName].context = keepContext;
      slots[slotName].targetKey = keepKey;
      slots[slotName].sourceText = String(slot.sourceText || "");
      toast(tr("Draft saved on this device"));
      paint();
      return true;
    }
    if (act === "xc-open-draft") {
      var found = draftDoc().items.find(function (item) { return item.id === el.getAttribute("data-id"); });
      if (found) applySnapshot(found.slot || slotName, found);
      showDrafts = false;
      paint();
      return true;
    }
    if (act === "xc-delete-draft") {
      var left = draftDoc();
      left.items = left.items.filter(function (item) { return item.id !== el.getAttribute("data-id"); });
      writeStore(DRAFT_KEY, left);
      paint();
      return true;
    }
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
      syncText(slotName, index);
      paintChrome(slotName);
      paintSuggest(el);
      saveSoon(slotName);
    } else if (kind === "link" && slot) {
      slot.link = el.value;
      paintChrome(slotName);
      saveSoon(slotName);
    } else if (kind === "alt" && slot) {
      var item = slot.media[Number(el.getAttribute("data-index") || 0)];
      if (item) item.alt = el.value.slice(0, 1000);
    } else if (kind === "replyto" && slot) {
      var target = slot.posts[Number(el.getAttribute("data-index") || 0)];
      if (target) target.replyTo = core.parseStatusId(el.value);
      paintChrome(slotName);
    } else if (kind === "handle") {
      partialDraft = String(el.value || "").replace(/^@/, "").slice(0, 15);
    }
  }
  function onChange(event) {
    var el = event.target;
    if (!el || el.getAttribute("data-xc") !== "file") return;
    addFiles(el.getAttribute("data-slot"), el.files, el.getAttribute("data-kind"));
    el.value = "";
  }
  function onClickCapture(event) {
    var link = event.target.closest && event.target.closest("a.xc-post");
    if (!link) return;
    if (link.getAttribute("aria-disabled") === "true" || !link.getAttribute("href")) {
      event.preventDefault();
      var info = measure(slots[link.getAttribute("data-slot")] || slots.post, Number(link.getAttribute("data-index") || 0));
      toast(info.left < 0 ? tr("Over the limit") : tr("Post to X"));
      return;
    }
    var slotName = link.getAttribute("data-slot") || "post";
    var index = Number(link.getAttribute("data-index") || 0);
    var slot = slots[slotName];
    var text = slot && slot.posts[index] ? slot.posts[index].text : "";
    if (index === 0 && slotName === "post" && host && host.saveLocal) host.saveLocal(text);
    toast(tr("Saved on this device. X opened in a new tab"));
    if (index === 0 && slotName === "post") {
      setTimeout(function () {
        if (slot && slot.posts[0]) slot.posts[0].text = "";
        if (host && host.setSeed) host.setSeed("");
        if (host && host.closeModal) host.closeModal();
      }, 0);
    }
  }
  function bindUi() {
    if (bound) return;
    bound = true;
    document.addEventListener("input", onInput);
    document.addEventListener("change", onChange);
    document.addEventListener("click", onClickCapture, true);
    document.addEventListener("click", function (event) {
      if (!aiMenu) return;
      var target = event.target;
      if (target && target.closest && target.closest(".xc-ai")) return;
      aiMenu = "";
      aiTones = false;
      paint();
    }, true);
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !aiMenu) return;
      aiMenu = "";
      aiTones = false;
      paint();
    });
    document.addEventListener("mousedown", function (event) {
      if (event.target.closest && event.target.closest(".xc-suggest")) event.preventDefault();
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

  function inlineHtml(place, post) {
    bindUi();
    var slotName = place === "reply" ? "reply" : "post";
    if (slotName === "reply" && post) {
      var id = String(post.statusId || post.id || "");
      if (/^\d{5,22}$/.test(id) && !slots.reply.replyTo) slots.reply.replyTo = id;
      if (!slots.reply.context) slots.reply.context = String(post.handle || "").replace(/^@/, "");
      if (!slots.reply.targetKey) slots.reply.targetKey = String(post.id || "");
      if (post.text) slots.reply.sourceText = String(post.text).slice(0, 2000);
    }
    return box(slotName, false);
  }
  function modalHtml() {
    bindUi();
    var slotName = slots[modalSlot] ? modalSlot : "post";
    return '<div class="modal-back" data-act="close-modal"><div class="modal xc-modal" role="dialog" aria-modal="true" aria-label="' + esc(tr("Post")) + '" data-act="stop">'
      + '<div class="modal-head"><button class="icon-btn" type="button" data-act="close-modal" aria-label="' + esc(tr("Close")) + '">×</button><div class="grow"></div>' + postLink(slotName, 0, tr("Post to X"), slotName === "post" ? "compose-post" : "") + "</div>"
      + '<div class="modal-body">' + box(slotName, true) + "</div></div></div>";
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
  }

  var saved = draftDoc().items.find(function (item) { return item && item.id === "current:post"; });
  if (saved) applySnapshot("post", saved);

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
    bind: function (next) { host = next || null; }
  };
})();
