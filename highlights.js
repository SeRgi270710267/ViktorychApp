/* Profile highlight covers. The viewer is the story viewer. */
(function (root) {
  "use strict";

  var deps = {};
  var packs = {};
  var sheet = null;

  function tr(key, vars) {
    var fn = root.t || (typeof window !== "undefined" && window.t);
    return fn ? fn(key, vars) : key;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function call(path, opts) {
    if (!deps.api) return Promise.resolve({ status: 503 });
    var auth = "";
    try { auth = deps.token ? deps.token() : ""; } catch (err) { auth = ""; }
    var next = opts || {};
    if (!next.token && auth) next.token = auth;
    return deps.api(path, next);
  }

  function redraw() {
    if (deps.render) deps.render();
  }

  function keyOf(account) {
    return String((account && account.handle) || "");
  }

  function ensure(account) {
    var handle = keyOf(account);
    if (!handle) return;
    var pack = packs[handle];
    if (pack && (pack.loading || pack.loaded)) return;
    packs[handle] = { loading: true, loaded: false, mine: false, highlights: [] };
    call("/v1/highlights?handle=" + encodeURIComponent(handle)).then(function (body) {
      if (!body || body.status !== 200) {
        packs[handle] = { loading: false, loaded: true, mine: false, highlights: [] };
        return;
      }
      packs[handle] = { loading: false, loaded: true, mine: !!body.mine, highlights: body.highlights || [] };
      redraw();
    }).catch(function () {
      packs[handle] = { loading: false, loaded: true, mine: false, highlights: [] };
    });
  }

  function cropStyle(crop) {
    crop = crop || {};
    var x = Number(crop.x) || 0;
    var y = Number(crop.y) || 0;
    var w = Number(crop.w) || 10000;
    var h = Number(crop.h) || 10000;
    var px = ((x + w / 2) / 100) + "%";
    var py = ((y + h / 2) / 100) + "%";
    return "object-position:" + px + " " + py + ";";
  }

  function row(account, mine) {
    if (!account) return "";
    ensure(account);
    var pack = packs[keyOf(account)];
    var owner = !!(mine || (pack && pack.mine));
    var items = (pack && pack.highlights) || [];
    if (!owner && !items.length) return "";
    var covers = items.map(function (item) {
      var img = item.cover ? '<img src="' + esc(item.cover) + '" alt="" style="' + cropStyle(item.crop) + '">' : '<span class="hl-fallback">' + esc((item.title || "?").slice(0, 1)) + "</span>";
      var edit = owner ? '<button type="button" class="hl-edit" data-hl="edit" data-id="' + esc(item.id) + '" aria-label="' + esc(tr("Edit highlight")) + '">✎</button>' : "";
      return '<div class="hl-card"><button type="button" class="hl-open" data-hl="open" data-id="' + esc(item.id) + '" aria-label="' + esc(item.title || tr("Highlight")) + '">' +
        '<span class="hl-ring">' + img + "</span></button>" + edit +
        '<span class="hl-title" title="' + esc(item.title || "") + '">' + esc(item.title || "") + "</span></div>";
    }).join("");
    var add = owner ? '<button type="button" class="hl-card hl-new" data-hl="new" data-handle="' + esc(account.handle || "") + '" aria-label="' + esc(tr("New highlight")) + '"><span class="hl-ring">+</span><span class="hl-title">' + esc(tr("New")) + "</span></button>" : "";
    return '<div class="hl-row" role="list" aria-label="' + esc(tr("Highlights")) + '">' + add + covers + "</div>";
  }

  function preview(pack) {
    var account = { handle: "user_a" };
    packs[account.handle] = { loading: false, loaded: true, mine: !!pack.mine, highlights: pack.highlights || [] };
    return row(account, !!pack.mine);
  }

  function localTiles() {
    var list = [];
    try { list = deps.localMedia ? deps.localMedia() || [] : []; } catch (err) { list = []; }
    return list;
  }

  function openSheet(mode, highlight) {
    sheet = { mode: mode, highlight: highlight || null, picked: [], title: highlight ? highlight.title : "", audience: (highlight && highlight.audience) || "public", crop: (highlight && highlight.crop) || { x: 0, y: 0, w: 10000, h: 10000 }, sources: [] };
    call("/v1/highlights/sources").then(function (body) {
      if (body && body.items) sheet.sources = body.items;
      paintSheet();
    });
    paintSheet();
  }

  function paintSheet() {
    var node = document.getElementById("stories");
    if (!node || !sheet) return;
    var tiles = (sheet.sources || []).map(function (item, index) {
      return '<button type="button" class="hl-tile" data-hl="pick" data-index="' + index + '"><b>' + esc(item.source) + "</b><span>" + esc(item.type || "") + (item.expired ? " · " + esc(tr("Expired")) : "") + "</span></button>";
    }).join("");
    var local = localTiles().map(function (item, index) {
      return '<button type="button" class="hl-tile" data-hl="pick-local" data-index="' + index + '"><b>' + esc(item.source) + "</b><span>" + esc(item.type || "") + "</span></button>";
    }).join("");
    var picked = (sheet.picked || []).map(function (item, index) {
      return '<span class="hl-picked">' + esc(item.label || item.source) + ' <button type="button" data-hl="drop" data-index="' + index + '">×</button></span>';
    }).join("");
    node.classList.add("note-open");
    node.hidden = false;
    document.documentElement.classList.add("stories-open");
    node.innerHTML = '<div class="note-sheet hl-sheet" role="dialog" aria-modal="true" aria-label="' + esc(tr("Highlights")) + '">' +
      '<div class="note-sheet-bar"><button type="button" data-hl="close" aria-label="' + esc(tr("Close")) + '">×</button><b>' + esc(sheet.mode === "edit" ? tr("Edit highlight") : tr("New highlight")) + '</b><button type="button" data-hl="save">' + esc(tr("Save")) + "</button></div>" +
      '<input class="hl-name" aria-label="' + esc(tr("Highlight title")) + '" placeholder="' + esc(tr("Highlight title")) + '" value="' + esc(sheet.title || "") + '">' +
      '<label>' + esc(tr("Who can see this")) + ' <select class="hl-audience">' +
      ["public", "followers", "friends", "only", "list"].map(function (id) {
        var label = id === "public" ? tr("Everyone") : id === "followers" ? tr("Followers") : id === "friends" ? tr("Mutuals") : id === "only" ? tr("Only me") : tr("Custom lists");
        return '<option value="' + id + '"' + (sheet.audience === id ? " selected" : "") + ">" + esc(label) + "</option>";
      }).join("") + "</select></label>" +
      (root.AudienceLists && root.AudienceLists.checksHtml ? root.AudienceLists.checksHtml(sheet.highlight && sheet.highlight.listIds) : "") +
      '<label>' + esc(tr("Cover crop")) + ' <input class="hl-crop" type="range" min="1000" max="10000" value="' + esc(String((sheet.crop && sheet.crop.w) || 10000)) + '"></label>' +
      '<label class="hl-file">' + esc(tr("Choose a photo or video")) + '<input class="hl-file-input" type="file" accept="image/*,video/*"></label>' +
      '<div class="hl-grid">' + tiles + local + "</div>" +
      '<div class="hl-picked-row">' + picked + "</div>" +
      (sheet.mode === "edit" ? '<button type="button" data-hl="delete">' + esc(tr("Delete highlight")) + "</button>" : "") +
      '<p class="story-miss" hidden>' + esc(tr("Couldn’t save that highlight.")) + "</p></div>";
    var file = node.querySelector(".hl-file-input");
    if (file) file.addEventListener("change", function () {
      var chosen = file.files && file.files[0];
      if (!chosen) return;
      sheet.picked.push({ source: "file", file: chosen, label: chosen.name || tr("Choose a photo or video") });
      paintSheet();
    });
    var name = node.querySelector(".hl-name");
    if (name) name.addEventListener("input", function () { sheet.title = name.value; });
  }

  function uploadFile(file) {
    var body = new FormData();
    body.append("file", file);
    return call("/v1/highlights/upload", { method: "POST", form: body });
  }

  function saveSheet() {
    if (!sheet) return;
    var node = document.getElementById("stories");
    var audience = node && node.querySelector(".hl-audience");
    var cropInput = node && node.querySelector(".hl-crop");
    var size = cropInput ? Number(cropInput.value) || 10000 : 10000;
    var crop = { x: Math.floor((10000 - size) / 2), y: Math.floor((10000 - size) / 2), w: size, h: size };
    var jobs = (sheet.picked || []).map(function (item) {
      if (item.source !== "file" && item.source !== "saved" && item.source !== "post") {
        return Promise.resolve({ source: item.source, id: item.id });
      }
      var file = item.file;
      if (!file && item.url && typeof fetch === "function") {
        return fetch(item.url).then(function (res) { return res.blob(); }).then(function (blob) {
          return uploadFile(new File([blob], "media", { type: blob.type || "application/octet-stream" }));
        }).then(function (body) {
          return body && body.id ? { source: "upload", id: body.id } : null;
        }).catch(function () { return null; });
      }
      if (!file) return Promise.resolve(null);
      return uploadFile(file).then(function (body) {
        return body && body.id ? { source: "upload", id: body.id } : null;
      });
    });
    Promise.all(jobs).then(function (items) {
      var clean = items.filter(Boolean);
      var listIds = root.AudienceLists && root.AudienceLists.selectedLists ? root.AudienceLists.selectedLists(node) : [];
      var payload = { title: sheet.title || "", audience: audience ? audience.value : "public", crop: crop, cover: 0, items: clean, listIds: listIds };
      var req = sheet.mode === "edit" && sheet.highlight
        ? call("/v1/highlights/" + sheet.highlight.id, { method: "PUT", body: { title: payload.title, audience: payload.audience, crop: crop, add: clean, listIds: listIds } })
        : call("/v1/highlights", { method: "POST", body: payload });
      return req.then(function (body) {
        if (!body || (body.status && body.status >= 400)) {
          var miss = node && node.querySelector(".story-miss");
          if (miss) miss.hidden = false;
          return;
        }
        sheet = null;
        packs = {};
        if (root.Stories && root.Stories.close) root.Stories.close();
        redraw();
      });
    });
  }

  function openHighlight(id) {
    call("/v1/highlights/" + id).then(function (body) {
      if (!body || body.status !== 200 || !body.items || !body.items.length) return;
      if (root.Stories && root.Stories.play) {
        root.Stories.play({
          id: "highlight:" + body.id,
          platform: "highlight",
          handle: body.handle || "",
          name: body.title || body.name || "",
          items: body.items.map(function (item) {
            return { id: item.id, type: item.type, url: item.url, date: new Date().toISOString(), vine: !!item.vine, caption: body.title || "" };
          })
        });
      }
    });
  }

  function onClick(event) {
    var el = event.target && event.target.closest ? event.target.closest("[data-hl]") : null;
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    var act = el.getAttribute("data-hl");
    if (act === "new") { openSheet("new", null); return; }
    if (act === "open") { openHighlight(el.getAttribute("data-id") || ""); return; }
    if (act === "edit") {
      openSheet("edit", { id: el.getAttribute("data-id") || "", title: "", audience: "public" });
      call("/v1/highlights/" + el.getAttribute("data-id")).then(function (body) {
        if (body && body.status === 200 && sheet) {
          sheet.highlight = body;
          sheet.title = body.title || "";
          sheet.audience = body.audience || "public";
          sheet.crop = body.crop || sheet.crop;
          paintSheet();
        }
      });
      return;
    }
    if (act === "close") {
      sheet = null;
      if (root.Stories && root.Stories.close) root.Stories.close();
      return;
    }
    if (act === "pick") {
      var source = (sheet.sources || [])[Number(el.getAttribute("data-index") || 0)];
      if (source) sheet.picked.push({ source: source.source, id: source.id, label: source.source });
      paintSheet();
      return;
    }
    if (act === "pick-local") {
      var local = localTiles()[Number(el.getAttribute("data-index") || 0)];
      if (local) sheet.picked.push({ source: local.source, url: local.url, label: local.source });
      paintSheet();
      return;
    }
    if (act === "drop") {
      sheet.picked.splice(Number(el.getAttribute("data-index") || 0), 1);
      paintSheet();
      return;
    }
    if (act === "save") { saveSheet(); return; }
    if (act === "delete") {
      var id = sheet && sheet.highlight && sheet.highlight.id;
      if (!id) return;
      call("/v1/highlights/" + id, { method: "DELETE" }).then(function () {
        sheet = null;
        packs = {};
        if (root.Stories && root.Stories.close) root.Stories.close();
        redraw();
      });
    }
  }

  if (typeof document !== "undefined") document.addEventListener("click", onClick, true);

  root.Highlights = {
    bind: function (next) { deps = next || {}; },
    row: row,
    preview: preview,
    ensure: ensure
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
