/* Settings > Connected keys. Owner only, and only after the accounts wall is on.
   The saved value is never copied back into the page. */
(function () {
  var cache = null;
  var loading = false;
  var loadedAt = 0;
  var openSlot = "";
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
    try { return new Date(n).toLocaleString(); }
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
    if (code === "unauthorized" || code === "forbidden") return tr("The key was rejected.");
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
    return tr("{service} needs a new key. Open Connected keys and replace it.", { service: name });
  }
  function rememberAlert(row) {
    var id = "key:" + row.slot + ":" + row.status + ":" + String(row.updatedAt || 0);
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
    else if (!body || !body.status) note = tr("Could not reach the key store.");
    else note = tr("Could not save that key.");
  }
  function sectionHtml() {
    if (!visible()) return '<div class="set-block"><p class="phandle">' + esc(tr("Keys are available only to the owner.")) + "</p></div>";
    load(false);
    if (cache && cache.ready === false) {
      return '<div class="set-block keys-settings"><p class="phandle keys-status">' + esc(tr("Setup needed")) + "</p></div>";
    }
    var slots = cache && cache.slots ? cache.slots : [];
    var blocks = slots.map(function (slot) {
      var line = statusLabel(slot.status, slot.configured);
      var used = slot.lastUsed ? tr("Last used {time}", { time: when(slot.lastUsed) }) : tr("Never used");
      var err = errorLabel(slot.lastError);
      var status = line + " · " + used + (err ? " · " + err : "");
      var editing = openSlot === slot.id || !slot.configured;
      var field = "";
      if (editing) {
        var hint = slot.kind === "pair" ? tr("Paste the client id and the client secret from your own app, one on each line.") : tr("Paste a Cookie header or a Netscape cookies.txt file.");
        if (slot.kind === "token") hint = tr("Paste the token from your own account.");
        field = '<label class="field"><span>' + esc(hint) + '</span><textarea class="keys-paste" data-keys-paste="' + esc(slot.id) + '" autocomplete="off" spellcheck="false" maxlength="100000" aria-label="' + esc(tr(slot.label)) + '"></textarea></label>' +
          '<button class="primary" type="button" data-act="keys-save" data-slot="' + esc(slot.id) + '">' + esc(tr("Save key")) + "</button>";
      }
      var actions = "";
      if (slot.configured) {
        actions = '<div class="theme-row">' +
          '<button class="outline" type="button" data-act="keys-test" data-slot="' + esc(slot.id) + '">' + esc(tr("Test key")) + "</button>" +
          '<button class="outline" type="button" data-act="keys-replace" data-slot="' + esc(slot.id) + '">' + esc(tr("Replace key")) + "</button>" +
          '<button class="outline" type="button" data-act="keys-delete" data-slot="' + esc(slot.id) + '">' + esc(tr("Delete")) + "</button>" +
          "</div>";
      }
      var mask = slot.configured ? '<p class="phandle keys-mask" aria-label="' + esc(tr("Saved value hidden")) + '">' + esc(slot.mask || "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022") + "</p>" : "";
      return '<section class="keys-slot"><h2>' + esc(tr(slot.label)) + "</h2><p class=\"phandle\">" + esc(helpFor(slot.kind)) + "</p><p class=\"phandle keys-status\">" + esc(status) + "</p>" + mask + field + actions + "</section>";
    }).join("");
    if (!blocks && note) blocks = "";
    return '<div class="set-block keys-settings"><p class="phandle">' + esc(tr("Paste keys from your own accounts. They stay encrypted, and the saved value is never shown again.")) + "</p>" +
      (note ? '<p class="phandle">' + esc(note) + "</p>" : "") + blocks + "</div>";
  }
  function pasteValue(slot) {
    var field = document.querySelector('[data-keys-paste="' + slot + '"]');
    var value = field ? String(field.value || "") : "";
    if (field) field.value = "";
    return value;
  }
  function onAct(act, el) {
    if (!visible()) return false;
    var slot = el && el.dataset ? el.dataset.slot : "";
    if (!slot) return false;
    if (act === "keys-replace") {
      openSlot = slot;
      note = "";
      render();
      return true;
    }
    if (act === "keys-delete") {
      note = "";
      send("/v1/owner/keys/" + encodeURIComponent(slot), "DELETE").then(function (body) {
        if (!body || body.status !== 200) fail(body);
        else {
          note = tr("Deleted.");
          openSlot = "";
          if (body.slot && cache && cache.slots) {
            cache.slots = cache.slots.map(function (item) { return item.id === slot ? body.slot : item; });
          }
        }
        load(true);
      });
      return true;
    }
    if (act === "keys-test") {
      note = "";
      send("/v1/owner/keys/" + encodeURIComponent(slot) + "/test", "POST", {}).then(function (body) {
        if (!body || body.status !== 200) fail(body);
        else note = statusLabel(body.slot && body.slot.status, true);
        load(true);
      });
      return true;
    }
    if (act === "keys-save") {
      var value = pasteValue(slot);
      if (!value.trim()) {
        note = tr("That paste was not accepted.");
        render();
        return true;
      }
      note = "";
      send("/v1/owner/keys/" + encodeURIComponent(slot), "PUT", { value: value }).then(function (body) {
        value = "";
        if (!body || body.status !== 200) fail(body);
        else {
          note = tr("Saved.");
          openSlot = "";
        }
        load(true);
      });
      return true;
    }
    return false;
  }

  window.OwnerKeys = {
    visible: visible,
    sectionHtml: sectionHtml,
    onAct: onAct,
    load: load
  };
})();
