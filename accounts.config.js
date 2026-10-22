/* Published gate. The sync workflow rewrites the copy in the Pages artifact
   after /v1/health reports ready. This file stays closed. */
(function () {
  var prior = window.VIKTORYCH_ACCOUNTS;
  if (prior && prior.gate === true && prior.api) return;
  window.VIKTORYCH_ACCOUNTS = {
    api: "",
    gate: false,
    turnstileSiteKey: ""
  };
})();
