/* X-style range sliders everywhere: keeps --x-fill (the blue part of the
   track) in step with each slider's value. CSS in styles.css draws the
   4px track, the 16px blue thumb and the halo. Sliders set from code can
   call ViktorychRange.paint(el) after changing the value. */
(function (root) {
  var doc = root.document;
  if (!doc || root.ViktorychRange) return;

  function paint(el) {
    if (!el || el.type !== "range") return;
    var min = Number(el.min) || 0;
    var max = el.max === "" ? 100 : Number(el.max);
    var val = Number(el.value) || 0;
    var pct = max > min ? (val - min) / (max - min) * 100 : 0;
    pct = Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
    el.style.setProperty("--x-fill", pct + "%");
  }

  function paintAll(scope) {
    var list = (scope || doc).querySelectorAll ? (scope || doc).querySelectorAll('input[type="range"]') : [];
    for (var i = 0; i < list.length; i++) paint(list[i]);
  }

  doc.addEventListener("input", function (event) { paint(event.target); }, true);
  doc.addEventListener("change", function (event) { paint(event.target); }, true);

  /* Pages render by replacing HTML, so paint new sliders once per frame. */
  var queued = false;
  function queue() {
    if (queued) return;
    queued = true;
    (root.requestAnimationFrame || setTimeout)(function () { queued = false; paintAll(); });
  }
  function watch() {
    if (!doc.body || !root.MutationObserver) return;
    new root.MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType === 1 && (n.tagName === "INPUT" || (n.querySelector && n.querySelector('input[type="range"]')))) { queue(); return; }
        }
      }
    }).observe(doc.body, { childList: true, subtree: true });
    paintAll();
  }
  if (doc.body) watch();
  else doc.addEventListener("DOMContentLoaded", watch);

  root.ViktorychRange = { paint: paint, paintAll: paintAll };
})(typeof window !== "undefined" ? window : this);
