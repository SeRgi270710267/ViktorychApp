/* Inbox: the page once called Messages. Old #/messages links keep working and
   #/inbox… links are rewritten to the same page. Filter chips in X's style sit
   under the title and only show the kinds of conversation the app really has:
   the app's own servers and the read-only Discord mirror. The owner also gets
   "SMS codes" (inbox-sms.js, loaded on demand) for the rented SMSPool numbers.
   Other kinds of conversation register with ViktorychInbox.register(). */
(function (root) {
  "use strict";

  function tr(key, vars) {
    var fn = root && root.t ? root.t : null;
    return fn ? fn(key, vars) : key;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  var extra = [];

  function isOwner() {
    try {
      var acc = root.ViktorychAccounts && root.ViktorychAccounts.account ? root.ViktorychAccounts.account() : null;
      if (!acc) return false;
      if (acc.owner) return true;
      var c = root.HandleSkeleton && root.HandleSkeleton.inspectHandle ? root.HandleSkeleton.inspectHandle(String(acc.handle || "")) : null;
      return !!(c && c.owner);
    } catch (err) { return false; }
  }

  /* #/inbox, #/inbox/sms, #/inbox?f=servers → the same #/messages page. */
  function aliasHash(hash) {
    var text = String(hash || "");
    var m = text.match(/^#\/inbox(?=$|[/?])(.*)$/);
    return m ? "#/messages" + m[1] : "";
  }

  function hashQuery(hash) {
    var text = String(hash || "");
    var q = text.indexOf("?");
    try { return new URLSearchParams(q >= 0 ? text.slice(q + 1) : ""); } catch (err) { return null; }
  }

  function isSmsHash(hash) {
    return /^#\/(?:messages|inbox)\/sms(?:$|[/?])/.test(String(hash || ""));
  }

  /* "all", "servers", "discord", "sms" or a registered id. */
  function filterOf(hash) {
    if (isSmsHash(hash)) return "sms";
    var q = hashQuery(hash);
    var f = q ? String(q.get("f") || "") : "";
    if (f === "servers" || f === "discord") return f;
    for (var i = 0; i < extra.length; i++) if (extra[i].id === f) return f;
    return "all";
  }

  /* A change between chips repaints the page instead of the in-page sync. */
  function viewKey(hash) {
    return filterOf(hash);
  }

  function chips() {
    var list = [
      { id: "all", label: tr("All"), href: "#/messages" },
      { id: "servers", label: tr("Servers"), href: "#/messages?f=servers" },
      { id: "discord", label: tr("Discord"), href: "#/messages?f=discord" }
    ];
    extra.forEach(function (item) {
      try { if (item.visible && !item.visible()) return; } catch (err) { return; }
      list.push({ id: item.id, label: item.label, href: item.href || ("#/messages?f=" + encodeURIComponent(item.id)) });
    });
    if (isOwner()) list.push({ id: "sms", label: tr("SMS codes"), href: "#/messages/sms", owner: true });
    return list;
  }

  function tabsHtml(hash) {
    var here = filterOf(hash == null ? (root.location ? root.location.hash : "") : hash);
    var html = chips().map(function (c) {
      var on = c.id === here;
      return '<a class="inbox-chip' + (on ? " on" : "") + (c.owner ? " owner" : "") + '" role="tab" aria-selected="' + (on ? "true" : "false") + '" href="' + esc(c.href) + '" data-inbox="' + esc(c.id) + '"><span>' + esc(c.label) + "</span></a>";
    }).join("");
    return '<nav class="inbox-chips" role="tablist" aria-label="' + esc(tr("Inbox filters")) + '">' + html + "</nav>";
  }

  function register(item) {
    if (!item || !item.id || !/^[a-z][a-z0-9-]{1,23}$/.test(item.id) || ["all", "servers", "discord", "sms"].indexOf(item.id) >= 0) return false;
    extra = extra.filter(function (x) { return x.id !== item.id; });
    extra.push(item);
    return true;
  }

  var api = { isOwner: isOwner, aliasHash: aliasHash, isSmsHash: isSmsHash, filterOf: filterOf, viewKey: viewKey, tabsHtml: tabsHtml, register: register };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViktorychInbox = api;
})(typeof window !== "undefined" ? window : null);
