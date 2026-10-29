/* Settings > Connected keys. Owner only, and only after the accounts wall is on.
   The saved value is never copied back into the page. Extra keys are backups. */
(function () {
  var cache = null;
  var loading = false;
  var loadedAt = 0;
  var openSlot = "";
  var openKey = "";
  var note = "";
  var notified = {};

  function tr(key, vars) {
    return window.t ? window.t(key, vars) : key;
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function config() {
    return window.VIKTORYCH_ACCOUNTS || { api: "", gate: false };
  }
  function account() {
    var api = window.ViktorychAccounts;
    return api && api.account ? api.account() : null;
  }
  function token() {
    var api = window.ViktorychAccounts;
    return api && api.token ? api.token() : "";
  }
  function visible() {
    var row = account();
    return !!(config().gate === true && row && (row.owner === true || row.owner === 1));
  }
  function render() {
    if (window.ViktorychAccounts && window.ViktorychAccounts.requestRender) window.ViktorychAccounts.requestRender();
  }
  function when(value) {
    var n = Number(value) || 0;
    if (!n) return "";
    try { return new Date(n).toLocaleString((window.SI18n ? window.SI18n.locale() : undefined)); }
    catch (err) { return ""; }
  }
  function statusLabel(status, configured) {
    if (!configured || status === "empty") return tr("Key not connected");
    if (status === "working") return tr("Key working");
    if (status === "expired") return tr("Key expired");
    if (status === "needs_attention") return tr("Key needs attention");
    return tr("Key not tested");
  }
  function errorLabel(code) {
    if (code === "unauthorized") return tr("The key was rejected.");
    if (code === "logged_out" || code === "session_invalid" || code === "auth_required") return tr("The key is no longer signed in.");
    if (code === "rate_limit" || code === "forbidden") return tr("This service is slowing down. The same key stays in use.");
    if (code === "captcha" || code === "challenge") return tr("The site asked for a check.");
    if (code === "expired") return tr("This key is expired.");
    if (code === "unreachable" || code === "unreadable") return tr("The check did not connect.");
    if (code === "bad_paste") return tr("That paste was not accepted.");
    return "";
  }
  function helpFor(kind) {
    if (kind === "pair") return tr("Paste the client id and the client secret from your own app, one on each line.");
    if (kind === "token") return tr("Paste the token from your own account.");
    return tr("In your own browser, while you are signed in, export cookies as a Netscape cookies.txt file or copy the Cookie header from one request you made to that site.");
  }
  function alertText(row) {
    var name = row.label ? tr(row.label) : tr("Connected keys");
    if (row.status === "slow") return tr("{service} is slowing down. The same key stays in use.", { service: name });
    return tr("{service} needs a new key. Open Connected keys and replace it.", { service: name });
  }
  function rememberAlert(row) {
    var id = "key:" + row.slot + ":" + row.status + ":" + String(row.keyId || "") + ":" + String(row.updatedAt || 0);
    if (notified[id]) return;
    var seen = "";
    try { seen = sessionStorage.getItem("viktorych-key-notes") || ""; }
    catch (err) { seen = ""; }
    if (seen.indexOf(id) >= 0) {
      notified[id] = true;
      return;
    }
    notified[id] = true;
    try { sessionStorage.setItem("viktorych-key-notes", (seen + "\n" + id).slice(-4000)); }
    catch (err) { /* the settings line still shows the status */ }
    try {
      window.dispatchEvent(new CustomEvent("viktorych-key-alert", {
        detail: { id: id, text: alertText(row) }
      }));
    } catch (err) { /* the in-app list is optional */ }
  }
  function applyBody(body) {
    cache = body && Array.isArray(body.slots) ? body : { slots: [], alerts: [] };
    (cache.alerts || []).forEach(rememberAlert);
  }
  function endpoint() {
    return String(config().api || "").replace(/\/$/, "");
  }
  function send(path, method, body) {
    var root = endpoint();
    var session = token();
    if (!root || !session) return Promise.resolve({ status: 0, error: "unauthorized" });
    return fetch(root + path, {
      method: method,
      headers: {
        authorization: "Bearer " + session,
        "content-type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined,
      credentials: "omit"
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (payload) {
        payload = payload || {};
        payload.status = res.status;
        return payload;
      });
    }).catch(function () {
      return { status: 0, error: "unreachable" };
    });
  }
  function load(force) {
    if (!visible()) return;
    if (loading) return;
    if (!force && cache && Date.now() - loadedAt < 15000) return;
    loading = true;
    loadedAt = Date.now();
    send("/v1/owner/keys", "GET").then(function (body) {
      loading = false;
      if (!body || body.status !== 200) {
        note = tr("Could not reach the key store.");
        render();
        return;
      }
      applyBody(body);
      render();
    });
  }
  function fail(body) {
    if (body && body.error === "not_configured") note = tr("Setup needed");
    else if (body && body.error === "bad_paste") note = tr("That paste was not accepted.");
    else if (body && body.error === "too_many") note = tr("This service already has enough backup keys.");
    else if (!body || !body.status) note = tr("Could not reach the key store.");
    else note = tr("Could not save that key.");
  }
  function keyLine(key) {
    var line = statusLabel(key.status, true);
    var used = key.lastUsed ? tr("Last used {time}", { time: when(key.lastUsed) }) : tr("Never used");
    var err = errorLabel(key.lastError);
    return line + " · " + used + (err ? " · " + err : "");
  }
  function pasteField(slot, keyId, label) {
    var hint = slot.kind === "pair" ? tr("Paste the client id and the client secret from your own app, one on each line.") : tr("Paste a Cookie header or a Netscape cookies.txt file.");
    if (slot.kind === "token") hint = tr("Paste the token from your own account.");
    return '<label class="field"><span>' + esc(tr("Optional label")) + '</span><input class="keys-label" data-keys-label="' + esc(slot.id) + '" maxlength="40" autocomplete="off" spellcheck="false" value="' + esc(label || "") + '" aria-label="' + esc(tr("Key label")) + '"></label>' +
      '<label class="field"><span>' + esc(hint) + '</span><textarea class="keys-paste" data-keys-paste="' + esc(slot.id) + '" autocomplete="off" spellcheck="false" maxlength="100000" aria-label="' + esc(tr(slot.label)) + '"></textarea></label>' +
      '<button class="primary" type="button" data-act="keys-save" data-slot="' + esc(slot.id) + '" data-key="' + esc(keyId) + '">' + esc(tr("Save key")) + "</button>";
  }
  function sectionHtml() {
    if (!visible()) return '<div class="set-block"><p class="phandle">' + esc(tr("Keys are available only to the owner.")) + "</p></div>";
    load(false);
    if (cache && cache.ready === false) {
      return '<div class="set-block keys-settings"><p class="phandle keys-status">' + esc(tr("Setup needed")) + "</p></div>";
    }
    var slots = cache && cache.slots ? cache.slots : [];
    var blocks = slots.map(function (slot) {
      var keys = Array.isArray(slot.keys) ? slot.keys : [];
      var items = keys.map(function (key, index) {
        var title = key.name ? '<p class="phandle">' + esc(key.name) + "</p>" : "";
        var move = "";
        if (keys.length > 1 && index > 0) {
          move += '<button class="outline" type="button" data-act="keys-up" data-slot="' + esc(slot.id) + '" data-key="' + esc(key.id) + '">' + esc(tr("Move up")) + "</button>";
        }
        if (keys.length > 1 && index < keys.length - 1) {
          move += '<button class="outline" type="button" data-act="keys-down" data-slot="' + esc(slot.id) + '" data-key="' + esc(key.id) + '">' + esc(tr("Move down")) + "</button>";
        }
        return '<article class="keys-item">' + title +
          '<p class="phandle keys-status">' + esc(keyLine(key)) + "</p>" +
          '<p class="phandle keys-mask" aria-label="' + esc(tr("Saved value hidden")) + '">' + esc(key.mask || "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022") + "</p>" +
          '<div class="theme-row">' +
          '<button class="outline" type="button" data-act="keys-test" data-slot="' + esc(slot.id) + '" data-key="' + esc(key.id) + '">' + esc(tr("Test key")) + "</button>" +
          '<button class="outline" type="button" data-act="keys-replace" data-slot="' + esc(slot.id) + '" data-key="' + esc(key.id) + '">' + esc(tr("Replace key")) + "</button>" +
          '<button class="outline" type="button" data-act="keys-delete" data-slot="' + esc(slot.id) + '" data-key="' + esc(key.id) + '">' + esc(tr("Delete")) + "</button>" +
          move +
          "</div></article>";
      }).join("");
      var adding = !keys.length || (openSlot === slot.id && openKey === "new");
      var replacing = openSlot === slot.id && openKey && openKey !== "new";
      var replaceName = "";
      if (replacing) {
        keys.forEach(function (key) { if (key.id === openKey) replaceName = key.name || ""; });
      }
      var field = "";
      if (adding) field = pasteField(slot, "new", "");
      else if (replacing) field = pasteField(slot, openKey, replaceName);
      var add = "";
      if (keys.length && keys.length < 8 && !(openSlot === slot.id && openKey === "new")) {
        add = '<button class="outline" type="button" data-act="keys-add" data-slot="' + esc(slot.id) + '">' + esc(tr("Add another key")) + "</button>";
      }
      var slow = slot.pace && slot.pace.reason
        ? '<p class="phandle keys-status">' + esc(tr("Slowing down")) + " · " + esc(tr("This service is slowing down. The same key stays in use.")) + "</p>"
        : "";
      return '<section class="keys-slot"><h2>' + esc(tr(slot.label)) + "</h2><p class=\"phandle\">" + esc(helpFor(slot.kind)) + "</p>" + slow + items + field + add + "</section>";
    }).join("");
    return '<div class="set-block keys-settings"><p class="phandle">' + esc(tr("Paste keys from your own accounts. They stay encrypted, and the saved value is never shown again.")) + "</p>" +
      '<p class="phandle">' + esc(tr("Keys are backups. One key is used at a time, highest priority first.")) + "</p>" +
      (note ? '<p class="phandle">' + esc(note) + "</p>" : "") + healthHtml() + blocks + "</div>";
  }
  /* Site health from the Worker watchdog (worker/src/watchdog.js). Owner only.
     Problem lines come from the server in plain English. */
  var health = null;
  var healthLoading = false;
  var healthAt = 0;
  /* The Worker's own request quota is one origin of the server pool; while
     the pool has room, an exhausted Worker is only skipped (Usage shows a
     quiet note), so its alert stays out of the banner and the list. */
  function poolHasRoom() {
    var acc = window.ViktorychAccounts;
    var sp = null;
    try { sp = acc && acc.serverPool ? acc.serverPool() : null; } catch (err) { sp = null; }
    if (sp && sp.cap > 0) return sp.pct < 100 && sp.origins.some(function (o) { return !o.out; });
    var cfg = window.ViktorychAccountsConfig || window.VIKTORYCH_ACCOUNTS || {};
    return !!cfg.backupApi;
  }
  function problemsOf(doc) {
    var list = doc && Array.isArray(doc.problems) ? doc.problems : [];
    var room = poolHasRoom();
    return list.filter(function (p) { return !(p && p.code === "usage_worker_requests" && room); });
  }
  var USAGE_TEXT = {
    usage_worker_requests: "Worker requests today are at {pct}% of the free limit.",
    usage_d1_reads: "Database rows read today are at {pct}% of the free limit.",
    usage_d1_writes: "Database rows written today are at {pct}% of the free limit.",
    usage_durable: "Durable Object requests today are at {pct}% of the free limit.",
    usage_r2_class_a: "Storage writes this month are at {pct}% of the free limit.",
    usage_r2_class_b: "Storage reads this month are at {pct}% of the free limit.",
    usage_r2_storage: "File storage is at {pct}% of the free limit.",
    usage_d1_storage: "Database size is at {pct}% of the free limit."
  };
  function problemText(p) {
    if (p && USAGE_TEXT[p.code] && Number.isFinite(Number(p.ratio))) return tr(USAGE_TEXT[p.code], { pct: Math.round(Number(p.ratio) * 100) });
    return p ? p.text || p.code : "";
  }
  function serious(doc) {
    var list = problemsOf(doc);
    var now = Date.now();
    return list.filter(function (p) {
      return p.level === "down" || now - (Number(p.since) || now) > 2 * 3600 * 1000;
    });
  }
  function loadHealth(force) {
    if (!visible() || healthLoading) return;
    if (!force && health && Date.now() - healthAt < 15 * 60 * 1000) return;
    healthLoading = true;
    healthAt = Date.now();
    send("/v1/owner/health", force === "run" ? "POST" : "GET").then(function (body) {
      healthLoading = false;
      if (!body || body.status !== 200) return;
      health = body;
      showBanner();
      render();
    });
  }
  function showBanner() {
    var list = serious(health);
    var old = document.getElementById("owner-health-banner");
    var key = "viktorych-health-dismissed";
    // One dismissal per day per problem and threshold (warn or down).
    var sig = new Date().toISOString().slice(0, 10) + "|" + list.map(function (p) { return p.code + ":" + p.level; }).sort().join(",");
    var dismissed = "";
    try { dismissed = localStorage.getItem(key) || ""; } catch (err) { dismissed = ""; }
    if (!list.length || !visible() || dismissed === sig) {
      if (old) old.remove();
      return;
    }
    var bar = old || document.createElement("div");
    /* Placed by styles.css at the bottom, like X's toasts, so it never
       covers a page's own header or the alert banner under it. */
    bar.id = "owner-health-banner";
    bar.setAttribute("role", "status");
    bar.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);z-index:9999;max-width:92vw;display:flex;gap:8px;align-items:center;padding:6px 12px;border-radius:999px;background:#f4212e;color:#fff;font:600 13px/1.3 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.3)";
    bar.innerHTML = '<a href="#/settings/keys" style="color:#fff;text-decoration:none">' + esc(tr("Site health: {count} problems need you", { count: list.length })) + "</a>" +
      '<button type="button" aria-label="' + esc(tr("Dismiss")) + '" style="background:none;border:0;color:#fff;font:inherit;cursor:pointer;padding:0 2px">✕</button>';
    bar.querySelector("button").onclick = function () {
      try { localStorage.setItem(key, sig); } catch (err) { /* hides until reload */ }
      bar.remove();
    };
    if (!old) document.body.appendChild(bar);
  }
  function healthHtml() {
    loadHealth(false);
    var list = problemsOf(health);
    var when2 = health && health.at ? when(health.at) : "";
    var head = !health ? tr("Site health not checked yet") : (list.length ? tr("Site health: {count} problems need you", { count: list.length }) : tr("Site health: all good"));
    var items = list.map(function (p) {
      return '<p class="phandle keys-status">' + esc(p.level === "down" ? "⛔ " : "⚠️ ") + esc(problemText(p)) + "</p>";
    }).join("");
    return '<section class="keys-slot"><h2>' + esc(tr("Site health")) + '</h2><p class="phandle">' + esc(head) + (when2 ? " · " + esc(when2) : "") + "</p>" + items +
      '<button class="outline" type="button" data-act="keys-health-check" data-slot="health">' + esc(tr("Check now")) + "</button></section>";
  }
  function pasteValue(slot) {
    var field = document.querySelector('[data-keys-paste="' + slot + '"]');
    var value = field ? String(field.value || "") : "";
    if (field) field.value = "";
    return value;
  }
  function labelValue(slot) {
    var field = document.querySelector('[data-keys-label="' + slot + '"]');
    var value = field ? String(field.value || "") : "";
    if (field) field.value = "";
    return value;
  }
  function slotKeys(slot) {
    var found = cache && cache.slots ? cache.slots.filter(function (item) { return item.id === slot; })[0] : null;
    return found && Array.isArray(found.keys) ? found.keys : [];
  }
  function onAct(act, el) {
    if (!visible()) return false;
    var slot = el && el.dataset ? el.dataset.slot : "";
    var key = el && el.dataset ? (el.dataset.key || "") : "";
    if (!slot) return false;
    if (act === "keys-health-check") {
      loadHealth("run");
      return true;
    }
    if (act === "keys-add") {
      openSlot = slot;
      openKey = "new";
      note = "";
      render();
      return true;
    }
    if (act === "keys-replace") {
      openSlot = slot;
      openKey = key;
      note = "";
      render();
      return true;
    }
    if (act === "keys-up" || act === "keys-down") {
      var keys = slotKeys(slot);
      var ids = keys.map(function (item) { return item.id; });
      var index = ids.indexOf(key);
      var next = index + (act === "keys-up" ? -1 : 1);
      if (index < 0 || next < 0 || next >= ids.length) return true;
      var swap = ids[index];
      ids[index] = ids[next];
      ids[next] = swap;
      note = "";
      send("/v1/owner/keys/" + encodeURIComponent(slot) + "/order", "POST", { ids: ids }).then(function (body) {
        if (!body || body.status !== 200) fail(body);
        load(true);
      });
      return true;
    }
    if (act === "keys-delete") {
      note = "";
      var path = "/v1/owner/keys/" + encodeURIComponent(slot) + (key ? "/" + encodeURIComponent(key) : "");
      send(path, "DELETE").then(function (body) {
        if (!body || body.status !== 200) fail(body);
        else {
          note = tr("Deleted.");
          openSlot = "";
          openKey = "";
        }
        load(true);
      });
      return true;
    }
    if (act === "keys-test") {
      note = "";
      var testPath = "/v1/owner/keys/" + encodeURIComponent(slot) + (key ? "/" + encodeURIComponent(key) : "") + "/test";
      send(testPath, "POST", {}).then(function (body) {
        if (!body || body.status !== 200) fail(body);
        else {
          var shown = body.slot && Array.isArray(body.slot.keys) ? body.slot.keys.filter(function (item) { return item.id === key; })[0] : null;
          note = statusLabel(shown ? shown.status : body.slot && body.slot.status, true);
        }
        load(true);
      });
      return true;
    }
    if (act === "keys-save") {
      var value = pasteValue(slot);
      var label = labelValue(slot);
      if (!value.trim()) {
        note = tr("That paste was not accepted.");
        render();
        return true;
      }
      note = "";
      var savePath = "/v1/owner/keys/" + encodeURIComponent(slot);
      if (key && key !== "new") savePath += "/" + encodeURIComponent(key);
      var payload = { value: value };
      if (label) payload.label = label;
      send(savePath, "PUT", payload).then(function (body) {
        value = "";
        label = "";
        if (!body || body.status !== 200) fail(body);
        else {
          note = tr("Saved.");
          openSlot = "";
          openKey = "";
        }
        load(true);
      });
      return true;
    }
    return false;
  }

  // Owner-only: check the watchdog a while after start and every half hour.
  setTimeout(function () { loadHealth(false); }, 12000);
  setInterval(function () { loadHealth(false); }, 30 * 60 * 1000);

  window.OwnerKeys = {
    visible: visible,
    sectionHtml: sectionHtml,
    onAct: onAct,
    load: load
  };
})();
