/* Soccer Live Scores pill row & match details sheet.
   Supports live match updates and latest finished results in X style.
   Featured clubs: Arsenal Tula, CSKA Moscow, FC Barcelona, CE Sabadell. */
(function (root) {
  "use strict";

  function tr(key, vars) {
    var fn = (typeof window !== "undefined" && window.t) ? window.t : ((typeof self !== "undefined" && self.t) ? self.t : null);
    return fn ? fn(key, vars) : key;
  }

  /* The #toast element is a DOM node, so window.toast is not a function here.
     Paint the toast directly instead of calling it. */
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

  var STORAGE_KEY = "viktorychapp-soccer-scores-v6";

  /* Inline SVG crests */
  var CRESTS = {
    "arsenal-tula": '<svg class="sc-crest-svg" viewBox="0 0 32 32" fill="none"><path d="M16 2L4 7v10c0 7.5 5.5 13 12 15 6.5-2 12-7.5 12-15V7L16 2z" fill="#B81424"/><path d="M16 2L4 7v10c0 7.5 5.5 13 12 15V2z" fill="#870B18"/><path d="M16 5l8 3.5v7.5c0 5.5-4 9.5-8 11.2-4-1.7-8-5.7-8-11.2V8.5L16 5z" fill="#F5C400"/><path d="M16 7l6 2.6v5.8c0 4.2-3 7.3-6 8.6-3-1.3-6-4.4-6-8.6V9.6L16 7z" fill="#B81424"/><circle cx="16" cy="15" r="4.5" fill="#F5C400"/><rect x="15" y="11" width="2" height="8" fill="#870B18"/><rect x="12" y="14" width="8" height="2" fill="#870B18"/></svg>',
    "cska-moscow": '<svg class="sc-crest-svg" viewBox="0 0 32 32" fill="none"><path d="M16 2L5 6v10c0 7 5 12.5 11 14 6-1.5 11-7 11-14V6L16 2z" fill="#153E90"/><path d="M16 2L5 6v10c0 7 5 12.5 11 14V2z" fill="#091E4A"/><path d="M16 5l8 3v8c0 5-3.5 9-8 10.2-4.5-1.2-8-5.2-8-10.2V8l8-3z" fill="#C4122F"/><polygon points="16,8 18.2,12.5 23.2,13.2 19.6,16.7 20.5,21.7 16,19.3 11.5,21.7 12.4,16.7 8.8,13.2 13.8,12.5" fill="#F5C400"/><text x="16" y="27" font-size="5" font-weight="900" fill="#FFFFFF" text-anchor="middle" font-family="sans-serif">CSKA</text></svg>',
    "fc-barcelona": '<svg class="sc-crest-svg" viewBox="0 0 32 32" fill="none"><path d="M16 2C8 2 5 5 5 7v10c0 7.5 6 12 11 13 5-1 11-5.5 11-13V7c0-2-3-5-11-5z" fill="#EDBB00"/><path d="M16 4C9 4 7 6 7 8v8c0 6 5 9.5 9 10.5 4-1 9-4.5 9-10.5V8c0-2-2-4-9-4z" fill="#004D98"/><path d="M7 8h8v6H7z" fill="#FFFFFF"/><rect x="10" y="8" width="2" height="6" fill="#C4122F"/><rect x="7" y="10" width="8" height="2" fill="#C4122F"/><path d="M15 8h9v6h-9z" fill="#EDBB00"/><rect x="17" y="8" width="1.5" height="6" fill="#C4122F"/><rect x="20.5" y="8" width="1.5" height="6" fill="#C4122F"/><path d="M7 14h18v1H7z" fill="#EDBB00"/><path d="M7 15h18v3c0 4.5-3.5 7.5-9 8.5-5.5-1-9-4-9-8.5v-3z" fill="#004D98"/><rect x="9.5" y="15" width="2.5" height="7" fill="#A50044"/><rect x="14.7" y="15" width="2.5" height="7" fill="#A50044"/><rect x="20" y="15" width="2.5" height="7" fill="#A50044"/><circle cx="16" cy="19" r="2.8" fill="#EDBB00"/></svg>',
    "sabadell-ce": '<svg class="sc-crest-svg" viewBox="0 0 32 32" fill="none"><path d="M16 2L5 6v10c0 7.5 5.5 12.5 11 14 5.5-1.5 11-6.5 11-14V6L16 2z" fill="#FFFFFF"/><path d="M16 4L7 7.2v8.5c0 6 4.5 10 9 11.3 4.5-1.3 9-5.3 9-11.3V7.2L16 4z" fill="#0055A5"/><path d="M7 7.2L16 4v11H7V7.2z" fill="#FFFFFF"/><path d="M16 15v11.3c4.5-1.3 9-5.3 9-11.3H16z" fill="#FFFFFF"/><circle cx="16" cy="15" r="4.2" fill="#003666"/><circle cx="16" cy="15" r="3.2" fill="#FFFFFF"/><text x="16" y="17" font-size="4.2" font-weight="900" fill="#0055A5" text-anchor="middle" font-family="sans-serif">CES</text></svg>',
    "generic": '<svg class="sc-crest-svg" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" fill="#333333"/><circle cx="16" cy="16" r="12" fill="#555555"/><circle cx="16" cy="16" r="6" fill="#FFFFFF"/></svg>'
  };

  /* Default Teams Data with Authentic Recent Matches (October 2026) */
  function getDefaultData() {
    return [
      {
        id: "arsenal-tula",
        nameKey: tr("Arsenal Tula"),
        short: "ARS",
        leagueKey: tr("Russian First League"),
        isLive: true,
        liveMatch: {
          minute: 71,
          homeKey: tr("Arsenal Tula"),
          awayKey: tr("Shinnik Yaroslavl"),
          homeScore: 1,
          awayScore: 1,
          venue: "Arsenal Stadium, Tula",
          events: [
            { minute: "32'", type: "goal", text: "Goal! V. Fedorov", teamKey: tr("Shinnik Yaroslavl") },
            { minute: "48'", type: "goal", text: "Goal! M. Turishchev", teamKey: tr("Arsenal Tula") }
          ],
          stats: {
            possession: [54, 46],
            shots: [12, 9],
            onTarget: [6, 4],
            corners: [5, 3],
            fouls: [8, 11]
          }
        },
        latestResult: {
          date: "Oct 26",
          homeKey: tr("Arsenal Tula"),
          awayKey: tr("Shinnik Yaroslavl"),
          homeScore: 1,
          awayScore: 1,
          venue: "Arsenal Stadium, Tula",
          events: [
            { minute: "32'", type: "goal", text: "Goal! V. Fedorov", teamKey: tr("Shinnik Yaroslavl") },
            { minute: "48'", type: "goal", text: "Goal! M. Turishchev", teamKey: tr("Arsenal Tula") }
          ],
          stats: {
            possession: [54, 46],
            shots: [12, 9],
            onTarget: [6, 4],
            corners: [5, 3],
            fouls: [8, 11]
          }
        }
      },
      {
        id: "cska-moscow",
        nameKey: tr("CSKA Moscow"),
        short: "CSK",
        leagueKey: tr("Russian Premier League"),
        isLive: false,
        liveMatch: {
          minute: 89,
          homeKey: tr("Dynamo Moscow"),
          awayKey: tr("CSKA Moscow"),
          homeScore: 1,
          awayScore: 2,
          venue: "VTB Arena, Moscow",
          events: [
            { minute: "17'", type: "goal", text: "Goal! A. Fayzullaev", teamKey: tr("CSKA Moscow") },
            { minute: "55'", type: "goal", text: "Goal! J. Carrascal", teamKey: tr("Dynamo Moscow") },
            { minute: "89'", type: "goal", text: "Goal! T. Musaev", teamKey: tr("CSKA Moscow") }
          ],
          stats: {
            possession: [48, 52],
            shots: [11, 14],
            onTarget: [5, 7],
            corners: [4, 6],
            fouls: [13, 15]
          }
        },
        latestResult: {
          date: "Oct 26",
          homeKey: tr("CSKA Moscow"),
          awayKey: tr("Fakel Voronezh"),
          homeScore: 0,
          awayScore: 0,
          venue: "VEB Arena, Moscow",
          events: [
            { minute: "66'", type: "card", text: "Red Card", teamKey: tr("Fakel Voronezh") }
          ],
          stats: {
            possession: [65, 35],
            shots: [17, 3],
            onTarget: [6, 1],
            corners: [9, 1],
            fouls: [10, 14]
          }
        }
      },
      {
        id: "fc-barcelona",
        nameKey: tr("FC Barcelona"),
        short: "BAR",
        leagueKey: tr("La Liga"),
        isLive: false,
        liveMatch: {
          minute: 84,
          homeKey: tr("Real Madrid"),
          awayKey: tr("FC Barcelona"),
          homeScore: 0,
          awayScore: 4,
          venue: "Santiago Bernabéu, Madrid",
          events: [
            { minute: "54'", type: "goal", text: "Goal! R. Lewandowski", teamKey: tr("FC Barcelona") },
            { minute: "56'", type: "goal", text: "Goal! R. Lewandowski", teamKey: tr("FC Barcelona") },
            { minute: "77'", type: "goal", text: "Goal! Lamine Yamal", teamKey: tr("FC Barcelona") },
            { minute: "84'", type: "goal", text: "Goal! Raphinha", teamKey: tr("FC Barcelona") }
          ],
          stats: {
            possession: [42, 58],
            shots: [9, 15],
            onTarget: [4, 7],
            corners: [10, 3],
            fouls: [15, 17]
          }
        },
        latestResult: {
          date: "Oct 26",
          homeKey: tr("Real Madrid"),
          awayKey: tr("FC Barcelona"),
          homeScore: 0,
          awayScore: 4,
          venue: "Santiago Bernabéu, Madrid",
          events: [
            { minute: "54'", type: "goal", text: "Goal! R. Lewandowski", teamKey: tr("FC Barcelona") },
            { minute: "56'", type: "goal", text: "Goal! R. Lewandowski", teamKey: tr("FC Barcelona") },
            { minute: "77'", type: "goal", text: "Goal! Lamine Yamal", teamKey: tr("FC Barcelona") },
            { minute: "84'", type: "goal", text: "Goal! Raphinha", teamKey: tr("FC Barcelona") }
          ],
          stats: {
            possession: [42, 58],
            shots: [9, 15],
            onTarget: [4, 7],
            corners: [10, 3],
            fouls: [15, 17]
          }
        }
      },
      {
        id: "sabadell-ce",
        nameKey: tr("CE Sabadell"),
        short: "SAB",
        leagueKey: tr("Segunda Federación"),
        isLive: false,
        liveMatch: {
          minute: 68,
          homeKey: tr("CE Sabadell"),
          awayKey: tr("Atlético Baleares"),
          homeScore: 3,
          awayScore: 1,
          venue: "Estadi Nova Creu Alta, Sabadell",
          events: [
            { minute: "14'", type: "goal", text: "Goal! Sergio Cortés", teamKey: tr("CE Sabadell") },
            { minute: "29'", type: "goal", text: "Goal! Javi Gómez", teamKey: tr("CE Sabadell") },
            { minute: "68'", type: "goal", text: "Goal! Miguelete", teamKey: tr("CE Sabadell") }
          ],
          stats: {
            possession: [55, 45],
            shots: [13, 7],
            onTarget: [7, 3],
            corners: [6, 4],
            fouls: [11, 12]
          }
        },
        latestResult: {
          date: "Oct 20",
          homeKey: tr("CE Sabadell"),
          awayKey: tr("Atlético Baleares"),
          homeScore: 3,
          awayScore: 2,
          venue: "Estadi Nova Creu Alta, Sabadell",
          events: [
            { minute: "14'", type: "goal", text: "Goal! Sergio Cortés", teamKey: tr("CE Sabadell") },
            { minute: "29'", type: "goal", text: "Goal! Javi Gómez", teamKey: tr("CE Sabadell") },
            { minute: "42'", type: "goal", text: "Goal! N. Marong", teamKey: tr("Atlético Baleares") },
            { minute: "68'", type: "goal", text: "Goal! Miguelete", teamKey: tr("CE Sabadell") },
            { minute: "83'", type: "goal", text: "Goal! J. Tovar", teamKey: tr("Atlético Baleares") }
          ],
          stats: {
            possession: [55, 45],
            shots: [14, 9],
            onTarget: [8, 5],
            corners: [6, 4],
            fouls: [12, 13]
          }
        }
      }
    ];
  }

  /* State handling */
  var teamsState = null;
  var autoTickTimer = null;
  var activeModalId = null;

  function loadTeams() {
    if (teamsState) return teamsState;
    if (typeof localStorage !== "undefined") {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length) {
            teamsState = parsed;
            return teamsState;
          }
        }
      } catch (err) {}
    }
    teamsState = getDefaultData();
    saveTeams();
    return teamsState;
  }

  function saveTeams() {
    if (!teamsState || typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(teamsState));
    } catch (err) {}
  }

  function getTeam(teamId) {
    var list = loadTeams();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === teamId) return list[i];
    }
    return null;
  }

  function getCrest(teamId) {
    return CRESTS[teamId] || CRESTS["generic"];
  }

  /* HTML Generators */
  function renderPill(team) {
    var isLive = !!team.isLive;
    var data = isLive ? team.liveMatch : team.latestResult;
    var homeScore = data ? data.homeScore : 0;
    var awayScore = data ? data.awayScore : 0;
    var opponentName = data ? (data.homeKey === team.nameKey ? data.awayKey : data.homeKey) : "";

    var badgeHtml = "";
    if (isLive) {
      var min = (data && data.minute) ? data.minute + "'" : "";
      badgeHtml = '<span class="sc-badge is-live"><span class="sc-dot-live"></span>' + esc(tr("LIVE")) + (min ? " " + esc(min) : "") + '</span>';
    } else {
      badgeHtml = '<span class="sc-badge is-ft">' + esc(tr("Full Time")) + '</span>';
    }

    var scoreLine = esc(homeScore) + " - " + esc(awayScore);
    var teamName = team.nameKey;
    var isPinned = !!(root.WeatherPills && root.WeatherPills.isPinned && root.WeatherPills.isPinned("soccer:" + team.id));
    var pinBadge = isPinned ? '<span class="pill-pin-mark" title="' + esc(tr("Pinned")) + '">📌</span>' : "";

    return '<button class="sc-pill sc-pill-' + esc(team.id) + '" type="button" data-sc-team="' + esc(team.id) + '" aria-label="' + esc(teamName) + " " + (isLive ? esc(tr("LIVE")) : esc(tr("Full Time"))) + " " + scoreLine + '">'
      + '<span class="sc-crest-ring">' + getCrest(team.id) + '</span>'
      + '<span class="sc-pill-content">'
      + '<span class="sc-pill-top">' + badgeHtml + '<span class="sc-pill-title">' + esc(teamName) + '</span>' + pinBadge + '</span>'
      + '<span class="sc-pill-bottom"><span class="sc-pill-score">' + scoreLine + '</span><span class="sc-pill-opp">vs ' + esc(opponentName) + '</span></span>'
      + '</span>'
      + '<span class="sc-pill-arrow"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg></span>'
      + '</button>';
  }

  /* Generate only the list items so they can sit in the exact same .sp-row as the purple Space pill */
  function pillsHtml() {
    if (root.WeatherPills && root.WeatherPills.isTypeDisabled && root.WeatherPills.isTypeDisabled("soccer")) return "";
    var list = loadTeams();
    if (!list.length) return "";
    return list.map(function (team) {
      var id = "soccer:" + team.id;
      if (root.WeatherPills && root.WeatherPills.isHidden && root.WeatherPills.isHidden(id)) return "";
      return '<div class="sp-row-item" role="listitem">' + renderPill(team) + '</div>';
    }).join("");
  }

  /* Unified pill row matching Spaces.homeRow */
  function homeRow() {
    if (root.WeatherPills && root.WeatherPills.homeRow) {
      return root.WeatherPills.homeRow();
    }
    var spacePills = (root.Spaces && root.Spaces.homePillsHtml) ? root.Spaces.homePillsHtml() : "";
    var soccerPills = pillsHtml();
    if (!spacePills && !soccerPills) return "";
    return '<div class="sp-row-wrap" role="region" aria-label="' + esc(tr("Live")) + '"><div class="sp-row" role="list">' + spacePills + soccerPills + '</div></div>';
  }

  function rowExtra() {
    return loadTeams().length ? 65 : 0;
  }

  /* Match Sheet Modal HTML */
  function renderModalHtml(teamId) {
    var team = getTeam(teamId);
    if (!team) return "";

    var isLive = !!team.isLive;
    var data = isLive ? team.liveMatch : team.latestResult;
    var isHome = data.homeKey === team.nameKey;

    var isPinned = !!(root.WeatherPills && root.WeatherPills.isPinned && root.WeatherPills.isPinned("soccer:" + team.id));

    var clockLabel = isLive
      ? '<span class="sc-hero-clock"><span class="sc-dot-live"></span> ' + esc(tr("LIVE")) + " " + esc(data.minute) + '\'</span>'
      : '<span class="sc-hero-clock">' + esc(tr("Full Time")) + " • " + esc(data.date || "FT") + '</span>';

    /* Events List */
    var eventsHtml = "";
    if (data.events && data.events.length) {
      eventsHtml = '<div class="sc-timeline">' + data.events.map(function (ev) {
        var icon = ev.type === "goal" ? "⚽" : (ev.type === "card" ? "🟨" : "⏱");
        return '<div class="sc-event-row">'
          + '<span class="sc-event-minute">' + esc(ev.minute) + '</span>'
          + '<span class="sc-event-icon">' + icon + '</span>'
          + '<span class="sc-event-desc">' + esc(ev.text) + '</span>'
          + '<span class="sc-event-team">' + esc(ev.teamKey || "") + '</span>'
          + '</div>';
      }).join("") + '</div>';
    }

    /* Stats List */
    var statsHtml = "";
    if (data.stats) {
      var s = data.stats;
      var statRows = [
        { label: tr("Possession"), h: s.possession[0] + "%", a: s.possession[1] + "%", pctH: s.possession[0], pctA: s.possession[1] },
        { label: tr("Shots"), h: s.shots[0], a: s.shots[1], pctH: (s.shots[0] / Math.max(1, s.shots[0] + s.shots[1])) * 100, pctA: (s.shots[1] / Math.max(1, s.shots[0] + s.shots[1])) * 100 },
        { label: tr("Shots on Target"), h: s.onTarget[0], a: s.onTarget[1], pctH: (s.onTarget[0] / Math.max(1, s.onTarget[0] + s.onTarget[1])) * 100, pctA: (s.onTarget[1] / Math.max(1, s.onTarget[0] + s.onTarget[1])) * 100 },
        { label: tr("Corner Kicks"), h: s.corners[0], a: s.corners[1], pctH: (s.corners[0] / Math.max(1, s.corners[0] + s.corners[1])) * 100, pctA: (s.corners[1] / Math.max(1, s.corners[0] + s.corners[1])) * 100 },
        { label: tr("Fouls"), h: s.fouls[0], a: s.fouls[1], pctH: (s.fouls[0] / Math.max(1, s.fouls[0] + s.fouls[1])) * 100, pctA: (s.fouls[1] / Math.max(1, s.fouls[0] + s.fouls[1])) * 100 }
      ];

      statsHtml = '<div class="sc-stats-list">' + statRows.map(function (row) {
        return '<div class="sc-stat-item">'
          + '<div class="sc-stat-labels"><span class="sc-stat-num">' + esc(row.h) + '</span><span class="sc-stat-name">' + esc(row.label) + '</span><span class="sc-stat-num">' + esc(row.a) + '</span></div>'
          + '<div class="sc-stat-bar-track"><div class="sc-stat-bar-home" style="width:' + row.pctH + '%"></div><div class="sc-stat-bar-away" style="width:' + row.pctA + '%"></div></div>'
          + '</div>';
      }).join("") + '</div>';
    }

    return '<div class="sc-modal-overlay is-open" data-sc-act="close-overlay">'
      + '<div class="sc-modal-dialog" role="dialog" aria-modal="true" aria-label="' + esc(tr("Match Details")) + '">'
      + '<div class="sc-modal-head">'
      + '<div class="sc-modal-title-wrap">'
      + '<span class="sc-modal-league">' + esc(team.leagueKey) + '</span>'
      + '<span class="sc-modal-venue">' + esc(data.venue) + '</span>'
      + '</div>'
      + '<button class="sc-close-btn" type="button" data-sc-act="close" aria-label="' + esc(tr("Close")) + '"><svg viewBox="0 0 24 24"><path d="M18.3 5.71a.996.996 0 0 0-1.41 0L12 10.59 7.11 5.7A.996.996 0 1 0 5.7 7.11L10.59 12 5.7 16.89a.996.996 0 1 0 1.41 1.41L12 13.41l4.89 4.89a.996.996 0 1 0 1.41-1.41L13.41 12l4.89-4.89c.38-.38.38-1.02 0-1.4z"/></svg></button>'
      + '</div>'
      + '<div class="sc-hero sc-hero-' + esc(team.id) + '">'
      + '<div class="sc-hero-board">'
      + '<div class="sc-team-side"><div class="sc-team-crest-large">' + (isHome ? getCrest(team.id) : getCrest("generic")) + '</div><span class="sc-team-name">' + esc(data.homeKey) + '</span></div>'
      + '<div class="sc-score-center">'
      + '<div class="sc-score-controls">'
      + '<button class="sc-score-step" type="button" data-sc-act="score-step" data-sc-id="' + esc(team.id) + '" data-sc-side="home" data-sc-delta="-1" aria-label="-">-</button>'
      + '<span class="sc-score-digits">' + esc(data.homeScore) + ' - ' + esc(data.awayScore) + '</span>'
      + '<button class="sc-score-step" type="button" data-sc-act="score-step" data-sc-id="' + esc(team.id) + '" data-sc-side="away" data-sc-delta="1" aria-label="+">+</button>'
      + '</div>'
      + clockLabel
      + '</div>'
      + '<div class="sc-team-side"><div class="sc-team-crest-large">' + (!isHome ? getCrest(team.id) : getCrest("generic")) + '</div><span class="sc-team-name">' + esc(data.awayKey) + '</span></div>'
      + '</div>'
      + '</div>'
      + '<div class="sc-toolbar">'
      + '<div class="sc-btn-group">'
      + '<button class="sc-action-btn' + (isPinned ? " is-toggle-active" : "") + '" type="button" data-sc-act="toggle-pin" data-sc-id="' + esc(team.id) + '"><span>' + (isPinned ? "📌 " + esc(tr("Pinned")) : "📌 " + esc(tr("Pin Match"))) + '</span></button>'
      + '<button class="sc-action-btn' + (isLive ? " is-toggle-active" : "") + '" type="button" data-sc-act="toggle-live" data-sc-id="' + esc(team.id) + '">' + (isLive ? '🔴 ' + esc(tr("LIVE")) : '🏁 ' + esc(tr("Latest Result"))) + '</button>'
      + (team.id === "fc-barcelona" ? '<a class="sc-action-btn is-toggle-active" href="#/tv" style="text-decoration:none"><span>📺 ' + esc(tr("Watch Live on TV")) + '</span></a>' : '')
      + '<button class="sc-action-btn" type="button" data-sc-act="update-score" data-sc-id="' + esc(team.id) + '"><svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg><span>' + esc(tr("Update Score")) + '</span></button>'
      + '</div>'
      + '<div class="sc-btn-group">'
      + '<button class="sc-action-btn" type="button" data-sc-act="sim-goal" data-sc-id="' + esc(team.id) + '"><span>⚽ + ' + esc(tr("Simulate Goal")) + '</span></button>'
      + '<button class="sc-action-btn" type="button" data-sc-act="reset" data-sc-id="' + esc(team.id) + '"><span>' + esc(tr("Reset Match")) + '</span></button>'
      + '</div>'
      + '</div>'
      + '<div class="sc-body">'
      + '<section><h3 class="sc-section-title">' + esc(tr("Match Timeline")) + '</h3>' + eventsHtml + '</section>'
      + '<section><h3 class="sc-section-title">' + esc(tr("Match Stats")) + '</h3>' + statsHtml + '</section>'
      + '</div>'
      + '</div>'
      + '</div>';
  }

  /* Modal Management */
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
      for (var i = 1; i < rows.length; i++) {
        rows[i].remove();
      }
    }
  }

  function refreshUI() {
    saveTeams();
    if (typeof document === "undefined") return;
    if (root.WeatherPills && root.WeatherPills.refreshUI) {
      root.WeatherPills.refreshUI();
      if (activeModalId) {
        var container = document.getElementById("soccer-sheet");
        if (container && !container.hidden) {
          container.innerHTML = renderModalHtml(activeModalId);
        }
      }
      return;
    }
    var rowEl = document.querySelector(".sp-row");
    if (rowEl) {
      var spaceItems = rowEl.querySelectorAll(".sp-row-item:not(:has([data-sc-team]))");
      var spacePills = "";
      if (spaceItems && spaceItems.length) {
        for (var i = 0; i < spaceItems.length; i++) {
          spacePills += spaceItems[i].outerHTML;
        }
      } else if (root.Spaces && root.Spaces.homePillsHtml) {
        spacePills = root.Spaces.homePillsHtml();
      }
      var soccerPills = pillsHtml();
      rowEl.innerHTML = spacePills + soccerPills;
    }
    cleanDuplicateRows();
    if (activeModalId) {
      var container = document.getElementById("soccer-sheet");
      if (container && !container.hidden) {
        container.innerHTML = renderModalHtml(activeModalId);
      }
    }
  }

  /* Live Updates & Actions */
  function toggleLive(teamId) {
    var team = getTeam(teamId);
    if (!team) return;
    team.isLive = !team.isLive;
    refreshUI();
  }

  function updateScore(teamId, deltaHome, deltaAway) {
    var team = getTeam(teamId);
    if (!team) return;
    var data = team.isLive ? team.liveMatch : team.latestResult;
    data.homeScore = Math.max(0, (data.homeScore || 0) + deltaHome);
    data.awayScore = Math.max(0, (data.awayScore || 0) + deltaAway);
    if (team.isLive && data.minute < 90) {
      data.minute = Math.min(90, data.minute + 1);
    }
    refreshUI();
    notify(tr("Score updated"));
  }

  function simulateGoal(teamId) {
    var team = getTeam(teamId);
    if (!team) return;
    var data = team.isLive ? team.liveMatch : team.latestResult;
    var scoreHome = Math.random() > 0.35;
    if (scoreHome) {
      data.homeScore = (data.homeScore || 0) + 1;
    } else {
      data.awayScore = (data.awayScore || 0) + 1;
    }
    var scoringTeamKey = scoreHome ? data.homeKey : data.awayKey;
    var minuteStr = team.isLive ? Math.min(90, (data.minute || 60) + Math.floor(Math.random() * 4) + 1) + "'" : "88'";
    if (team.isLive) {
      data.minute = parseInt(minuteStr, 10);
    }
    if (!data.events) data.events = [];
    data.events.push({
      minute: minuteStr,
      type: "goal",
      text: "Goal! " + (scoreHome ? team.short + " Player" : "Opponent"),
      teamKey: scoringTeamKey
    });
    refreshUI();
    notify(tr("Score updated"));
  }

  function resetTeam(teamId) {
    var defaults = getDefaultData();
    var foundDefault = null;
    for (var i = 0; i < defaults.length; i++) {
      if (defaults[i].id === teamId) {
        foundDefault = defaults[i];
        break;
      }
    }
    if (!foundDefault) return;
    var list = loadTeams();
    for (var j = 0; j < list.length; j++) {
      if (list[j].id === teamId) {
        list[j] = foundDefault;
        break;
      }
    }
    refreshUI();
  }

  /* Auto Ticker for Live Games */
  function soccerOff() {
    return !!(root.WeatherPills && root.WeatherPills.isTypeDisabled && root.WeatherPills.isTypeDisabled("soccer"));
  }

  function stopAutoTicker() {
    if (autoTickTimer) {
      clearInterval(autoTickTimer);
      autoTickTimer = null;
    }
  }

  function startAutoTicker() {
    if (autoTickTimer || typeof window === "undefined") return;
    if (soccerOff()) return;
    autoTickTimer = setInterval(function () {
      if (soccerOff()) {
        stopAutoTicker();
        return;
      }
      var list = loadTeams();
      var changed = false;
      for (var i = 0; i < list.length; i++) {
        var team = list[i];
        if (team.isLive && team.liveMatch) {
          if (team.liveMatch.minute < 90) {
            team.liveMatch.minute += 1;
            changed = true;
          }
        }
      }
      if (changed) {
        refreshUI();
      }
    }, 25000);
  }

  /* Smooth horizontal scrolling: Wheel & Pointer Drag for .sp-row */
  var dragSession = null;

  if (typeof document !== "undefined") {
    // Wheel-to-horizontal conversion on the pill row without trapping vertical page scroll
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

    // Pointer drag-to-scroll with touch vertical pass-through
    document.addEventListener("pointerdown", function (event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      var target = event.target;
      var row = target && target.closest && target.closest(".sp-row");
      if (!row) return;

      dragSession = {
        row: row,
        startX: event.clientX,
        startY: event.clientY,
        scrollStart: row.scrollLeft,
        hasDragged: false
      };
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
        setTimeout(function () {
          window.removeEventListener("click", suppressClick, true);
        }, 120);
      }
    }

    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);

    /* Event Delegation for Pill Actions */
    document.addEventListener("click", function (event) {
      var target = event.target;
      if (!target) return;

      var pillBtn = target.closest("[data-sc-team]");
      if (pillBtn) {
        event.preventDefault();
        var teamId = pillBtn.getAttribute("data-sc-team");
        openModal(teamId);
        return;
      }

      var actBtn = target.closest("[data-sc-act]");
      if (actBtn) {
        event.preventDefault();
        var act = actBtn.getAttribute("data-sc-act");
        var id = actBtn.getAttribute("data-sc-id");
        if (act === "close") {
          closeModal();
        } else if (act === "close-overlay") {
          if (event.target === actBtn) closeModal();
        } else if (act === "toggle-pin") {
          if (root.WeatherPills && root.WeatherPills.togglePin) {
            root.WeatherPills.togglePin("soccer:" + id);
            refreshUI();
          }
        } else if (act === "toggle-live") {
          toggleLive(id);
        } else if (act === "update-score") {
          updateScore(id, 1, 0);
        } else if (act === "sim-goal") {
          simulateGoal(id);
        } else if (act === "reset") {
          resetTeam(id);
        } else if (act === "score-step") {
          var side = actBtn.getAttribute("data-sc-side");
          var delta = parseInt(actBtn.getAttribute("data-sc-delta") || "1", 10);
          if (side === "home") updateScore(id, delta, 0);
          else updateScore(id, 0, delta);
        }
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && activeModalId) {
        closeModal();
      }
    });
  }

  function afterRender(route) {
    cleanDuplicateRows();
    if (route && route.name === "home") {
      if (soccerOff()) stopAutoTicker();
      else startAutoTicker();
    }
  }

  var api = {
    pillsHtml: pillsHtml,
    homeRow: homeRow,
    rowExtra: rowExtra,
    afterRender: afterRender,
    openModal: openModal,
    closeModal: closeModal,
    toggleLive: toggleLive,
    updateScore: updateScore,
    simulateGoal: simulateGoal,
    resetTeam: resetTeam,
    loadTeams: loadTeams,
    getTeam: getTeam,
    renderPill: renderPill
  };

  root.SoccerScores = api;
  root.SoccerScoresLogic = {
    loadTeams: loadTeams,
    getTeam: getTeam,
    pillsHtml: pillsHtml,
    renderPill: renderPill,
    homeRow: homeRow,
    rowExtra: rowExtra,
    getDefaultData: getDefaultData
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
