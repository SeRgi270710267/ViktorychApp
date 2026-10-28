/* Soccer score pills. Scores come from the public ESPN scoreboard in the
   browser, then TheSportsDB's free tier for clubs that board does not list.
   The Worker is only the fallback when those browser calls fail.
   A pill is omitted when the match is finished past the keep window, still
   scheduled too far out, or the last fetch is older than its freshness window. */
(function (root) {
  "use strict";

  function tr(key, vars) {
    var fn = (typeof window !== "undefined" && window.t) ? window.t : ((typeof self !== "undefined" && self.t) ? self.t : null);
    return fn ? fn(key, vars) : key;
  }

  function notify(message) {
    if (typeof document === "undefined" || !document.getElementById) return;
    var el = document.getElementById("toast");
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
    if (notify._t) clearTimeout(notify._t);
    notify._t = setTimeout(function () { el.hidden = true; }, 1800);
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var STORAGE_OBS = "viktorychapp-sports-obs-v7";
  var PACE_MS = 1200;

  var CRESTS = {
    "arsenal-tula": '<svg class="sc-crest-svg" viewBox="0 0 32 32" fill="none"><path d="M16 2L4 7v10c0 7.5 5.5 13 12 15 6.5-2 12-7.5 12-15V7L16 2z" fill="#B81424"/><path d="M16 2L4 7v10c0 7.5 5.5 13 12 15V2z" fill="#870B18"/><path d="M16 5l8 3.5v7.5c0 5.5-4 9.5-8 11.2-4-1.7-8-5.7-8-11.2V8.5L16 5z" fill="#F5C400"/><path d="M16 7l6 2.6v5.8c0 4.2-3 7.3-6 8.6-3-1.3-6-4.4-6-8.6V9.6L16 7z" fill="#B81424"/><circle cx="16" cy="15" r="4.5" fill="#F5C400"/><rect x="15" y="11" width="2" height="8" fill="#870B18"/><rect x="12" y="14" width="8" height="2" fill="#870B18"/></svg>',
    "cska-moscow": '<svg class="sc-crest-svg" viewBox="0 0 32 32" fill="none"><path d="M16 2L5 6v10c0 7 5 12.5 11 14 6-1.5 11-7 11-14V6L16 2z" fill="#153E90"/><path d="M16 2L5 6v10c0 7 5 12.5 11 14V2z" fill="#091E4A"/><path d="M16 5l8 3v8c0 5-3.5 9-8 10.2-4.5-1.2-8-5.2-8-10.2V8l8-3z" fill="#C4122F"/><polygon points="16,8 18.2,12.5 23.2,13.2 19.6,16.7 20.5,21.7 16,19.3 11.5,21.7 12.4,16.7 8.8,13.2 13.8,12.5" fill="#F5C400"/><text x="16" y="27" font-size="5" font-weight="900" fill="#FFFFFF" text-anchor="middle" font-family="sans-serif">CSKA</text></svg>',
    "fc-barcelona": '<svg class="sc-crest-svg" viewBox="0 0 32 32" fill="none"><path d="M16 2C8 2 5 5 5 7v10c0 7.5 6 12 11 13 5-1 11-5.5 11-13V7c0-2-3-5-11-5z" fill="#EDBB00"/><path d="M16 4C9 4 7 6 7 8v8c0 6 5 9.5 9 10.5 4-1 9-4.5 9-10.5V8c0-2-2-4-9-4z" fill="#004D98"/><path d="M7 8h8v6H7z" fill="#FFFFFF"/><rect x="10" y="8" width="2" height="6" fill="#C4122F"/><rect x="7" y="10" width="8" height="2" fill="#C4122F"/><path d="M15 8h9v6h-9z" fill="#EDBB00"/><rect x="17" y="8" width="1.5" height="6" fill="#C4122F"/><rect x="20.5" y="8" width="1.5" height="6" fill="#C4122F"/><path d="M7 14h18v1H7z" fill="#EDBB00"/><path d="M7 15h18v3c0 4.5-3.5 7.5-9 8.5-5.5-1-9-4-9-8.5v-3z" fill="#004D98"/><rect x="9.5" y="15" width="2.5" height="7" fill="#A50044"/><rect x="14.7" y="15" width="2.5" height="7" fill="#A50044"/><rect x="20" y="15" width="2.5" height="7" fill="#A50044"/><circle cx="16" cy="19" r="2.8" fill="#EDBB00"/></svg>',
    "sabadell-ce": '<svg class="sc-crest-svg" viewBox="0 0 32 32" fill="none"><path d="M16 2L5 6v10c0 7.5 5.5 12.5 11 14 5.5-1.5 11-6.5 11-14V6L16 2z" fill="#FFFFFF"/><path d="M16 4L7 7.2v8.5c0 6 4.5 10 9 11.3 4.5-1.3 9-5.3 9-11.3V7.2L16 4z" fill="#0055A5"/><path d="M7 7.2L16 4v11H7V7.2z" fill="#FFFFFF"/><path d="M16 15v11.3c4.5-1.3 9-5.3 9-11.3H16z" fill="#FFFFFF"/><circle cx="16" cy="15" r="4.2" fill="#003666"/><circle cx="16" cy="15" r="3.2" fill="#FFFFFF"/><text x="16" y="17" font-size="4.2" font-weight="900" fill="#0055A5" text-anchor="middle" font-family="sans-serif">CES</text></svg>',
    "generic": '<svg class="sc-crest-svg" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="#333333"/><circle cx="16" cy="16" r="12" fill="#555555"/><circle cx="16" cy="16" r="6" fill="#FFFFFF"/></svg>'
  };

  function catalog() {
    return [
      { id: "arsenal-tula", nameKey: tr("Arsenal Tula"), short: "ARS", leagueKey: tr("Russian First League"), espnLeague: "", sportsDbId: "134553", names: ["arsenal tula"] },
      { id: "cska-moscow", nameKey: tr("CSKA Moscow"), short: "CSK", leagueKey: tr("Russian Premier League"), espnLeague: "rus.1", sportsDbId: "134120", names: ["cska moscow", "cska"] },
      { id: "fc-barcelona", nameKey: tr("FC Barcelona"), short: "BAR", leagueKey: tr("La Liga"), espnLeague: "esp.1", sportsDbId: "133739", names: ["fc barcelona", "barcelona"] },
      { id: "sabadell-ce", nameKey: tr("CE Sabadell"), short: "SAB", leagueKey: tr("Segunda Federación"), espnLeague: "esp.2", sportsDbId: "134704", names: ["ce sabadell", "sabadell"] }
    ];
  }

  function pillApi() {
    return root.PillData || (typeof globalThis !== "undefined" ? globalThis.PillData : null);
  }

  var obsState = null;
  var activeModalId = null;
  var refreshTimer = null;
  var fetching = false;

  function emptyObs() {
    return { kind: "sports", updatedAt: 0, live: false, matches: [] };
  }

  function loadObs() {
    if (obsState) return obsState;
    if (typeof localStorage !== "undefined") {
      try {
        var raw = localStorage.getItem(STORAGE_OBS);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.matches)) {
            obsState = parsed;
            return obsState;
          }
        }
      } catch (err) {}
    }
    obsState = emptyObs();
    return obsState;
  }

  function saveObs() {
    if (!obsState || typeof localStorage === "undefined") return;
    try { localStorage.setItem(STORAGE_OBS, JSON.stringify(obsState)); } catch (err) {}
  }

  function freshObs(now) {
    var api = pillApi();
    var obs = loadObs();
    if (!api || api.flagStale({ kind: "sports", live: !!obs.live, updatedAt: obs.updatedAt }, now).stale) return null;
    return obs;
  }

  function teamById(teamId) {
    var list = catalog();
    for (var i = 0; i < list.length; i++) if (list[i].id === teamId) return list[i];
    return null;
  }

  function visibleTeams(now) {
    var api = pillApi();
    var obs = freshObs(now);
    if (!api || !obs) return [];
    var out = [];
    catalog().forEach(function (team) {
      var match = api.pickPillMatch(obs.matches, team.names, now);
      if (!match) return;
      var leagueName = match.league || team.leagueKey;
      out.push({
        id: team.id,
        nameKey: team.nameKey,
        names: team.names,
        short: team.short,
        leagueKey: team.leagueKey,
        match: match,
        matches: api.leagueMatches(obs.matches, match.league || team.leagueKey, now),
        updatedAt: obs.updatedAt,
        leagueTitle: leagueName
      });
    });
    return out;
  }

  function getTeam(teamId) {
    var list = visibleTeams(Date.now());
    for (var i = 0; i < list.length; i++) if (list[i].id === teamId) return list[i];
    return null;
  }

  function getCrest(teamId) {
    return CRESTS[teamId] || CRESTS.generic;
  }

  function zone() {
    var api = pillApi();
    return api ? api.viewerZone() : "UTC";
  }

  function ageText(updatedAt) {
    var api = pillApi();
    if (!api) return "";
    var phrase = api.updatedPhrase(updatedAt, Date.now());
    return tr(phrase.key, { count: phrase.count });
  }

  function statusLabel(status) {
    if (status === "live") return tr("LIVE");
    if (status === "halftime") return tr("Halftime");
    if (status === "scheduled") return tr("Scheduled");
    return tr("Full Time");
  }

  function scoreText(match) {
    if (!match) return "";
    if (match.status === "scheduled" || match.homeScore == null || match.awayScore == null) {
      var api = pillApi();
      return api ? api.formatClock(match.kickoff, zone()) : "";
    }
    return String(match.homeScore) + " - " + String(match.awayScore);
  }

  function opponentName(team, match) {
    if (!match) return "";
    var home = String(match.home || "");
    var api = pillApi();
    var aliases = team.names && team.names.length ? team.names : [team.nameKey];
    if (api && api.nameHit(home, aliases)) return match.away;
    return home;
  }

  function marquee(text) {
    var safe = esc(text || "");
    return '<span class="sp-marquee" data-sp-marquee><span class="sp-marquee-clip"><span class="sp-marquee-track"><span class="sp-marquee-copy"><span class="sp-marquee-text">' + safe + '</span></span><span class="sp-marquee-copy" aria-hidden="true"><span class="sp-marquee-text">' + safe + '</span></span></span></span></span>';
  }

  function renderPill(team) {
    if (!team || !team.match) return "";
    var api = pillApi();
    if (api && api.flagStale({ kind: "sports", live: team.match.status === "live" || team.match.status === "halftime", updatedAt: team.updatedAt }, Date.now()).stale) return "";
    var match = team.match;
    var live = match.status === "live" || match.status === "halftime";
    var badgeClass = match.status === "live" ? "is-live" : (match.status === "scheduled" ? "is-sched" : "is-ft");
    var minute = "";
    if (match.status === "live" && match.minute) minute = " " + match.minute;
    var badgeHtml = '<span class="sc-badge ' + badgeClass + '">' + (match.status === "live" ? '<span class="sc-dot-live"></span>' : "") + esc(statusLabel(match.status)) + esc(minute) + "</span>";
    var scoreLine = scoreText(match);
    var isPinned = !!(root.WeatherPills && root.WeatherPills.isPinned && root.WeatherPills.isPinned("soccer:" + team.id));
    var pinBadge = isPinned ? '<span class="pill-pin-mark" title="' + esc(tr("Pinned")) + '">📌</span>' : "";
    var age = ageText(team.updatedAt);
    return '<button class="sc-pill sc-pill-' + esc(team.id) + '" type="button" data-sc-team="' + esc(team.id) + '" data-updated="' + esc(team.updatedAt) + '" aria-label="' + esc(team.nameKey + " " + statusLabel(match.status) + " " + scoreLine + " " + age) + '">'
      + '<span class="sc-crest-ring">' + getCrest(team.id) + "</span>"
      + '<span class="sc-pill-content">'
      + '<span class="sc-pill-top">' + badgeHtml + '<span class="sc-pill-title">' + marquee(team.nameKey) + "</span>" + pinBadge + "</span>"
      + '<span class="sc-pill-bottom"><span class="sc-pill-score">' + esc(scoreLine) + '</span><span class="sc-pill-opp">vs ' + marquee(opponentName(team, match)) + "</span></span>"
      + "</span>"
      + '<span class="pill-age">' + esc(age) + "</span>"
      + '<span class="sc-pill-arrow"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg></span>'
      + "</button>";
  }

  function pillsHtml() {
    if (root.WeatherPills && root.WeatherPills.isTypeDisabled && root.WeatherPills.isTypeDisabled("soccer")) return "";
    return visibleTeams(Date.now()).map(function (team) {
      var id = "soccer:" + team.id;
      if (root.WeatherPills && root.WeatherPills.isHidden && root.WeatherPills.isHidden(id)) return "";
      var html = renderPill(team);
      if (!html) return "";
      return '<div class="sp-row-item" role="listitem">' + html + "</div>";
    }).join("");
  }

  function homeRow() {
    if (root.WeatherPills && root.WeatherPills.homeRow) return root.WeatherPills.homeRow();
    var spacePills = (root.Spaces && root.Spaces.homePillsHtml) ? root.Spaces.homePillsHtml() : "";
    var soccerPills = pillsHtml();
    if (!spacePills && !soccerPills) return "";
    return '<div class="sp-row-wrap" role="region" aria-label="' + esc(tr("Live")) + '"><div class="sp-row" role="list">' + spacePills + soccerPills + "</div></div>";
  }

  function rowExtra() {
    return visibleTeams(Date.now()).length ? 46 : 0;
  }

  function renderModalHtml(teamId) {
    var team = getTeam(teamId);
    if (!team) return "";
    var match = team.match;
    var isPinned = !!(root.WeatherPills && root.WeatherPills.isPinned && root.WeatherPills.isPinned("soccer:" + team.id));
    var rows = (team.matches && team.matches.length ? team.matches : [match]).map(function (row) {
      var when = "";
      var api = pillApi();
      if (api && row.kickoff) when = api.civilDay(row.kickoff, zone()) + " " + api.formatClock(row.kickoff, zone());
      var line = row.status === "scheduled" ? esc(tr("Kickoff")) + " " + esc(when) : esc(scoreText(row));
      var minute = row.status === "live" && row.minute ? " " + esc(row.minute) : "";
      return '<div class="sc-event-row"><span class="sc-event-minute">' + esc(statusLabel(row.status)) + minute + '</span><span class="sc-event-desc">' + esc(row.home) + " " + line + " " + esc(row.away) + '</span><span class="sc-event-team">' + esc(when) + "</span></div>";
    }).join("");
    return '<div class="sc-modal-overlay is-open" data-sc-act="close-overlay">'
      + '<div class="sc-modal-dialog" role="dialog" aria-modal="true" aria-label="' + esc(tr("Match Details")) + '">'
      + '<div class="sc-modal-head"><div class="sc-modal-title-wrap"><span class="sc-modal-league">' + esc(team.leagueTitle || team.leagueKey) + '</span><span class="sc-modal-venue">' + esc(match.venue || "") + "</span></div>"
      + '<button class="sc-close-btn" type="button" data-sc-act="close" aria-label="' + esc(tr("Close")) + '"><svg viewBox="0 0 24 24"><path d="M18.3 5.71a.996.996 0 0 0-1.41 0L12 10.59 7.11 5.7A.996.996 0 1 0 5.7 7.11L10.59 12 5.7 16.89a.996.996 0 1 0 1.41 1.41L12 13.41l4.89 4.89a.996.996 0 1 0 1.41-1.41L13.41 12l4.89-4.89c.38-.38.38-1.02 0-1.4z"/></svg></button></div>'
      + '<div class="sc-hero sc-hero-' + esc(team.id) + '"><div class="sc-hero-board">'
      + '<div class="sc-team-side"><div class="sc-team-crest-large">' + getCrest(team.id) + '</div><span class="sc-team-name">' + esc(match.home) + "</span></div>"
      + '<div class="sc-score-center"><span class="sc-score-digits">' + esc(scoreText(match)) + '</span><span class="sc-hero-clock">' + esc(statusLabel(match.status)) + (match.status === "live" && match.minute ? " " + esc(match.minute) : "") + "</span>"
      + '<span class="pill-age">' + esc(ageText(team.updatedAt)) + "</span></div>"
      + '<div class="sc-team-side"><div class="sc-team-crest-large">' + getCrest("generic") + '</div><span class="sc-team-name">' + esc(match.away) + "</span></div>"
      + "</div></div>"
      + '<div class="sc-toolbar"><div class="sc-btn-group"><button class="sc-action-btn' + (isPinned ? " is-toggle-active" : "") + '" type="button" data-sc-act="toggle-pin" data-sc-id="' + esc(team.id) + '"><span>' + (isPinned ? "📌 " + esc(tr("Pinned")) : "📌 " + esc(tr("Pin Match"))) + "</span></button></div></div>"
      + '<div class="sc-body"><section><h3 class="sc-section-title">' + esc(tr("League matches")) + "</h3><div class=\"sc-timeline\">" + rows + "</div></section></div>"
      + "</div></div>";
  }

  function openModal(teamId) {
    activeModalId = teamId;
    if (typeof document === "undefined") return;
    var container = document.getElementById("soccer-sheet");
    if (!container) {
      container = document.createElement("div");
      container.id = "soccer-sheet";
      document.body.appendChild(container);
    }
    container.hidden = false;
    container.innerHTML = renderModalHtml(teamId);
  }

  function closeModal() {
    activeModalId = null;
    if (typeof document === "undefined") return;
    var container = document.getElementById("soccer-sheet");
    if (container) {
      container.hidden = true;
      container.innerHTML = "";
    }
  }

  function cleanDuplicateRows() {
    if (typeof document === "undefined") return;
    var rows = document.querySelectorAll(".sp-row-wrap");
    if (rows && rows.length > 1) {
      for (var i = 1; i < rows.length; i++) rows[i].remove();
    }
  }

  function refreshUI() {
    if (typeof document === "undefined") return;
    if (root.WeatherPills && root.WeatherPills.refreshUI) {
      root.WeatherPills.refreshUI();
      if (activeModalId) {
        var container = document.getElementById("soccer-sheet");
        if (container && !container.hidden) container.innerHTML = renderModalHtml(activeModalId);
      }
      return;
    }
    if (root.ViktorychHScroll && root.ViktorychHScroll.remember) root.ViktorychHScroll.remember();
    var rowEl = document.querySelector(".sp-row");
    if (rowEl) rowEl.innerHTML = pillsHtml();
    cleanDuplicateRows();
    if (root.Spaces && root.Spaces.refreshMarquees) root.Spaces.refreshMarquees();
  }

  function fetchJson(url) {
    return fetch(url, { method: "GET", credentials: "omit", cache: "no-store", redirect: "follow" }).then(function (res) {
      if (!res.ok) throw new Error("status");
      return res.json();
    });
  }

  function unwrap(json) {
    if (json && json.payload && typeof json.payload === "object") return json.payload;
    return json;
  }

  function fetchEspn(league, dates) {
    var api = pillApi();
    var url = api.espnUrl(league, dates);
    function parse(json) {
      var at = Number(json && json.fetchedAt) || Date.now();
      return api.parseEspnScoreboard(unwrap(json), at).matches;
    }
    return fetchJson(url).then(parse).catch(function () {
      var base = api.apiBase(root);
      if (!base) return null;
      return fetchJson(base + "/v1/pills/sports?provider=espn&league=" + encodeURIComponent(league) + "&dates=" + encodeURIComponent(dates)).then(parse).catch(function () { return null; });
    });
  }

  function fetchSportsDb(team) {
    var api = pillApi();
    function parse(json) {
      var at = Number(json && json.fetchedAt) || Date.now();
      return api.parseSportsDb(unwrap(json), at).matches;
    }
    function one(kind) {
      var url = api.sportsDbUrl(team.sportsDbId, kind);
      return fetchJson(url).then(parse).catch(function () {
        var base = api.apiBase(root);
        if (!base) return null;
        return fetchJson(base + "/v1/pills/sports?provider=sportsdb&team=" + encodeURIComponent(team.sportsDbId) + "&kind=" + kind).then(parse).catch(function () { return null; });
      });
    }
    return one("next").then(function (nextRows) {
      return one("last").then(function (lastRows) {
        if (!nextRows && !lastRows) return null;
        return api.dedupeMatches([nextRows || [], lastRows || []]);
      });
    });
  }

  function pace(items, fn) {
    var chain = Promise.resolve();
    items.forEach(function (item, index) {
      chain = chain.then(function () {
        return fn(item).then(function () {
          if (index >= items.length - 1) return null;
          return new Promise(function (resolve) { setTimeout(resolve, PACE_MS); });
        });
      });
    });
    return chain;
  }

  function arm(obs) {
    if (refreshTimer) clearTimeout(refreshTimer);
    var wait = obs && obs.live ? 45000 : 10 * 60 * 1000;
    if (typeof setTimeout !== "function") return;
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      refreshScores();
    }, wait);
  }

  function refreshScores() {
    var api = pillApi();
    if (!api || fetching || typeof fetch !== "function") return Promise.resolve(false);
    if (root.WeatherPills && root.WeatherPills.isTypeDisabled && root.WeatherPills.isTypeDisabled("soccer")) return Promise.resolve(false);
    fetching = true;
    var now = Date.now();
    var dates = api.espnDates(now, api.viewerZone());
    var leagues = [];
    catalog().forEach(function (team) {
      if (team.espnLeague && leagues.indexOf(team.espnLeague) < 0) leagues.push(team.espnLeague);
    });
    var failed = 0;
    return Promise.all(leagues.map(function (league) {
      return fetchEspn(league, dates).then(function (rows) {
        if (!rows) failed += 1;
        return rows || [];
      });
    })).then(function (lists) {
      var matches = api.dedupeMatches(lists);
      var missing = catalog().filter(function (team) {
        return team.sportsDbId && !api.pickPillMatch(matches, team.names, Date.now());
      });
      if (!missing.length) return { matches: matches, failed: failed, leagues: leagues.length };
      return pace(missing, function (team) {
        return fetchSportsDb(team).then(function (rows) {
          if (!rows) failed += 1;
          else matches = api.dedupeMatches([matches, rows]);
        });
      }).then(function () {
        return { matches: matches, failed: failed, leagues: leagues.length };
      });
    }).then(function (result) {
      fetching = false;
      var sources = result.leagues + catalog().filter(function (team) { return team.sportsDbId && !api.pickPillMatch(result.matches, team.names, Date.now()); }).length;
      if (result.failed && result.failed >= result.leagues && !result.matches.length) {
        if (!freshObs(Date.now())) refreshUI();
        return false;
      }
      var bundle = api.bundleSports(result.matches, Date.now());
      obsState = bundle;
      saveObs();
      refreshUI();
      arm(bundle);
      return true;
    }).catch(function () {
      fetching = false;
      if (!freshObs(Date.now())) refreshUI();
      return false;
    });
  }

  function applyBundle(bundle) {
    obsState = bundle || emptyObs();
    saveObs();
    return obsState;
  }

  var dragSession = null;

  if (typeof document !== "undefined") {
    document.addEventListener("wheel", function (event) {
      var target = event.target;
      var row = target && target.closest && target.closest(".sp-row");
      if (!row) return;
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && row.scrollWidth > row.clientWidth) {
        var canScrollRight = event.deltaY > 0 && (row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
        var canScrollLeft = event.deltaY < 0 && row.scrollLeft > 1;
        if (canScrollRight || canScrollLeft) {
          row.scrollLeft += event.deltaY;
          event.preventDefault();
        }
      }
    }, { passive: false });

    document.addEventListener("pointerdown", function (event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      var target = event.target;
      var row = target && target.closest && target.closest(".sp-row");
      if (!row) return;
      dragSession = { row: row, startX: event.clientX, startY: event.clientY, scrollStart: row.scrollLeft, hasDragged: false };
    });

    document.addEventListener("pointermove", function (event) {
      if (!dragSession) return;
      var dx = event.clientX - dragSession.startX;
      var dy = event.clientY - dragSession.startY;
      if (!dragSession.hasDragged && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) {
        dragSession = null;
        return;
      }
      if (Math.abs(dx) > 4) {
        dragSession.hasDragged = true;
        dragSession.row.scrollLeft = dragSession.scrollStart - dx;
        dragSession.row.classList.add("is-dragging");
      }
    });

    function endDrag() {
      if (!dragSession) return;
      var wasDragged = dragSession.hasDragged;
      dragSession.row.classList.remove("is-dragging");
      dragSession = null;
      if (wasDragged) {
        var suppressClick = function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          window.removeEventListener("click", suppressClick, true);
        };
        window.addEventListener("click", suppressClick, true);
        setTimeout(function () { window.removeEventListener("click", suppressClick, true); }, 120);
      }
    }

    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);

    document.addEventListener("click", function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var pillBtn = target.closest("[data-sc-team]");
      if (pillBtn) {
        event.preventDefault();
        openModal(pillBtn.getAttribute("data-sc-team"));
        return;
      }
      var actBtn = target.closest("[data-sc-act]");
      if (!actBtn) return;
      event.preventDefault();
      var act = actBtn.getAttribute("data-sc-act");
      var id = actBtn.getAttribute("data-sc-id");
      if (act === "close" || (act === "close-overlay" && event.target === actBtn)) closeModal();
      else if (act === "toggle-pin" && root.WeatherPills && root.WeatherPills.togglePin) {
        root.WeatherPills.togglePin("soccer:" + id);
        refreshUI();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && activeModalId) closeModal();
    });
  }

  function afterRender() {
    cleanDuplicateRows();
    if (root.WeatherPills && root.WeatherPills.isTypeDisabled && root.WeatherPills.isTypeDisabled("soccer")) return;
    var obs = freshObs(Date.now());
    if (obs) {
      arm(obs);
      return;
    }
    refreshScores();
  }

  var api = {
    pillsHtml: pillsHtml,
    homeRow: homeRow,
    rowExtra: rowExtra,
    afterRender: afterRender,
    openModal: openModal,
    closeModal: closeModal,
    loadTeams: function () { return visibleTeams(Date.now()); },
    getTeam: getTeam,
    renderPill: renderPill,
    refreshScores: refreshScores
  };

  root.SoccerScores = api;
  root.SoccerScoresLogic = {
    loadTeams: api.loadTeams,
    getTeam: getTeam,
    pillsHtml: pillsHtml,
    renderPill: renderPill,
    homeRow: homeRow,
    rowExtra: rowExtra,
    catalog: catalog,
    applyBundle: applyBundle,
    freshObs: freshObs,
    visibleTeams: visibleTeams
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
