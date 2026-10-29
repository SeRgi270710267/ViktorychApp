/* Inbox › Mail, Inbox › Add and Inbox › Aliases (members).
   Mail: a member links one folder of their own IMAP mailbox (Yandex, Gmail,
   Outlook, Mail.ru) with an app password. The password is kept only in the
   device vault (ViktorychInbox.vault, AES-GCM) and is sent to the Worker
   relay with each check, which reads that one folder read-only and keeps
   nothing. Headers come first and only new UIDs; a body is fetched when the
   message is opened. Mail is cached encrypted in the same vault and the list
   works offline. Read-only: nothing is moved, deleted or sent.
   Aliases: a native SimpleLogin sign-up, activation, sign-in (with 2FA) and
   alias list. Those calls go straight from this device to SimpleLogin's
   documented API; the password is never stored or sent to our servers and
   the API key stays in the vault.
   Nothing here is written to the console. */
(function (root) {
  "use strict";

  var SL = "https://app.simplelogin.io";
  var SLOW_MS = 120000;
  var KEEP_HEADERS = 300;
  var KEEP_BODIES = 60;

  function tr(key, vars) { return root.t ? root.t(key, vars) : key; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function inbox() { return root.ViktorychInbox || null; }
  function vault() { return inbox() && inbox().vault; }
  function accounts() { return root.ViktorychAccounts || null; }
  function token() { try { return accounts() && accounts().token ? String(accounts().token() || "") : ""; } catch (err) { return ""; } }
  function hash() { return root.location ? String(root.location.hash || "") : ""; }
  function section() { return inbox() ? inbox().sectionOf(hash()) : ""; }

  /* Providers. Every step that has to happen on the provider's own site
     (turning IMAP on, making an app password, making a folder and a filter)
     gets a native guide here with a direct link to that one settings page. */
  var PROVIDERS = {
    yandex: {
      name: "Yandex Mail",
      imap: "https://mail.yandex.com/#setup/client",
      appPassword: "https://id.yandex.com/security/app-passwords",
      filters: "https://mail.yandex.com/#setup/filters",
      steps: function () { return [tr("Open Yandex Mail settings › Mail clients and turn on IMAP (portal password or app password)."), tr("Open Yandex ID › Security › App passwords, choose Mail, name it ViktorychApp and copy the password."), tr("Create a folder named ViktorychApp."), tr("Settings › Message filtering › Create filter, then paste the rule below.")]; },
      rule: function () { return tr("If: From contains \"simplelogin\"\nOr: To contains \"@{alias-domain}\"\nThen: Move to folder \"ViktorychApp\"\nApply to existing messages: on"); }
    },
    gmail: {
      name: "Gmail",
      imap: "https://mail.google.com/mail/u/0/#settings/fwdandpop",
      appPassword: "https://myaccount.google.com/apppasswords",
      filters: "https://mail.google.com/mail/u/0/#settings/filters",
      steps: function () { return [tr("Turn on 2-Step Verification for your Google account (app passwords need it)."), tr("Open Google Account › App passwords, name it ViktorychApp and copy the 16-letter password."), tr("Create a label named ViktorychApp. In IMAP a label is a folder."), tr("Settings › Filters › Create a new filter, paste the search below, then choose Skip the Inbox and Apply the label ViktorychApp.")]; },
      rule: function () { return "from:(simplelogin.co OR simplelogin.io) OR to:(@{alias-domain})"; }
    },
    outlook: {
      name: "Outlook",
      imap: "https://outlook.live.com/mail/0/options/mail/accounts/popImap",
      appPassword: "https://account.live.com/proofs/AppPassword",
      filters: "https://outlook.live.com/mail/0/options/mail/rules",
      steps: function () { return [tr("Turn on two-step verification for your Microsoft account."), tr("Open Security › App passwords and create one. Some Outlook.com accounts no longer allow IMAP with an app password; if the test fails, use Yandex or Gmail."), tr("Create a folder named ViktorychApp."), tr("Settings › Mail › Rules › Add new rule, then use the rule below.")]; },
      rule: function () { return tr("Condition: From includes \"simplelogin\"\nAction: Move to \"ViktorychApp\"\nStop processing more rules: on"); }
    },
    mailru: {
      name: "Mail.ru",
      imap: "https://e.mail.ru/settings/programs",
      appPassword: "https://account.mail.ru/user/2-step-auth/passwords",
      filters: "https://e.mail.ru/settings/filters",
      steps: function () { return [tr("Open Settings › Mail programs and allow IMAP access."), tr("Open Security › Passwords for external apps, create one for ViktorychApp and copy it."), tr("Create a folder named ViktorychApp."), tr("Settings › Filters › Add filter, then use the rule below.")]; },
      rule: function () { return tr("If: From contains \"simplelogin\"\nThen: Move to folder \"ViktorychApp\""); }
    }
  };

  var state = {
    acct: null,          // { provider, user, pass, folder, allowInbox, filters }
    cache: null,         // { uidvalidity, last, messages: [], bodies: {} }
    loaded: false, loading: false, error: "", fetchedAt: 0, timer: 0, started: false,
    wiz: { step: "consent", provider: "", form: {}, test: null, busy: false, error: "" },
    copied: "", opening: 0,
    sl: { key: "", step: "", email: "", pass: "", mfaKey: "", busy: false, error: "", aliases: null, options: null, info: null }
  };

  /* ---------- codes ---------- */
  var CODE_HINT = /(code|kod|код|otp|verif|подтвер|one[- ]time|login|sign[- ]?in|вход|пароль|password|pin\b|token|2fa)/i;
  function codeIn(text) {
    var t = String(text || "");
    if (!t) return "";
    var near = t.match(/(?:code|код|kod|otp|pin|token|пароль|password)(?:\s+(?:is|ist|es|est|—|-))?[^0-9A-Za-zА-я]{0,12}([0-9]{3}[- ][0-9]{3}|[0-9]{4,8}|[A-Z0-9]{6,8})(?![0-9A-Za-z])/i);
    if (near && /\d/.test(near[1])) return near[1].replace(/[- ]/g, "");
    if (!CODE_HINT.test(t)) return "";
    var bare = t.match(/(?:^|[^0-9#])([0-9]{3}[- ][0-9]{3}|[0-9]{6}|[0-9]{4,5}|[0-9]{7,8})(?![0-9])/);
    return bare ? bare[1].replace(/[- ]/g, "") : "";
  }
  function spaced(c) {
    c = String(c || "");
    if (/^\d{6}$/.test(c)) return c.slice(0, 3) + " " + c.slice(3);
    if (/^\d{8}$/.test(c)) return c.slice(0, 4) + " " + c.slice(4);
    return c;
  }
  var COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h11a2 2 0 0 1 2 2v11h-2V5H8V3zm-3 4h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm0 2v11h11V9H5z"/></svg>';
  var CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 16.6 4.9 12l-1.4 1.4 6 6 11-11-1.4-1.4z"/></svg>';
  function codeChip(code, big) {
    var copied = state.copied === code;
    return '<button type="button" class="sms-code' + (big ? " big" : " chip") + (copied ? " copied" : "") + '" data-mail-copy="' + esc(code) + '" aria-label="' + esc(tr("Copy code")) + '"><span class="sms-digits">' + esc(spaced(code)) + '</span><span class="sms-copy-ic">' + (copied ? CHECK_ICON : COPY_ICON) + "<em>" + esc(copied ? tr("Copied") : tr("Copy")) + "</em></span></button>";
  }
  function copy(text) {
    var done = function () {
      state.copied = text;
      try { if (root.navigator && root.navigator.vibrate) root.navigator.vibrate(10); } catch (err) { /* no haptics */ }
      repaint();
      setTimeout(function () { if (state.copied === text) { state.copied = ""; repaint(); } }, 1600);
    };
    try {
      if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) { root.navigator.clipboard.writeText(text).then(done, done); return; }
    } catch (err) { /* below */ }
    done();
  }

  /* ---------- vault ---------- */
  function loadAll() {
    if (state.loaded || !vault()) return Promise.resolve();
    return Promise.all([vault().get("mail.account"), vault().get("mail.cache"), vault().get("sl.key")]).then(function (got) {
      state.acct = got[0];
      state.cache = got[1] || { uidvalidity: 0, last: 0, messages: [], bodies: {} };
      state.sl.key = got[2] && got[2].key ? got[2].key : "";
      state.loaded = true;
      if (!state.acct) inbox().setLinked("mail", false);
    });
  }
  function saveCache() { if (vault() && state.cache) vault().put("mail.cache", state.cache).catch(function () { return null; }); }

  /* ---------- relay ---------- */
  function relay(extra) {
    var a = state.acct;
    var body = { provider: a.provider, user: a.user, pass: a.pass, folder: a.folder, allowInbox: !!a.allowInbox, filters: a.filters || {} };
    Object.keys(extra || {}).forEach(function (k) { body[k] = extra[k]; });
    if (!accounts() || !token()) return Promise.resolve({ status: 401, error: "sign_in" });
    return accounts().call("/v1/inbox/mail", { token: token(), method: "POST", body: body }).then(function (r) { return r || { status: 0 }; }, function () { return { status: 0, error: "offline" }; });
  }
  function errorOf(r) {
    if (!r || !r.status) return "offline";
    if (r.status === 200) return "";
    return String(r.error || (r.status === 429 ? "busy" : "connect"));
  }
  function sync() {
    if (state.loading || !state.acct) return Promise.resolve();
    state.loading = true;
    repaint();
    var c = state.cache;
    return relay({ op: "list", since: c.last || 0, uidvalidity: c.uidvalidity || 0 }).then(function (r) {
      state.loading = false;
      state.error = errorOf(r);
      if (!state.error) {
        if (r.uidvalidity !== c.uidvalidity) { c.messages = []; c.bodies = {}; }
        var known = {};
        c.messages.forEach(function (m) { known[m.uid] = 1; });
        (r.messages || []).forEach(function (m) {
          if (known[m.uid]) return;
          m.code = codeIn(m.subject);
          c.messages.push(m);
        });
        c.messages.sort(function (a, b) { return b.uid - a.uid; });
        c.messages = c.messages.slice(0, KEEP_HEADERS);
        c.uidvalidity = r.uidvalidity;
        c.last = Math.max(c.last || 0, r.last || 0);
        state.fetchedAt = Date.now();
        saveCache();
      }
      repaint();
    });
  }
  function openBody(uid) {
    var c = state.cache;
    if (!c || c.bodies[uid] != null || state.opening === uid) return;
    state.opening = uid;
    relay({ op: "body", uid: uid }).then(function (r) {
      state.opening = 0;
      var err = errorOf(r);
      if (!err) {
        c.bodies[uid] = String(r.text || "");
        var keys = Object.keys(c.bodies).map(Number).sort(function (a, b) { return b - a; });
        keys.slice(KEEP_BODIES).forEach(function (k) { delete c.bodies[k]; });
        var m = c.messages.find(function (x) { return x.uid === uid; });
        if (m) { m.read = true; if (!m.code) m.code = codeIn(c.bodies[uid]); }
        saveCache();
      } else state.error = err;
      repaint();
    });
  }
  function schedule() {
    clearTimeout(state.timer);
    state.timer = 0;
    if (section() !== "mail" || (root.document && root.document.hidden) || !state.acct) return;
    state.timer = setTimeout(function () { if (section() === "mail") sync().then(schedule); }, SLOW_MS);
  }
  function start() {
    if (state.started) return;
    state.started = true;
    loadAll().then(function () {
      repaint();
      if (state.acct && Date.now() - state.fetchedAt > 15000) return sync();
    }).then(schedule);
  }
  function stop() { clearTimeout(state.timer); state.timer = 0; state.started = false; }

  /* ---------- formatting ---------- */
  function ago(ms) {
    if (!ms) return "";
    var d = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (d < 60) return tr("now");
    if (d < 3600) return tr("{n}m", { n: Math.floor(d / 60) });
    if (d < 86400) return tr("{n}h", { n: Math.floor(d / 3600) });
    if (d < 604800) return tr("{n}d", { n: Math.floor(d / 86400) });
    return new Date(ms).toLocaleDateString();
  }
  function avatar(name) {
    var letter = String(name || "?").trim().charAt(0).toUpperCase() || "?";
    return '<span class="sms-av mail-av" aria-hidden="true">' + esc(letter) + "</span>";
  }
  function head(title, back) {
    var chips = inbox() && inbox().tabsHtml ? inbox().tabsHtml() : "";
    return '<header class="dmsgs-head">' + (back ? '<a class="mail-back" href="' + esc(back) + '" aria-label="' + esc(tr("Back")) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.4 13l5.6 5.6-1.4 1.4-8-8 8-8 1.4 1.4L7.4 11H20v2z"/></svg></a>' : "") + "<h1>" + esc(title) + "</h1></header>" + (back ? "" : chips);
  }
  function notice(title, text, action) {
    return '<div class="sms-empty"><h2>' + esc(title) + "</h2><p>" + esc(text) + "</p>" + (action || "") + "</div>";
  }
  function btn(label, attr, kind) {
    return '<button type="button" class="mail-btn' + (kind ? " " + kind : "") + '" ' + attr + ">" + esc(label) + "</button>";
  }
  function errorText(code) {
    return ({
      auth: tr("The mailbox refused the email or app password."),
      folder: tr("That folder doesn't exist. Check the name, including capital letters."),
      folder_not_allowed: tr("Pick a dedicated folder. INBOX needs the extra switch below."),
      busy: tr("Too many checks. Trying again shortly."),
      offline: tr("Check your connection and try again."),
      off: tr("Mail isn't available yet."),
      sign_in: tr("Sign in to use Mail."),
      timeout: tr("The mailbox took too long to answer."),
      bad_input: tr("Check the fields and try again.")
    })[code] || tr("Couldn't reach the mailbox.");
  }

  /* ---------- Add to Inbox ---------- */
  function connectPage() {
    var on = inbox().relayOn();
    var row = function (href, title, text, done) {
      return '<a class="mail-pick" href="' + esc(href) + '"><b>' + esc(title) + "</b><span>" + esc(text) + "</span>" + (done ? '<em class="mail-on">' + esc(tr("Connected")) + "</em>" : "") + "</a>";
    };
    return '<div class="inbox-mail" data-inbox-mail>' + head(tr("Inbox")) + '<section class="mail-body"><h2 class="mail-h2">' + esc(tr("Add to Inbox")) + "</h2>" +
      (on ? row("#/messages/mail", tr("Mail"), tr("One folder of your own mailbox, read-only, with codes highlighted."), inbox().linked("mail")) +
        row("#/messages/sms/setup", tr("SMSPool"), tr("Codes from your own SMSPool numbers."), inbox().linked("sms")) : notice(tr("Coming soon"), tr("Mail and SMSPool will appear here when they are turned on."))) +
      row("#/messages/aliases", tr("Email aliases"), tr("Private SimpleLogin aliases that forward to your mailbox."), !!state.sl.key) +
      "</section></div>";
  }

  /* ---------- Mail wizard ---------- */
  function wizardHtml() {
    var w = state.wiz;
    var p = PROVIDERS[w.provider];
    var err = w.error ? '<p class="mail-err" role="alert">' + esc(errorText(w.error)) + "</p>" : "";
    if (w.step === "consent") {
      return '<h2 class="mail-h2">' + esc(tr("What the app can see")) + '</h2><ul class="mail-list">' +
        [tr("Only the one folder you choose (we suggest a new folder named ViktorychApp)."),
          tr("The sender, subject and date of messages in that folder."),
          tr("A message's text only when you open it."),
          tr("Nothing in any other folder. The app never lists your folders."),
          tr("Read-only: it never moves, deletes or sends mail."),
          tr("Your app password is kept encrypted on this device. It passes through our relay only for each check, and the relay keeps nothing."),
          tr("Mail is stored encrypted on this device only. Disconnect wipes it.")].map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") +
        "</ul>" + '<div class="mail-row">' + btn(tr("Continue"), "data-mail-step=\"provider\"", "primary") + '<a class="mail-btn" href="#/messages/connect">' + esc(tr("Not now")) + "</a></div>";
    }
    if (w.step === "provider") {
      return '<h2 class="mail-h2">' + esc(tr("Choose your mail service")) + "</h2>" + Object.keys(PROVIDERS).map(function (id) {
        return '<button type="button" class="mail-pick" data-mail-provider="' + id + '"><b>' + esc(PROVIDERS[id].name) + "</b></button>";
      }).join("");
    }
    if (w.step === "guide" && p) {
      var rule = p.rule().replace("{alias-domain}", tr("your-alias-domain"));
      return '<h2 class="mail-h2">' + esc(tr("Set up {name}", { name: p.name })) + '</h2><ol class="mail-steps">' + p.steps().map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>" +
        '<div class="mail-links"><a href="' + esc(p.imap) + '" target="_blank" rel="noopener">' + esc(tr("Open IMAP settings")) + '</a><a href="' + esc(p.appPassword) + '" target="_blank" rel="noopener">' + esc(tr("Open app passwords")) + '</a><a href="' + esc(p.filters) + '" target="_blank" rel="noopener">' + esc(tr("Open filters")) + "</a></div>" +
        '<label class="mail-lab">' + esc(tr("Filter rule")) + '</label><pre class="mail-rule">' + esc(rule) + "</pre>" + btn(tr("Copy rule"), 'data-mail-copytext="' + esc(rule) + '"') +
        '<p class="mail-note">' + esc(tr("These pages belong to your mail service: it only lets you make app passwords and filters there.")) + "</p>" +
        '<div class="mail-row">' + btn(tr("I've done this"), "data-mail-step=\"form\"", "primary") + btn(tr("Back"), "data-mail-step=\"provider\"") + "</div>";
    }
    if (w.step === "form" && p) {
      var f = w.form;
      return '<h2 class="mail-h2">' + esc(tr("Connect {name}", { name: p.name })) + "</h2>" + err +
        '<form class="mail-form" data-mail-form autocomplete="off">' +
        '<label class="mail-lab">' + esc(tr("Email address")) + '<input name="user" type="email" inputmode="email" autocomplete="username" required value="' + esc(f.user || "") + '"></label>' +
        '<label class="mail-lab">' + esc(tr("App password")) + '<input name="pass" type="password" autocomplete="current-password" required></label>' +
        '<label class="mail-lab">' + esc(tr("Folder")) + '<input name="folder" required value="' + esc(f.folder || "ViktorychApp") + '"></label>' +
        '<label class="mail-check"><input type="checkbox" name="allowInbox"' + (f.allowInbox ? " checked" : "") + "> " + esc(tr("Allow reading INBOX (not recommended)")) + "</label>" +
        '<h3 class="sms-h">' + esc(tr("Filters")) + "</h3>" +
        '<label class="mail-lab">' + esc(tr("Only these senders (one per line, optional)")) + '<textarea name="from" rows="3">' + esc((f.from || []).join("\n")) + "</textarea></label>" +
        '<label class="mail-check"><input type="checkbox" name="codesOnly"' + (f.codesOnly ? " checked" : "") + "> " + esc(tr("Codes only")) + "</label>" +
        '<label class="mail-lab">' + esc(tr("Maximum age")) + '<select name="days">' + [[7, tr("7 days")], [30, tr("30 days")], [90, tr("90 days")], [0, tr("Any age")]].map(function (o) {
          return '<option value="' + o[0] + '"' + (Number(f.days == null ? 30 : f.days) === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>";
        }).join("") + "</select></label>" +
        '<div class="mail-row"><button type="submit" class="mail-btn primary"' + (w.busy ? " disabled" : "") + ">" + esc(w.busy ? tr("Testing…") : tr("Test and connect")) + "</button>" + btn(tr("Back"), "data-mail-step=\"guide\"") + "</div></form>";
    }
    return "";
  }
  function readForm(form) {
    var get = function (n) { var el = form.elements[n]; return el ? el.value : ""; };
    return {
      user: get("user").trim(),
      pass: get("pass"),
      folder: get("folder").trim(),
      allowInbox: !!(form.elements.allowInbox && form.elements.allowInbox.checked),
      from: get("from").split(/[\n,]+/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 10),
      codesOnly: !!(form.elements.codesOnly && form.elements.codesOnly.checked),
      days: Number(get("days")) || 0
    };
  }
  function submitWizard(form) {
    var w = state.wiz;
    var f = readForm(form);
    w.form = { user: f.user, folder: f.folder, allowInbox: f.allowInbox, from: f.from, codesOnly: f.codesOnly, days: f.days };
    if (/^inbox$/i.test(f.folder) && !f.allowInbox) { w.error = "folder_not_allowed"; repaint(); return; }
    var acct = { provider: w.provider, user: f.user, pass: f.pass, folder: f.folder, allowInbox: f.allowInbox, filters: { from: f.from, codesOnly: f.codesOnly, days: f.days } };
    w.busy = true; w.error = ""; repaint();
    var prev = state.acct;
    state.acct = acct;
    relay({ op: "check" }).then(function (r) {
      w.busy = false;
      var err = errorOf(r);
      if (err) { state.acct = prev; w.error = err; repaint(); return; }
      state.cache = { uidvalidity: 0, last: 0, messages: [], bodies: {} };
      vault().put("mail.account", acct).then(function () {
        inbox().setLinked("mail", true);
        saveCache();
        state.wiz = { step: "consent", provider: "", form: {}, busy: false, error: "" };
        go("#/messages/mail");
        sync();
      });
    });
  }

  /* ---------- Mail list / reader / settings ---------- */
  function rowHtml(m) {
    return '<a class="mail-item' + (m.seen || m.read ? "" : " unread") + '" href="#/messages/mail/m/' + m.uid + '">' + avatar(m.from) +
      '<div class="mail-main"><div class="mail-top"><b>' + esc(m.from || m.address) + '</b><span class="mail-time">' + esc(ago(m.at)) + "</span></div>" +
      '<div class="mail-subj">' + esc(m.subject || tr("(no subject)")) + "</div></div>" +
      (m.code ? codeChip(m.code, false) : "") + "</a>";
  }
  function listHtml() {
    if (!state.loaded) return '<div class="skel"><div class="av"></div><div style="flex:1"><i></i><i style="width:80%"></i></div></div>';
    if (!state.acct) return wizardHtml();
    var msgs = state.cache.messages;
    var bar = '<div class="sms-sub"><div><b>' + esc(state.acct.folder) + "</b><span>" + esc(state.fetchedAt ? tr("Updated {time}", { time: ago(state.fetchedAt) }) : "") + "</span></div>" +
      '<a class="mail-gear" href="#/messages/mail/settings" aria-label="' + esc(tr("Mail settings")) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-1.6-8h3.2l.5 2.6 1.6.9 2.5-.9 1.6 2.8-2 1.7v1.8l2 1.7-1.6 2.8-2.5-.9-1.6.9-.5 2.6h-3.2l-.5-2.6-1.6-.9-2.5.9-1.6-2.8 2-1.7v-1.8l-2-1.7 1.6-2.8 2.5.9 1.6-.9z"/></svg></a>' +
      '<button type="button" class="sms-refresh' + (state.loading ? " spin" : "") + '" data-mail-refresh aria-label="' + esc(tr("Refresh")) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a8 8 0 0 1 7.4 5H17v2h6V5h-2v2.3A10 10 0 1 0 22 12h-2a8 8 0 1 1-8-8z"/></svg></button></div>';
    var warn = state.error ? '<p class="sms-note">' + esc(errorText(state.error)) + "</p>" : "";
    if (!msgs.length) return bar + warn + notice(tr("No mail yet"), tr("Mail that your filter moves into {folder} shows up here.", { folder: state.acct.folder }));
    return bar + warn + '<div class="mail-items">' + msgs.map(rowHtml).join("") + "</div>";
  }
  function readerHtml(uid) {
    var m = state.cache && state.cache.messages.find(function (x) { return x.uid === uid; });
    if (!m) return notice(tr("Message not found"), tr("It may be older than this device keeps."));
    var body = state.cache.bodies[uid];
    if (body == null) setTimeout(function () { openBody(uid); }, 0);
    var code = m.code || codeIn(body);
    return '<article class="mail-read"><div class="mail-top">' + avatar(m.from) + '<div class="sms-meta"><b>' + esc(m.from) + "</b><span>" + esc([m.address, ago(m.at)].filter(Boolean).join(" · ")) + "</span></div></div>" +
      "<h2>" + esc(m.subject || tr("(no subject)")) + "</h2>" + (code ? codeChip(code, true) : "") +
      (body == null ? '<div class="sms-wait"><span class="sms-dots" aria-hidden="true"><i></i><i></i><i></i></span>' + esc(tr("Loading message…")) + "</div>" : '<pre class="mail-text">' + esc(body) + "</pre>") + "</article>";
  }
  function settingsHtml() {
    if (!state.acct) return notice(tr("Mail isn't connected"), "", '<a class="mail-btn primary" href="#/messages/mail">' + esc(tr("Connect")) + "</a>");
    var a = state.acct, f = a.filters || {};
    return '<h2 class="mail-h2">' + esc(tr("Mail settings")) + '</h2><ul class="mail-list">' +
      "<li>" + esc(tr("Service: {name}", { name: (PROVIDERS[a.provider] || {}).name || a.provider })) + "</li>" +
      "<li>" + esc(tr("Folder: {folder}", { folder: a.folder })) + "</li>" +
      "<li>" + esc(f.codesOnly ? tr("Codes only: on") : tr("Codes only: off")) + "</li>" +
      "<li>" + esc(f.days ? tr("Maximum age: {n} days", { n: f.days }) : tr("Maximum age: any")) + "</li>" +
      "<li>" + esc(tr("Read-only: moving, deleting and sending are off.")) + "</li></ul>" +
      '<div class="mail-row">' + btn(tr("Change settings"), "data-mail-edit") + btn(tr("Disconnect and wipe mail"), "data-mail-disconnect", "danger") + "</div>";
  }
  function disconnect() {
    state.acct = null;
    state.cache = { uidvalidity: 0, last: 0, messages: [], bodies: {} };
    inbox().setLinked("mail", false);
    vault().drop(["mail.account", "mail.cache"]).then(function () { go("#/messages/connect"); });
  }

  /* ---------- SimpleLogin (native) ---------- */
  function slCall(path, opts) {
    opts = opts || {};
    var headers = { accept: "application/json" };
    if (opts.body) headers["content-type"] = "application/json";
    if (state.sl.key && !opts.anon) headers.Authentication = state.sl.key;
    return root.fetch(SL + path, { method: opts.method || "GET", headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: "omit", cache: "no-store" }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data || {} }; });
    }, function () { return { status: 0, data: { error: "offline" } }; });
  }
  function slError(r) {
    if (!r.status) return tr("Check your connection and try again.");
    if (r.status === 429) return tr("Too many tries. Wait a minute and try again.");
    return String((r.data && r.data.error) || tr("SimpleLogin said no. Try again."));
  }
  function slSaveKey(key) {
    state.sl.key = key;
    state.sl.pass = "";
    return vault().put("sl.key", { key: key }).then(function () { state.sl.step = "aliases"; slLoadAliases(); });
  }
  function slAfterLogin(r) {
    var s = state.sl;
    if (r.status === 200 && r.data.api_key) return slSaveKey(r.data.api_key);
    if (r.status === 200 && r.data.mfa_enabled && r.data.mfa_key) { s.mfaKey = r.data.mfa_key; s.step = "mfa"; s.pass = ""; return null; }
    if (r.status === 403) { s.error = tr("This account uses a security key. Sign in with an API key instead."); s.step = "apikey"; return null; }
    s.error = slError(r);
    return null;
  }
  function slLoadAliases() {
    var s = state.sl;
    s.busy = true; repaint();
    Promise.all([slCall("/api/v2/aliases?page_id=0"), slCall("/api/user_info"), slCall("/api/v5/alias/options")]).then(function (got) {
      s.busy = false;
      if (got[0].status === 401) { slForget(); s.error = tr("SimpleLogin signed this device out. Sign in again."); repaint(); return; }
      s.aliases = got[0].status === 200 ? (got[0].data.aliases || []) : [];
      s.info = got[1].status === 200 ? got[1].data : null;
      s.options = got[2].status === 200 ? got[2].data : null;
      repaint();
    });
  }
  function slForget() {
    var s = state.sl;
    if (s.key) slCall("/api/logout").then(function () { return null; });
    s.key = ""; s.aliases = null; s.options = null; s.info = null; s.step = ""; s.pass = ""; s.mfaKey = "";
    vault().drop(["sl.key"]);
  }
  function slSubmit(form) {
    var s = state.sl;
    var v = function (n) { return form.elements[n] ? String(form.elements[n].value || "").trim() : ""; };
    var raw = function (n) { return form.elements[n] ? String(form.elements[n].value || "") : ""; };
    s.error = ""; s.busy = true; repaint();
    var finish = function () { s.busy = false; repaint(); };
    var kind = form.getAttribute("data-sl-form");
    if (kind === "signup") {
      s.email = v("email"); s.pass = raw("password");
      if (s.pass.length < 8) { s.error = tr("Use at least 8 characters."); finish(); return; }
      slCall("/api/auth/register", { method: "POST", anon: true, body: { email: s.email, password: s.pass } }).then(function (r) {
        if (r.status === 200) s.step = "activate"; else s.error = slError(r);
        finish();
      });
    } else if (kind === "activate") {
      slCall("/api/auth/activate", { method: "POST", anon: true, body: { email: s.email, code: v("code") } }).then(function (r) {
        if (r.status !== 200) { s.error = r.status === 410 ? tr("Too many wrong codes. Ask for a new one.") : slError(r); finish(); return; }
        return slCall("/api/auth/login", { method: "POST", anon: true, body: { email: s.email, password: s.pass, device: "ViktorychApp" } }).then(slAfterLogin).then(finish);
      });
    } else if (kind === "login") {
      s.email = v("email");
      slCall("/api/auth/login", { method: "POST", anon: true, body: { email: s.email, password: raw("password"), device: "ViktorychApp" } }).then(slAfterLogin).then(finish);
    } else if (kind === "mfa") {
      slCall("/api/auth/mfa", { method: "POST", anon: true, body: { mfa_token: v("otp"), mfa_key: s.mfaKey, device: "ViktorychApp" } }).then(function (r) {
        if (r.status === 200 && r.data.api_key) return slSaveKey(r.data.api_key);
        s.error = slError(r);
        return null;
      }).then(finish);
    } else if (kind === "apikey") {
      var key = v("key");
      state.sl.key = key;
      slCall("/api/user_info").then(function (r) {
        if (r.status === 200) return slSaveKey(key);
        state.sl.key = ""; s.error = tr("SimpleLogin didn't accept that API key.");
        return null;
      }).then(finish);
    } else if (kind === "alias") {
      var opt = s.options && s.options.suffixes ? s.options.suffixes[Number(v("suffix")) || 0] : null;
      if (!opt) { s.error = tr("SimpleLogin didn't offer an alias domain."); finish(); return; }
      slCall("/api/v2/mailboxes").then(function (mb) {
        var boxes = mb.status === 200 ? (mb.data.mailboxes || []) : [];
        var def = boxes.find(function (b) { return b.default; }) || boxes[0];
        return slCall("/api/v3/alias/custom/new", { method: "POST", body: { alias_prefix: v("prefix").toLowerCase(), signed_suffix: opt.signed_suffix, mailbox_ids: def ? [def.id] : [], note: "ViktorychApp codes" } });
      }).then(function (r) {
        if (r.status === 201) { s.step = "aliases"; slLoadAliases(); } else s.error = slError(r);
        finish();
      });
    }
  }
  function slRandom() {
    var s = state.sl;
    s.busy = true; repaint();
    slCall("/api/alias/random/new", { method: "POST", body: { note: "ViktorychApp codes" } }).then(function (r) {
      s.busy = false;
      if (r.status === 201) slLoadAliases(); else { s.error = slError(r); repaint(); }
    });
  }
  function field(label, name, type, extra) {
    return '<label class="mail-lab">' + esc(label) + '<input name="' + name + '" type="' + (type || "text") + '" required ' + (extra || "") + "></label>";
  }
  function slForm(kind, title, inner, submit) {
    var s = state.sl;
    return '<h2 class="mail-h2">' + esc(title) + "</h2>" + (s.error ? '<p class="mail-err" role="alert">' + esc(s.error) + "</p>" : "") +
      '<form class="mail-form" data-sl-form="' + kind + '" autocomplete="off">' + inner +
      '<div class="mail-row"><button type="submit" class="mail-btn primary"' + (s.busy ? " disabled" : "") + ">" + esc(s.busy ? tr("Working…") : submit) + "</button>" + btn(tr("Back"), "data-sl-step=\"\"") + "</div></form>";
  }
  function aliasesHtml() {
    var s = state.sl;
    if (s.key && !s.step) s.step = "aliases";
    var mailUser = state.acct ? state.acct.user : "";
    if (!s.step) {
      return '<h2 class="mail-h2">' + esc(tr("Email aliases")) + '</h2><ul class="mail-list">' +
        [tr("A free SimpleLogin account gives you aliases: addresses you hand out instead of your real one."),
          tr("Mail to an alias forwards to your own mailbox. Your Mail filter can then move code emails into your ViktorychApp folder."),
          tr("Sign-up and sign-in happen right here. Your password goes only to SimpleLogin and is never stored; the key it returns stays encrypted on this device.")].map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") +
        '</ul><div class="mail-row">' + btn(tr("Create free account"), "data-sl-step=\"signup\"", "primary") + btn(tr("Sign in"), "data-sl-step=\"login\"") + "</div>";
    }
    if (s.step === "signup") return slForm("signup", tr("Create a SimpleLogin account"), field(tr("Your real email (aliases forward here)"), "email", "email", 'autocomplete="email" value="' + esc(s.email || mailUser) + '"') + field(tr("New SimpleLogin password"), "password", "password", 'autocomplete="new-password" minlength="8"') + '<p class="mail-note">' + esc(tr("By creating an account you accept SimpleLogin's terms.")) + "</p>", tr("Create account"));
    if (s.step === "activate") {
      var auto = autoCode();
      return slForm("activate", tr("Enter the code from SimpleLogin"), '<p class="mail-note">' + esc(tr("SimpleLogin emailed a code to {email}.", { email: s.email })) + "</p>" + field(tr("Activation code"), "code", "text", 'inputmode="numeric" autocomplete="one-time-code" value="' + esc(auto) + '"'), tr("Activate"));
    }
    if (s.step === "login") return slForm("login", tr("Sign in to SimpleLogin"), field(tr("Email"), "email", "email", 'autocomplete="username" value="' + esc(s.email || mailUser) + '"') + field(tr("Password"), "password", "password", 'autocomplete="current-password"') + '<p class="mail-note"><button type="button" class="mail-link" data-sl-step="apikey">' + esc(tr("Use an API key instead")) + "</button></p>", tr("Sign in"));
    if (s.step === "mfa") return slForm("mfa", tr("Two-factor code"), field(tr("6-digit code from your authenticator"), "otp", "text", 'inputmode="numeric" autocomplete="one-time-code" maxlength="8"'), tr("Verify"));
    if (s.step === "apikey") return slForm("apikey", tr("Paste your SimpleLogin API key"), field(tr("API key"), "key", "password", 'autocomplete="off"'), tr("Connect"));
    if (s.step === "new") {
      var sfx = s.options && s.options.suffixes ? s.options.suffixes : [];
      return slForm("alias", tr("New alias"), field(tr("Start of the alias"), "prefix", "text", 'pattern="[a-z0-9._-]{1,40}" autocapitalize="off"') +
        '<label class="mail-lab">' + esc(tr("Ending")) + '<select name="suffix">' + sfx.map(function (x, i) { return '<option value="' + i + '"' + (x.is_premium ? " disabled" : "") + ">" + esc(x.suffix) + "</option>"; }).join("") + "</select></label>", tr("Create alias"));
    }
    // aliases
    var list = s.aliases;
    var info = s.info;
    var quota = info && info.max_alias_free_plan && !info.is_premium ? '<p class="mail-note">' + esc(tr("Free plan: up to {n} aliases.", { n: info.max_alias_free_plan })) + "</p>" : "";
    var rows = list == null ? '<div class="skel"><div class="av"></div><div style="flex:1"><i></i></div></div>' : (list.length ? list.map(function (a) {
      var copied = state.copied === a.email;
      return '<div class="mail-item">' + avatar(a.email) + '<div class="mail-main"><div class="mail-top"><b>' + esc(a.email) + "</b></div><div class=\"mail-subj\">" + esc(a.enabled ? tr("Forwarding") : tr("Paused")) + "</div></div>" +
        '<button type="button" class="mail-btn small" data-mail-copytext="' + esc(a.email) + '">' + esc(copied ? tr("Copied") : tr("Copy")) + "</button></div>";
    }).join("") : notice(tr("No aliases yet"), tr("Create one and use it when a site asks for your email.")));
    return '<h2 class="mail-h2">' + esc(tr("Your aliases")) + "</h2>" + (s.error ? '<p class="mail-err" role="alert">' + esc(s.error) + "</p>" : "") + quota + rows +
      '<div class="mail-row">' + btn(tr("New alias"), "data-sl-step=\"new\"", "primary") + btn(tr("Random alias"), "data-sl-random") + btn(tr("Disconnect SimpleLogin"), "data-sl-forget", "danger") + "</div>";
  }
  /* The activation code may already be in the member's Mail folder. */
  function autoCode() {
    var c = state.cache;
    if (!c || !c.messages) return "";
    var hit = c.messages.find(function (m) { return /simplelogin/i.test(m.address + " " + m.from) && m.code && Date.now() - m.at < 3600000; });
    return hit ? hit.code : "";
  }

  /* ---------- page ---------- */
  function sub() {
    var m = hash().match(/^#\/(?:messages|inbox)\/(?:mail|connect|aliases)\/?([^?]*)/);
    return m ? m[1] : "";
  }
  function bodyHtml() {
    var sec = section();
    if (sec === "connect") return null;
    if (sec === "aliases") return '<section class="mail-body">' + aliasesHtml() + "</section>";
    var s = sub();
    if (/^m\/\d+$/.test(s)) return '<section class="mail-body">' + readerHtml(Number(s.slice(2))) + "</section>";
    if (s === "settings") return '<section class="mail-body">' + settingsHtml() + "</section>";
    if (!state.acct && state.loaded) return '<section class="mail-body">' + wizardHtml() + "</section>";
    return '<section class="mail-body" aria-live="polite">' + listHtml() + "</section>";
  }
  function page() {
    var sec = section();
    if (!token()) return '<div class="inbox-mail" data-inbox-mail>' + head(tr("Inbox")) + notice(tr("Sign in to use Mail."), "") + "</div>";
    loadAll().then(function () { repaint(); if (sec === "mail") start(); if (sec === "aliases" && state.sl.key && !state.sl.aliases) slLoadAliases(); });
    if (sec === "connect") return connectPage();
    var s = sub();
    var back = /^m\/\d+$/.test(s) || s === "settings" ? "#/messages/mail" : "";
    return '<div class="inbox-mail" data-inbox-mail>' + head(back ? tr("Mail") : tr("Inbox"), back) + '<div data-mail-root>' + bodyHtml() + "</div></div>";
  }
  function repaint() {
    if (!root.document) return;
    var el = root.document.querySelector("[data-inbox-mail] [data-mail-root]");
    if (el) el.innerHTML = bodyHtml();
  }
  function go(h) { if (root.location) root.location.hash = h; }

  if (root.document) {
    root.document.addEventListener("click", function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest("[data-mail-copy],[data-mail-copytext],[data-mail-refresh],[data-mail-step],[data-mail-provider],[data-mail-edit],[data-mail-disconnect],[data-sl-step],[data-sl-random],[data-sl-forget]") : null;
      if (!t || !t.closest("[data-inbox-mail]")) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (t.hasAttribute("data-mail-copy")) copy(t.getAttribute("data-mail-copy"));
      else if (t.hasAttribute("data-mail-copytext")) copy(t.getAttribute("data-mail-copytext"));
      else if (t.hasAttribute("data-mail-refresh")) sync().then(schedule);
      else if (t.hasAttribute("data-mail-step")) { state.wiz.step = t.getAttribute("data-mail-step"); state.wiz.error = ""; repaint(); }
      else if (t.hasAttribute("data-mail-provider")) { state.wiz.provider = t.getAttribute("data-mail-provider"); state.wiz.step = "guide"; repaint(); }
      else if (t.hasAttribute("data-mail-edit")) {
        var a = state.acct;
        state.wiz = { step: "form", provider: a.provider, form: { user: a.user, folder: a.folder, allowInbox: a.allowInbox, from: (a.filters || {}).from, codesOnly: (a.filters || {}).codesOnly, days: (a.filters || {}).days }, busy: false, error: "" };
        state.acct = null;
        go("#/messages/mail");
        repaint();
        state.acct = a;
        var el = root.document.querySelector("[data-inbox-mail] [data-mail-root]");
        if (el) el.innerHTML = '<section class="mail-body">' + wizardHtml() + "</section>";
      }
      else if (t.hasAttribute("data-mail-disconnect")) { if (!root.confirm || root.confirm(tr("Disconnect Mail and wipe its mail from this device?"))) disconnect(); }
      else if (t.hasAttribute("data-sl-step")) { state.sl.step = t.getAttribute("data-sl-step"); state.sl.error = ""; if (!state.sl.step && state.sl.key) state.sl.step = "aliases"; repaint(); }
      else if (t.hasAttribute("data-sl-random")) slRandom();
      else if (t.hasAttribute("data-sl-forget")) { slForget(); repaint(); }
    }, true);
    root.document.addEventListener("submit", function (ev) {
      var form = ev.target;
      if (!form || !form.closest || !form.closest("[data-inbox-mail]")) return;
      ev.preventDefault();
      if (form.hasAttribute("data-mail-form")) submitWizard(form);
      else if (form.hasAttribute("data-sl-form")) slSubmit(form);
    }, true);
    root.document.addEventListener("visibilitychange", function () {
      if (root.document.hidden) { clearTimeout(state.timer); state.timer = 0; return; }
      if (section() === "mail" && state.acct) sync().then(schedule);
    });
    root.addEventListener("hashchange", function () { if (section() !== "mail") stop(); });
  }

  var api = { page: page, codeIn: codeIn, PROVIDERS: PROVIDERS, _test: { state: state, rowHtml: rowHtml, readForm: readForm } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ViktorychInboxMail = api;
})(typeof window !== "undefined" ? window : globalThis);
