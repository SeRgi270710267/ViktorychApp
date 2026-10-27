/* On-device model worker. The page starts it only after a model task.
   Bundled tasks stay in this file via ondevice-ai.js. Optional weights
   load through transformers.js and stay in Cache Storage and OPFS. */
importScripts("./ondevice-ai.js");

self.onmessage = function (event) {
  var msg = event.data || {};
  var api = self.ViktorychOnDeviceAi;
  if (!api || typeof api.workerTask !== "function") {
    self.postMessage({ id: msg.id, ok: false, error: "failed" });
    return;
  }
  api.workerTask(msg.task, msg.payload || {}, { inline: true }).then(function (result) {
    self.postMessage({ id: msg.id, ok: true, result: result });
  }, function () {
    self.postMessage({ id: msg.id, ok: false, error: "failed" });
  });
};
