/* Shared column splitter.
   Messages uses it for the inbox list. The main sidebar can use the same
   helper: FeedsSplit.bind(separator, { id, cssVar, fallback, min, maxRatio, pane }).
   Saved widths are one map in localStorage. The live size is a CSS variable
   on the document element, so a pane can paint at the saved width. */
(function (root) {
  var STORE = "rss-feeds-splits-v1";
  var panes = [];
  var bound = [];
  var resizeListening = false;

  function storedMap() {
    try {
      var raw = JSON.parse(root.localStorage.getItem(STORE) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch (err) {
      return {};
    }
  }

  function read(id) {
    var n = Math.round(Number(storedMap()[id]));
    return isFinite(n) && n > 0 ? n : 0;
  }

  function write(id, value) {
    var all = storedMap();
    all[id] = Math.round(value);
    try { root.localStorage.setItem(STORE, JSON.stringify(all)); } catch (err) { /* private mode */ }
  }

  function clear(id) {
    var all = storedMap();
    delete all[id];
    try { root.localStorage.setItem(STORE, JSON.stringify(all)); } catch (err) { /* private mode */ }
  }

  function clamp(value, min, max) {
    var n = Math.round(Number(value));
    if (!isFinite(n)) n = min;
    if (n < min) n = min;
    if (max && n > max) n = max;
    return n;
  }

  function desktopArea() {
    var w = root.innerWidth || 1280;
    if (w < 700) return w;
    var nav = w >= 1280 ? 275 : 88;
    return Math.max(320, Math.min(w, 1750) - nav);
  }

  function areaOf(spec, pane) {
    if (pane && pane.clientWidth >= 320) return pane.clientWidth;
    if (spec.area) return spec.area();
    return desktopArea();
  }

  function limits(spec, pane) {
    var min = spec.min || 300;
    var max = Math.round(areaOf(spec, pane) * (spec.maxRatio || 0.6));
    if (max < min) max = min;
    return { min: min, max: max };
  }

  function paint(spec, px) {
    if (!root.document || !root.document.documentElement) return;
    root.document.documentElement.style.setProperty(spec.cssVar, Math.round(px) + "px");
  }

  function apply(spec, pane, value) {
    var box = limits(spec, pane);
    var source = value == null ? (read(spec.id) || spec.fallback) : value;
    var n = clamp(source, box.min, box.max);
    paint(spec, n);
    return n;
  }

  function syncAria(el, spec, pane, n) {
    var box = limits(spec, pane);
    el.setAttribute("aria-valuemin", String(box.min));
    el.setAttribute("aria-valuemax", String(box.max));
    el.setAttribute("aria-valuenow", String(n));
  }

  function onResize() {
    bound.forEach(function (item) {
      if (!item.el.isConnected || item.dragging) return;
      var saved = read(item.spec.id) || item.spec.fallback;
      var n = apply(item.spec, item.pane, saved);
      syncAria(item.el, item.spec, item.pane, n);
    });
  }

  function bind(el, spec, pane) {
    if (!el || !spec || el.getAttribute("data-split-bound") === "1") return;
    el.setAttribute("data-split-bound", "1");
    var host = pane || el.parentElement;
    var item = { el: el, spec: spec, pane: host, dragging: false };
    var frame = 0;
    var pending = 0;
    function commit(value, persist) {
      var n = apply(spec, host, value);
      syncAria(el, spec, host, n);
      if (persist) {
        if (n === spec.fallback) clear(spec.id);
        else write(spec.id, n);
      }
      return n;
    }
    commit(read(spec.id) || spec.fallback, false);
    el.addEventListener("pointerdown", function (event) {
      if (event.button != null && event.button !== 0) return;
      item.dragging = true;
      el.classList.add("is-dragging");
      if (root.document.documentElement) root.document.documentElement.classList.add("is-split-drag");
      if (el.setPointerCapture) {
        try { el.setPointerCapture(event.pointerId); } catch (err) { /* already released */ }
      }
      event.preventDefault();
    });
    el.addEventListener("pointermove", function (event) {
      if (!item.dragging) return;
      var left = host.getBoundingClientRect().left;
      pending = event.clientX - left;
      if (frame) return;
      frame = root.requestAnimationFrame(function () {
        frame = 0;
        if (!item.dragging) return;
        commit(pending, false);
      });
    });
    function finish(event) {
      if (!item.dragging) return;
      item.dragging = false;
      el.classList.remove("is-dragging");
      if (root.document.documentElement) root.document.documentElement.classList.remove("is-split-drag");
      if (frame) {
        root.cancelAnimationFrame(frame);
        frame = 0;
      }
      var left = host.getBoundingClientRect().left;
      var x = event && isFinite(event.clientX) ? event.clientX - left : pending;
      commit(x, true);
    }
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", finish);
    el.addEventListener("dblclick", function (event) {
      event.preventDefault();
      clear(spec.id);
      commit(spec.fallback, false);
    });
    el.addEventListener("keydown", function (event) {
      var box = limits(spec, host);
      var current = parseFloat(el.getAttribute("aria-valuenow"));
      if (!isFinite(current)) current = spec.fallback;
      var step = event.shiftKey ? 48 : 16;
      var next = null;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = current - step;
      else if (event.key === "ArrowRight" || event.key === "ArrowDown") next = current + step;
      else if (event.key === "Home") next = box.min;
      else if (event.key === "End") next = box.max;
      else return;
      event.preventDefault();
      commit(next, true);
    });
    bound.push(item);
    if (!resizeListening) {
      resizeListening = true;
      root.addEventListener("resize", onResize);
    }
  }

  function register(spec) {
    panes.push(spec);
    apply(spec, null, null);
    return spec;
  }

  var messages = register({
    id: "messages",
    cssVar: "--dmsgs-list",
    fallback: 440,
    min: 300,
    maxRatio: 0.6,
    area: desktopArea
  });

  root.FeedsSplit = {
    read: read,
    write: write,
    clear: clear,
    clamp: clamp,
    apply: apply,
    bind: bind,
    register: register,
    messages: messages
  };
})(typeof window !== "undefined" ? window : globalThis);
