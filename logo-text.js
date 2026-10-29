/* Sidebar logo personalization. Each user picks the default wordmark, their
   own text set in the wordmark's style (Inter Black first letter, Inter
   Regular for the rest, currentColor), or no logo at all. The choice lives in
   that user's settings only: nobody else ever sees it. Text is cleaned here
   (control and bidi-override characters out, spaces collapsed, 20 characters
   at most) and always escaped, so it can never become HTML. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ViktorychLogoText = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var MAX = 20;
  var MODES = ["default", "text", "hidden"];
  // C0/C1 controls, zero-width space and bidi controls (ZWJ/ZWNJ stay for emoji and Indic/Persian text), BOM, line/paragraph separators.
  var CONTROL = /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200E\u200F\u2028-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g;

  function graphemes(text) {
    try {
      if (typeof Intl !== "undefined" && Intl.Segmenter) {
        var seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
        var out = [];
        var it = seg.segment(text)[Symbol.iterator]();
        for (var step = it.next(); !step.done; step = it.next()) out.push(step.value.segment);
        return out;
      }
    } catch (err) { /* older engines split by code point */ }
    return Array.from(text);
  }

  function clean(value) {
    var text = typeof value === "string" ? value : (value == null ? "" : String(value));
    if (text.normalize) text = text.normalize("NFC");
    text = text.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
    var parts = graphemes(text);
    if (parts.length > MAX) text = parts.slice(0, MAX).join("").trim();
    return text;
  }

  function length(value) { return graphemes(clean(value)).length; }

  /* Settings shape: { mode, text }. Custom text that cleans to nothing falls
     back to the default wordmark. */
  function normalize(value) {
    var raw = value && typeof value === "object" ? value : {};
    var mode = MODES.indexOf(raw.mode) >= 0 ? raw.mode : "default";
    var text = clean(raw.text);
    return { mode: mode, text: text };
  }
  function effective(value) {
    var pref = normalize(value);
    if (pref.mode === "text" && !pref.text) return { mode: "default", text: "" };
    return pref;
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  /* The wordmark lockup in text: the first letter heavy, the rest regular. */
  function html(value, cls) {
    var text = clean(value);
    if (!text) return "";
    var parts = graphemes(text);
    var head = parts[0];
    var rest = parts.slice(1).join("");
    var klass = "logo-text" + (cls ? " " + cls : "");
    // Long text steps down in size so 20 characters still fit the sidebar.
    var n = parts.length;
    var size = n <= 9 ? "l" : (n <= 13 ? "m" : "s");
    return '<span class="' + klass + '" data-size="' + size + '" dir="auto" translate="no"><span class="logo-text-a">' + esc(head) + "</span>" +
      (rest ? '<span class="logo-text-b">' + esc(rest) + "</span>" : "") + "</span>";
  }

  return { MAX: MAX, MODES: MODES, clean: clean, length: length, normalize: normalize, effective: effective, html: html, esc: esc };
});
