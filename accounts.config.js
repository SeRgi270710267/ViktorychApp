/* Published gate. The sync workflow rewrites the copy in the Pages artifact
   after /v1/health reports ready. This file stays closed.
   tiktokAudience is the one flag for TikTok and Shorts: "owner" shows them
   only to the owner, and only after the wall is on. "all" shows them to everyone.
   backupApi is an optional secondary API endpoint (e.g. Hugging Face Space,
   Deno Deploy, or Koyeb) used for seamless auto-failover if Cloudflare hits 429. */
(function () {
  var prior = window.VIKTORYCH_ACCOUNTS;
  if (prior && prior.gate === true && prior.api) {
    if (!prior.tiktokAudience) prior.tiktokAudience = "owner";
    return;
  }
  window.VIKTORYCH_ACCOUNTS = {
    api: "",
    backupApi: "",
    gate: false,
    turnstileSiteKey: "",
    tiktokAudience: "owner",
    emergencyHash: ""
  };
})();
