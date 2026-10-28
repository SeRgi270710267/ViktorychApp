/* About tab for in-app profiles. External profiles never call this. */
(function (root) {
  "use strict";

  var SECTIONS = ["personal", "interests", "work", "links", "websites"];
  var KINDS = {
    personal: ["city", "hometown", "birthday", "relationship", "family", "language"],
    interests: ["interest"],
    work: ["work", "education"],
    links: ["link"],
    websites: ["website"]
  };
  var SENSITIVE = { birthday: 1, relationship: 1, family: 1 };

  function sectionTitle(id) {
    if (id === "personal") return tr("Personal details");
    if (id === "interests") return tr("Interests");
    if (id === "work") return tr("Work and education");
    if (id === "links") return tr("Links");
    if (id === "websites") return tr("Websites");
    return tr("About");
  }

  function kindLabel(kind) {
    if (kind === "city") return tr("Current city");
    if (kind === "hometown") return tr("Hometown");
    if (kind === "birthday") return tr("Birthday");
    if (kind === "relationship") return tr("Relationship status");
    if (kind === "family") return tr("Family members");
    if (kind === "language") return tr("Languages");
    if (kind === "interest") return tr("Interest");
    if (kind === "work") return tr("Work");
    if (kind === "education") return tr("Education");
    if (kind === "link") return tr("Link label");
    if (kind === "website") return tr("Website label");
    return tr("Add a detail");
  }
  var sheet = null;
  var draft = [];
  var seq = 1;
  var privacyOpen = false;
  var errorText = "";
  var notesOn = true;
  var upcomingPack = null;

  function tr(key, vars) {
    var fn = root.t || (typeof window !== "undefined" && window.t);
    var text = fn ? fn(key, vars) : key;
    if (!fn && vars) {
      Object.keys(vars).forEach(function (name) {
        text = String(text).split("{" + name + "}").join(String(vars[name]));
      });
    }
    return text;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function svg(path) {
    return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="' + path + '"/></svg>';
  }

  function icon(name) {
    if (name === "lock") return svg("M17 9V7A5 5 0 0 0 7 7v2H5v12h14V9h-2zm-8-2a3 3 0 0 1 6 0v2H9V7zm8 12H7v-8h10v8z");
    if (name === "globe") return svg("M12 2a10 10 0 1 0 .01 20.01A10 10 0 0 0 12 2zm6.9 9h-3.2a15 15 0 0 0-1.2-5 8 8 0 0 1 4.4 5zM12 4c.8 1.2 1.6 3.2 1.9 5H10c.3-1.8 1.1-3.8 2-5zM4.1 13h3.2a15 15 0 0 0 1.2 5 8 8 0 0 1-4.4-5zM12 20c-.8-1.2-1.6-3.2-1.9-5h3.8c-.3 1.8-1.1 3.8-1.9 5zM8.5 13H4.1a8 8 0 0 1 4.4-5 15 15 0 0 0 0 5zm2.4 0a13 13 0 0 1 0-5h2.2a13 13 0 0 1 0 5h-2.2zm4.6 0a15 15 0 0 0 0-5 8 8 0 0 1 4.4 5h-4.4z");
    if (name === "pin") return svg("M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z");
    if (name === "home") return svg("M12 3 3 10h2v9h5v-6h4v6h5v-9h2L12 3z");
    if (name === "cake") return svg("M12 6a2 2 0 0 1 2-2c0-1.5-2-2-2-2s-2 .5-2 2a2 2 0 0 1 2 2zm7 6v8H5v-8h14zM4 10h16v2H4v-2z");
    if (name === "heart") return svg("M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z");
    if (name === "people") return svg("M9 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm6 1a2.5 2.5 0 1 0-2.5-2.5A2.5 2.5 0 0 0 15 12zM9 13c-2.7 0-6 1.3-6 4v2h8v-2c0-1 .4-1.8 1-2.5A8 8 0 0 0 9 13zm6 1c-.4 0-.8 0-1.2.1 1.2.8 2.2 2 2.2 3.4V19h6v-1.5c0-2.2-3.6-3.5-7-3.5z");
    if (name === "star") return svg("m12 3 2.4 5.6L20 9.2l-4 3.8.9 5.8L12 16.2 7.1 18.8 8 13 4 9.2l5.6-.6L12 3z");
    if (name === "case") return svg("M9 6V4h6v2h5v14H4V6h5zm2 0h2V5h-2v1z");
    if (name === "cap") return svg("M12 4 2 9l10 5 8-4v6h2V9L12 4zM6 13v3c0 1.5 2.7 3 6 3s6-1.5 6-3v-3l-6 3-6-3z");
    if (name === "link") return svg("M10.6 13.4a1 1 0 0 1 0-1.4l3.4-3.4a2.5 2.5 0 0 1 3.5 3.5l-1.8 1.8-1.4-1.4 1.8-1.8a.5.5 0 0 0-.7-.7l-3.4 3.4a.5.5 0 0 0 0 .7l.2.2-1.4 1.4-.2-.3z");
    if (name === "pencil") return svg("M3 17.2V21h3.8L18.1 9.7l-3.8-3.8L3 17.2zM20.7 7.1a1 1 0 0 0 0-1.4l-2.4-2.4a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8 1.8-1.8z");
    return svg("M12 2a10 10 0 1 0 .01 20.01A10 10 0 0 0 12 2z");
  }

  function kindIcon(kind) {
    if (kind === "city") return "pin";
    if (kind === "hometown") return "home";
    if (kind === "birthday") return "cake";
    if (kind === "relationship") return "heart";
    if (kind === "family") return "people";
    if (kind === "language") return "globe";
    if (kind === "interest") return "star";
    if (kind === "work") return "case";
    if (kind === "education") return "cap";
    if (kind === "link") return "link";
    return "globe";
  }

  function token() {
    try { return root.ViktorychAccounts && root.ViktorychAccounts.token ? root.ViktorychAccounts.token() : ""; }
    catch (err) { return ""; }
  }

  function call(path, opts) {
    if (!root.ViktorychAccounts || !root.ViktorychAccounts.call) return Promise.resolve({ status: 503 });
    return root.ViktorychAccounts.call(path, opts);
  }

  function redraw() {
    if (root.ViktorychAccounts && root.ViktorychAccounts.requestRender) root.ViktorychAccounts.requestRender();
  }

  function lists() {
    try { return (root.ProfileAbout && root.ProfileAbout.lists ? root.ProfileAbout.lists() : []) || []; }
    catch (err) { return []; }
  }

  function packOf(account) {
    return (account && account.about) || { sections: [], owner: false, visible: false, preview: "" };
  }

  function fieldsOf(pack, section) {
    var found = null;
    ((pack && pack.sections) || []).forEach(function (item) {
      if (item && item.id === section) found = item.fields || [];
    });
    return found || [];
  }

  function allFields(pack) {
    var out = [];
    SECTIONS.forEach(function (id) {
      fieldsOf(pack, id).forEach(function (field) { out.push(field); });
    });
    return out;
  }

  function audienceIcon(field) {
    if (!field || !field.audience || field.audience === "public") return icon("globe");
    return icon("lock");
  }

  function familyRow(fields) {
    var n = fields.length;
    var faces = fields.slice(0, 3).map(function (field) {
      var letter = esc(((field.person && (field.person.name || field.person.handle)) || field.text || "?").trim().slice(0, 1).toUpperCase() || "?");
      var href = field.person && field.person.handle ? "#/@" + encodeURIComponent(field.person.handle) : "";
      var face = '<span class="about-ava">' + letter + "</span>";
      return href ? '<a href="' + esc(href) + '">' + face + "</a>" : face;
    }).join("");
    var label = n === 1 ? tr("1 family member") : tr("{count} family members", { count: String(n) });
    return '<div class="about-row"><span class="about-ico">' + icon("people") + '</span><span class="about-copy"><span class="about-faces">' + faces + "</span><span>" + esc(label) + "</span></span></div>";
  }

  function languageRow(fields) {
    var text = fields.map(function (field) { return field.text; }).filter(Boolean).join(" · ");
    if (!text) return "";
    return '<div class="about-row"><span class="about-ico">' + icon("globe") + '</span><span class="about-copy">' + esc(text) + "</span></div>";
  }

  function rowHtml(field, mine) {
    var href = "";
    if (field.url) href = field.url;
    else if (field.person && field.person.handle) href = "#/@" + encodeURIComponent(field.person.handle);
    var text = field.text || "";
    if (field.person && field.person.name) text = field.person.name + (text ? " · " + text : "");
    var body = href ? '<a href="' + esc(href) + '"' + (field.url ? ' target="_blank" rel="noopener noreferrer"' : "") + ">" + esc(field.label || text) + "</a>" : esc(field.label ? field.label + (text ? " · " + text : "") : text);
    var mark = mine && field.audience ? '<span class="about-aud" title="' + esc(audienceLabel(field.audience)) + '">' + audienceIcon(field) + "</span>" : "";
    return '<div class="about-row"><span class="about-ico">' + icon(kindIcon(field.kind)) + '</span><span class="about-copy">' + body + "</span>" + mark + "</div>";
  }

  function sectionHtml(pack, id, mine) {
    var fields = fieldsOf(pack, id);
    if (!fields.length && !mine) return "";
    var body = "";
    if (id === "personal") {
      var family = fields.filter(function (field) { return field.kind === "family"; });
      var languages = fields.filter(function (field) { return field.kind === "language"; });
      var rest = fields.filter(function (field) { return field.kind !== "family" && field.kind !== "language"; });
      body = rest.map(function (field) { return rowHtml(field, mine); }).join("") + (family.length ? familyRow(family) : "") + languageRow(languages);
    } else body = fields.map(function (field) { return rowHtml(field, mine); }).join("");
    var pencil = mine ? '<button type="button" class="about-pencil" data-about="edit" data-section="' + id + '" aria-label="' + esc(editTitle(id)) + '">' + icon("pencil") + "</button>" : "";
    return '<section class="about-section"><div class="about-head"><h2>' + esc(sectionTitle(id)) + "</h2>" + pencil + "</div>" + body + "</section>";
  }

  function editTitle(id) {
    if (id === "personal") return tr("Edit personal details");
    if (id === "interests") return tr("Edit interests");
    if (id === "work") return tr("Edit work and education");
    if (id === "links") return tr("Edit links");
    if (id === "websites") return tr("Edit websites");
    return tr("Edit profile");
  }

  function audienceLabel(value) {
    if (value === "followers") return tr("Followers");
    if (value === "friends") return tr("Mutuals");
    if (value === "only") return tr("Only me");
    if (String(value || "").indexOf("list:") === 0) {
      var id = String(value).slice(5);
      var found = "";
      lists().forEach(function (list) { if (list && list.id === id) found = list.name || id; });
      return found || tr("Custom list");
    }
    return tr("Everyone");
  }

  function previewHtml(pack, mine) {
    var html = SECTIONS.map(function (id) { return sectionHtml(pack, id, mine); }).join("");
    if (!html) return "";
    var viewAs = "";
    if (mine && !(pack && pack.preview)) {
      viewAs = '<div class="about-viewas"><button type="button" data-about="as" data-as="public">' + esc(tr("View as public")) + '</button><button type="button" data-about="as" data-as="follower">' + esc(tr("View as a follower")) + "</button></div>";
    } else if (pack && pack.preview) {
      viewAs = '<div class="about-viewas"><p>' + esc(pack.preview === "follower" ? tr("View as a follower") : tr("View as public")) + '</p><button type="button" data-about="as" data-as="">' + esc(tr("Back to your view")) + "</button></div>";
    }
    return '<div class="about">' + viewAs + html + sheetHtml() + "</div>";
  }

  function showTab(account) {
    if (!account) return false;
    var session = root.ViktorychAccounts && root.ViktorychAccounts.account && root.ViktorychAccounts.account();
    var mine = !!(session && account.publicId && session.publicId === account.publicId);
    if (mine || account.aboutPreview) return true;
    return !!(account.about && account.about.visible && allFields(account.about).length);
  }

  function ensure(account, preview) {
    if (!account || !account.handle) return;
    var key = (preview || "") + ":" + account.handle;
    if (account.aboutKey === key && (account.aboutLoaded || account.aboutLoading)) return;
    account.aboutLoading = true;
    account.aboutKey = key;
    var path = "/v1/about?handle=" + encodeURIComponent(account.handle) + (preview ? "&as=" + encodeURIComponent(preview) : "");
    call(path, { token: token() }).then(function (body) {
      account.aboutLoading = false;
      account.aboutLoaded = true;
      account.about = body && body.sections ? body : { sections: [], visible: false, owner: false, preview: "" };
      account.birthdayToday = !!(body && body.birthdayToday);
      if (body && body.owner && body.birthdayNotes != null) notesOn = !!body.birthdayNotes;
      redraw();
    }).catch(function () {
      account.aboutLoading = false;
      account.aboutLoaded = true;
      account.about = { sections: [], visible: false, owner: false, preview: "" };
      account.birthdayToday = false;
      redraw();
    });
  }

  function html(account) {
    if (!account) return "";
    var mine = !!(account.about && account.about.owner);
    if (!account.aboutLoaded) {
      ensure(account, account.aboutPreview || "");
      return mine ? '<div class="about"><p class="about-wait">' + esc(tr("Loading…")) + "</p></div>" : "";
    }
    if (!mine && !(account.about && account.about.visible)) return "";
    return previewHtml(account.about, mine);
  }

  function openSheet(account, section) {
    sheet = { section: section, handle: account.handle };
    draft = fieldsOf(account.about, section).map(function (field) {
      return {
        id: field.id,
        section: section,
        kind: field.kind,
        text: field.text || "",
        label: field.label || "",
        url: field.url || "",
        audience: field.audience || (SENSITIVE[field.kind] ? "only" : "public"),
        showYear: !!field.showYear,
        tz: field.tz || "",
        personHandle: field.personHandle || (field.person && field.person.handle) || "",
        listId: field.listId || ""
      };
    });
    errorText = "";
    privacyOpen = false;
    redraw();
  }

  function audienceOptions(selected) {
    var options = [
      ["public", tr("Everyone")],
      ["followers", tr("Followers")],
      ["friends", tr("Mutuals")],
      ["only", tr("Only me")]
    ];
    lists().forEach(function (list) {
      if (!list || !list.id) return;
      options.push(["list:" + list.id, list.name || tr("Custom list")]);
    });
    return options.map(function (pair) {
      return '<option value="' + esc(pair[0]) + '"' + (selected === pair[0] ? " selected" : "") + ">" + esc(pair[1]) + "</option>";
    }).join("");
  }

  function sheetHtml() {
    if (!sheet) return "";
    var kinds = KINDS[sheet.section] || [];
    var rows = draft.map(function (field, index) {
      var extra = "";
      if (field.kind === "birthday") {
        extra = '<label class="about-check"><input type="checkbox" data-about-field="' + esc(field.id) + '" data-about-key="showYear"' + (field.showYear ? " checked" : "") + "> " + esc(tr("Show year")) + "</label>";
        extra += '<input data-about-field="' + esc(field.id) + '" data-about-key="tz" value="' + esc(field.tz || "") + '" placeholder="' + esc(tr("Time zone")) + '" aria-label="' + esc(tr("Time zone")) + '">';
      }
      if (field.kind === "family") {
        extra += '<input data-about-field="' + esc(field.id) + '" data-about-key="personHandle" value="' + esc(field.personHandle || "") + '" placeholder="' + esc(tr("Linked account")) + '" aria-label="' + esc(tr("Linked account")) + '">';
      }
      if (field.kind === "link" || field.kind === "website") {
        extra += '<input data-about-field="' + esc(field.id) + '" data-about-key="label" value="' + esc(field.label || "") + '" placeholder="' + esc(kindLabel(field.kind)) + '" aria-label="' + esc(kindLabel(field.kind)) + '">';
        extra += '<input data-about-field="' + esc(field.id) + '" data-about-key="url" value="' + esc(field.url || "") + '" placeholder="https://" aria-label="' + esc(tr("Website")) + '">';
      }
      return '<div class="about-edit-row"><label>' + esc(kindLabel(field.kind)) + '</label>' +
        '<textarea data-about-field="' + esc(field.id) + '" data-about-key="text" aria-label="' + esc(kindLabel(field.kind)) + '">' + esc(field.text || "") + "</textarea>" +
        extra +
        '<select data-about-field="' + esc(field.id) + '" data-about-key="audience" aria-label="' + esc(tr("Who can see this")) + '">' + audienceOptions(field.audience) + "</select>" +
        '<div class="about-edit-actions"><button type="button" data-about="up" data-index="' + index + '">' + esc(tr("Move up")) + '</button><button type="button" data-about="down" data-index="' + index + '">' + esc(tr("Move down")) + '</button><button type="button" data-about="drop" data-index="' + index + '">' + esc(tr("Delete")) + "</button></div></div>";
    }).join("");
    var add = kinds.map(function (kind) {
      return '<button type="button" data-about="add" data-kind="' + kind + '">' + esc(kindLabel(kind)) + "</button>";
    }).join("");
    return '<div class="about-sheet" role="dialog" aria-modal="true" aria-label="' + esc(editTitle(sheet.section)) + '"><div class="about-sheet-bar"><button type="button" data-about="close" aria-label="' + esc(tr("Close")) + '">×</button><h2>' + esc(editTitle(sheet.section)) + '</h2><button type="button" data-about="save">' + esc(tr("Save")) + '</button></div><div class="about-sheet-body">' + rows + '<div class="about-add">' + add + "</div>" + (errorText ? '<p class="about-error">' + esc(errorText) + "</p>" : "") + "</div></div>";
  }

  function privacyHtml(pack) {
    if (!privacyOpen) return "";
    var rows = allFields(pack).map(function (field) {
      return '<div class="about-privacy-row"><span>' + esc(kindLabel(field.kind)) + '</span><span>' + esc(field.text || "") + '</span><select data-about-field="' + esc(field.id) + '" data-about-key="audience" data-about-live="1" aria-label="' + esc(tr("Who can see this")) + '">' + audienceOptions(field.audience || "public") + "</select></div>";
    }).join("");
    var empty = '<p>' + esc(tr("No details yet")) + '</p>';
    var notes = '<button class="tab-switch' + (notesOn ? " on" : "") + '" type="button" role="switch" aria-checked="' + (notesOn ? "true" : "false") + '" data-about="notes"><span>' + esc(tr("Birthday notifications")) + "</span><i></i></button>";
    return '<div class="about-sheet" role="dialog" aria-label="' + esc(tr("About privacy")) + '"><div class="about-sheet-bar"><button type="button" data-about="close" aria-label="' + esc(tr("Close")) + '">×</button><h2>' + esc(tr("About privacy")) + '</h2><span></span></div><div class="about-sheet-body">' + notes + (rows || empty) + '</div></div>';
  }

  function findDraft(id) {
    for (var i = 0; i < draft.length; i++) if (draft[i].id === id) return draft[i];
    return null;
  }

  function rememberInput(el) {
    var id = el.getAttribute("data-about-field");
    var key = el.getAttribute("data-about-key");
    var field = findDraft(id);
    if (!field) return;
    if (key === "showYear") field.showYear = !!el.checked;
    else if (key === "audience") {
      var value = el.value || "public";
      if (value.indexOf("list:") === 0) {
        field.audience = "list";
        field.listId = value.slice(5);
      } else {
        field.audience = value;
        field.listId = "";
      }
    } else field[key] = el.value;
  }

  function membersFor(field) {
    if (field.audience !== "list" || !field.listId) return [];
    var found = null;
    lists().forEach(function (list) { if (list && list.id === field.listId) found = list; });
    var ids = [];
    ((found && found.members) || []).forEach(function (item) {
      var text = String(item || "");
      if (text.indexOf("app:") === 0) text = text.slice(4);
      if (/^\d{12}$/.test(text) && ids.indexOf(text) < 0) ids.push(text);
    });
    return ids;
  }

  function payload(field, index) {
    var audience = field.audience || "public";
    var body = {
      section: field.section,
      kind: field.kind,
      text: field.text || "",
      label: field.label || "",
      url: field.url || "",
      audience: audience,
      listId: field.listId || "",
      showYear: !!field.showYear,
      tz: field.tz || "",
      personHandle: field.personHandle || "",
      sort: index
    };
    if (audience === "list") body.members = membersFor(field);
    return body;
  }

  function saveSheet(account) {
    var auth = token();
    if (!auth) return;
    var jobs = [];
    var kept = {};
    draft.forEach(function (field, index) {
      var body = payload(field, index);
      if (String(field.id).indexOf("new-") === 0) {
        jobs.push(call("/v1/about", { method: "POST", token: auth, body: body }));
      } else {
        kept[field.id] = true;
        jobs.push(call("/v1/about/" + field.id, { method: "PATCH", token: auth, body: body }));
      }
    });
    fieldsOf(account.about, sheet.section).forEach(function (field) {
      if (!kept[field.id]) jobs.push(call("/v1/about/" + field.id, { method: "DELETE", token: auth }));
    });
    Promise.all(jobs).then(function (results) {
      var failed = results.some(function (res) { return !res || (res.status && res.status >= 400); });
      if (failed) {
        errorText = tr("Couldn’t save that detail.");
        redraw();
        return;
      }
      sheet = null;
      draft = [];
      account.aboutLoaded = false;
      ensure(account, "");
    }).catch(function () {
      errorText = tr("Couldn’t save that detail.");
      redraw();
    });
  }

  function onClick(event) {
    var el = event.target && event.target.closest ? event.target.closest("[data-about]") : null;
    if (!el) return false;
    event.preventDefault();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    var act = el.getAttribute("data-about");
    if (act === "close") {
      sheet = null;
      privacyOpen = false;
      errorText = "";
      redraw();
      return true;
    }
    if (act === "notes") {
      notesOn = !notesOn;
      call("/v1/about/birthday-notes", { method: "PUT", token: token(), body: { notes: notesOn } }).then(function () { redraw(); });
      redraw();
      return true;
    }
    if (act === "privacy") {
      privacyOpen = true;
      sheet = null;
      redraw();
      return true;
    }
    if (act === "edit") {
      var account = currentAccount();
      if (account) openSheet(account, el.getAttribute("data-section") || "personal");
      return true;
    }
    if (act === "add") {
      var kind = el.getAttribute("data-kind") || "interest";
      draft.push({
        id: "new-" + (seq++),
        section: sheet ? sheet.section : "personal",
        kind: kind,
        text: "",
        label: "",
        url: "",
        audience: SENSITIVE[kind] ? "only" : "public",
        showYear: false,
        tz: "",
        personHandle: "",
        listId: ""
      });
      redraw();
      return true;
    }
    if (act === "up" || act === "down") {
      var index = Number(el.getAttribute("data-index"));
      var next = act === "up" ? index - 1 : index + 1;
      if (next >= 0 && next < draft.length) {
        var swap = draft[index];
        draft[index] = draft[next];
        draft[next] = swap;
        redraw();
      }
      return true;
    }
    if (act === "drop") {
      draft.splice(Number(el.getAttribute("data-index")), 1);
      redraw();
      return true;
    }
    if (act === "save") {
      var saving = currentAccount();
      if (saving) saveSheet(saving);
      return true;
    }
    if (act === "as") {
      var viewing = currentAccount();
      if (!viewing) return true;
      viewing.aboutPreview = el.getAttribute("data-as") || "";
      viewing.aboutLoaded = false;
      sheet = null;
      ensure(viewing, viewing.aboutPreview);
      return true;
    }
    return false;
  }

  function currentAccount() {
    try {
      var session = root.ViktorychAccounts && root.ViktorychAccounts.account && root.ViktorychAccounts.account();
      if (!session) return null;
      if (root.ViktorychAccounts.storedAccount) {
        var stored = root.ViktorychAccounts.storedAccount(session.handle);
        if (stored) return stored;
      }
      return session;
    } catch (err) { return null; }
  }

  if (typeof document !== "undefined") {
    document.addEventListener("click", onClick, true);
    document.addEventListener("input", function (event) {
      var el = event.target;
      if (!el || !el.getAttribute || !el.getAttribute("data-about-field")) return;
      rememberInput(el);
    }, true);
    document.addEventListener("change", function (event) {
      var el = event.target;
      if (!el || !el.getAttribute || !el.getAttribute("data-about-field")) return;
      rememberInput(el);
      if (el.getAttribute("data-about-live") !== "1") return;
      var auth = token();
      if (!auth) return;
      var value = el.value || "public";
      var body = { audience: value.indexOf("list:") === 0 ? "list" : value, listId: value.indexOf("list:") === 0 ? value.slice(5) : "" };
      if (body.audience === "list") body.members = membersFor({ audience: "list", listId: body.listId });
      call("/v1/about/" + el.getAttribute("data-about-field"), { method: "PATCH", token: auth, body: body });
    }, true);
  }

  function loadUpcoming() {
    if (upcomingPack || !token()) return;
    upcomingPack = { upcoming: [], notes: notesOn, loading: true };
    call("/v1/about/upcoming", { token: token() }).then(function (body) {
      if (!body || body.status >= 400) {
        upcomingPack = { upcoming: [], notes: notesOn };
        return;
      }
      upcomingPack = body;
      if (body.notes != null) notesOn = !!body.notes;
      redraw();
    }).catch(function () { upcomingPack = { upcoming: [], notes: notesOn }; });
  }

  function upcomingHtml() {
    loadUpcoming();
    if (!upcomingPack || upcomingPack.loading) return "";
    var rows = (upcomingPack.upcoming || []).map(function (item) {
      var when = item.inDays === 0 ? tr("Today") : tr("In {n} days", { n: String(item.inDays) });
      var who = item.name || item.handle || "";
      return '<li><b>' + esc(who) + "</b><span>" + esc(when) + "</span></li>";
    }).join("");
    var list = rows ? '<ul class="about-upcoming-list">' + rows + "</ul>" : '<p>' + esc(tr("No upcoming birthdays")) + "</p>";
    var toggle = '<button class="tab-switch' + (notesOn ? " on" : "") + '" type="button" role="switch" aria-checked="' + (notesOn ? "true" : "false") + '" data-about="notes"><span>' + esc(tr("Birthday notifications")) + "</span><i></i></button>";
    return '<section class="about-upcoming"><h2>' + esc(tr("Upcoming birthdays")) + "</h2><p>" + esc(tr("Reminders stay on the server and skip anyone who cannot see the birthday.")) + "</p>" + toggle + list + "</section>";
  }

  root.ProfileAbout = {
    html: html,
    showTab: showTab,
    ensure: ensure,
    upcomingHtml: upcomingHtml,
    previewHtml: previewHtml,
    privacyHtml: privacyHtml,
    privacyOpen: function () { return privacyOpen; },
    lists: null
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
