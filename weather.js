/* Weather pills, customizable locations, and pill pinning management.
   Integrates seamlessly with Spaces radio and Soccer live scores inside .sp-row. */
(function (root) {
  "use strict";

  function tr(key, vars) {
    var fn = (typeof window !== "undefined" && window.t) ? window.t : ((typeof self !== "undefined" && self.t) ? self.t : null);
    return fn ? fn(key, vars) : key;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var STORAGE_PLACES = "viktorychapp-weather-places-v2";
  var STORAGE_PREFS = "viktorychapp-pills-prefs-v2";

  /* Weather SVG Icons */
  var WEATHER_ICONS = {
    "clear": '<svg class="wx-icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="#F59E0B"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" stroke="#F59E0B" stroke-width="2" stroke-linecap="round"/></svg>',
    "partly-cloudy": '<svg class="wx-icon-svg" viewBox="0 0 24 24"><circle cx="9" cy="9" r="4" fill="#F59E0B"/><path d="M19.36 15.04A5.5 5.5 0 0 0 9.2 12.5a4 4 0 0 0-4.2 4 4 4 0 0 0 4 4h10a3.5 3.5 0 0 0 .36-5.46z" fill="#E2E8F0"/></svg>',
    "cloudy": '<svg class="wx-icon-svg" viewBox="0 0 24 24"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="#94A3B8"/></svg>',
    "rain": '<svg class="wx-icon-svg" viewBox="0 0 24 24"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="#64748B"/><path d="M8 22l2-4m4 4l2-4" stroke="#38BDF8" stroke-width="2" stroke-linecap="round"/></svg>',
    "drizzle": '<svg class="wx-icon-svg" viewBox="0 0 24 24"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="#64748B"/><circle cx="9" cy="22" r="1" fill="#38BDF8"/><circle cx="15" cy="22" r="1" fill="#38BDF8"/></svg>',
    "thunderstorm": '<svg class="wx-icon-svg" viewBox="0 0 24 24"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="#334155"/><polygon points="13,14 10,19 13,19 11,24 16,18 13,18" fill="#FACC15"/></svg>',
    "snow": '<svg class="wx-icon-svg" viewBox="0 0 24 24"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="#94A3B8"/><circle cx="8" cy="22" r="1.5" fill="#BAE6FD"/><circle cx="12" cy="23" r="1.5" fill="#BAE6FD"/><circle cx="16" cy="22" r="1.5" fill="#BAE6FD"/></svg>',
    "fog": '<svg class="wx-icon-svg" viewBox="0 0 24 24"><path d="M4 14h16M2 18h20M6 22h12M17 10h-1.26A7 7 0 1 0 10 14h7a4 4 0 0 0 0-8z" stroke="#CBD5E1" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
    "generic": '<svg class="wx-icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="#F59E0B"/></svg>'
  };

  /* Weather Code Mapping */
  function codeToCondition(code) {
    var c = Number(code) || 0;
    if (c === 0) return { name: tr("Clear"), icon: "clear", css: "wx-clear" };
    if (c === 1 || c === 2) return { name: tr("Partly Cloudy"), icon: "partly-cloudy", css: "wx-partly-cloudy" };
    if (c === 3) return { name: tr("Overcast"), icon: "cloudy", css: "wx-cloudy" };
    if (c === 45 || c === 48) return { name: tr("Fog"), icon: "fog", css: "wx-fog" };
    if (c === 51 || c === 53 || c === 55) return { name: tr("Drizzle"), icon: "drizzle", css: "wx-rain" };
    if (c === 61 || c === 63 || c === 65 || c === 80 || c === 81 || c === 82) return { name: tr("Rain"), icon: "rain", css: "wx-rain" };
    if (c === 71 || c === 73 || c === 75 || c === 77 || c === 85 || c === 86) return { name: tr("Snow"), icon: "snow", css: "wx-snow" };
    if (c === 95 || c === 96 || c === 99) return { name: tr("Thunderstorm"), icon: "thunderstorm", css: "wx-thunder" };
    return { name: tr("Partly Cloudy"), icon: "partly-cloudy", css: "wx-partly-cloudy" };
  }

  /* Default Places Data */
  function getDefaultPlaces() {
    return [
      {
        id: "tula",
        name: "Tula",
        country: "Russia",
        lat: 54.1961,
        lon: 37.6182,
        temp: 14,
        tempMin: 8,
        tempMax: 17,
        code: 2,
        humidity: 68,
        wind: 12,
        precipitation: 10,
        uv: 3,
        hourly: [
          { hour: "12:00", temp: 15, code: 1 },
          { hour: "14:00", temp: 17, code: 2 },
          { hour: "16:00", temp: 16, code: 2 },
          { hour: "18:00", temp: 14, code: 3 },
          { hour: "20:00", temp: 12, code: 3 },
          { hour: "22:00", temp: 10, code: 2 }
        ],
        daily: [
          { dayKey: "today", dayLabel: tr("Today"), min: 8, max: 17, code: 2 },
          { dayKey: "tomorrow", dayLabel: tr("Tomorrow"), min: 9, max: 18, code: 1 },
          { dayKey: "tue", dayLabel: tr("Tue"), min: 7, max: 15, code: 3 },
          { dayKey: "wed", dayLabel: tr("Wed"), min: 6, max: 14, code: 61 },
          { dayKey: "thu", dayLabel: tr("Thu"), min: 8, max: 16, code: 2 }
        ]
      },
      {
        id: "barcelona",
        name: "Barcelona",
        country: "Spain",
        lat: 41.3888,
        lon: 2.159,
        temp: 21,
        tempMin: 15,
        tempMax: 23,
        code: 0,
        humidity: 58,
        wind: 15,
        precipitation: 0,
        uv: 5,
        hourly: [
          { hour: "12:00", temp: 20, code: 0 },
          { hour: "14:00", temp: 23, code: 0 },
          { hour: "16:00", temp: 22, code: 0 },
          { hour: "18:00", temp: 21, code: 1 },
          { hour: "20:00", temp: 19, code: 1 },
          { hour: "22:00", temp: 17, code: 0 }
        ],
        daily: [
          { dayKey: "today", dayLabel: tr("Today"), min: 15, max: 23, code: 0 },
          { dayKey: "tomorrow", dayLabel: tr("Tomorrow"), min: 16, max: 24, code: 0 },
          { dayKey: "tue", dayLabel: tr("Tue"), min: 15, max: 22, code: 1 },
          { dayKey: "wed", dayLabel: tr("Wed"), min: 14, max: 21, code: 2 },
          { dayKey: "thu", dayLabel: tr("Thu"), min: 16, max: 23, code: 0 }
        ]
      },
      {
        id: "london",
        name: "London",
        country: "United Kingdom",
        lat: 51.5074,
        lon: -0.1278,
        temp: 16,
        tempMin: 11,
        tempMax: 18,
        code: 51,
        humidity: 78,
        wind: 18,
        precipitation: 40,
        uv: 2,
        hourly: [
          { hour: "12:00", temp: 16, code: 51 },
          { hour: "14:00", temp: 18, code: 3 },
          { hour: "16:00", temp: 17, code: 61 },
          { hour: "18:00", temp: 15, code: 3 },
          { hour: "20:00", temp: 14, code: 2 },
          { hour: "22:00", temp: 12, code: 2 }
        ],
        daily: [
          { dayKey: "today", dayLabel: tr("Today"), min: 11, max: 18, code: 51 },
          { dayKey: "tomorrow", dayLabel: tr("Tomorrow"), min: 10, max: 17, code: 61 },
          { dayKey: "tue", dayLabel: tr("Tue"), min: 9, max: 16, code: 3 },
          { dayKey: "wed", dayLabel: tr("Wed"), min: 11, max: 18, code: 2 },
          { dayKey: "thu", dayLabel: tr("Thu"), min: 10, max: 17, code: 1 }
        ]
      },
      {
        id: "new-york",
        name: "New York",
        country: "United States",
        lat: 40.7128,
        lon: -74.0060,
        temp: 18,
        tempMin: 12,
        tempMax: 20,
        code: 0,
        humidity: 50,
        wind: 14,
        precipitation: 5,
        uv: 4,
        hourly: [
          { hour: "12:00", temp: 18, code: 0 },
          { hour: "14:00", temp: 20, code: 0 },
          { hour: "16:00", temp: 19, code: 1 },
          { hour: "18:00", temp: 17, code: 1 },
          { hour: "20:00", temp: 15, code: 0 },
          { hour: "22:00", temp: 13, code: 0 }
        ],
        daily: [
          { dayKey: "today", dayLabel: tr("Today"), min: 12, max: 20, code: 0 },
          { dayKey: "tomorrow", dayLabel: tr("Tomorrow"), min: 13, max: 21, code: 1 },
          { dayKey: "tue", dayLabel: tr("Tue"), min: 14, max: 22, code: 2 },
          { dayKey: "wed", dayLabel: tr("Wed"), min: 11, max: 19, code: 3 },
          { dayKey: "thu", dayLabel: tr("Thu"), min: 12, max: 20, code: 0 }
        ]
      }
    ];
  }

  var DEFAULT_PINNED = [
    "weather:tula",
    "soccer:arsenal-tula",
    "soccer:fc-barcelona",
    "space:superintelmusic"
  ];

  /* State Management */
  var placesState = null;
  var prefsState = null;
  var activeWeatherModalId = null;
  var manageModalOpen = false;

  function loadPlaces() {
    if (placesState) return placesState;
    if (typeof localStorage !== "undefined") {
      try {
        var raw = localStorage.getItem(STORAGE_PLACES);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length) {
            placesState = parsed;
            return placesState;
          }
        }
      } catch (err) {}
    }
    placesState = getDefaultPlaces();
    savePlaces();
    return placesState;
  }

  function savePlaces() {
    if (!placesState || typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_PLACES, JSON.stringify(placesState));
    } catch (err) {}
  }

  function getPlace(placeId) {
    var list = loadPlaces();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === placeId) return list[i];
    }
    return null;
  }

  function loadPrefs() {
    if (prefsState) return prefsState;
    var def = {
      pinnedIds: DEFAULT_PINNED.slice(),
      customOrder: [],
      unit: "C"
    };
    if (typeof localStorage !== "undefined") {
      try {
        var raw = localStorage.getItem(STORAGE_PREFS);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            if (!Array.isArray(parsed.pinnedIds)) parsed.pinnedIds = def.pinnedIds;
            if (!Array.isArray(parsed.customOrder)) parsed.customOrder = [];
            if (parsed.unit !== "C" && parsed.unit !== "F") parsed.unit = "C";
            prefsState = parsed;
            return prefsState;
          }
        }
      } catch (err) {}
    }
    prefsState = def;
    savePrefs(prefsState);
    return prefsState;
  }

  function savePrefs(prefs) {
    if (prefs) prefsState = prefs;
    if (!prefsState || typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_PREFS, JSON.stringify(prefsState));
    } catch (err) {}
  }

  function getUnit() {
    return loadPrefs().unit || "C";
  }

  function setUnit(unit) {
    var prefs = loadPrefs();
    prefs.unit = unit === "F" ? "F" : "C";
    savePrefs(prefs);
    refreshUI();
  }

  function formatTemp(celsius, unit) {
    var c = Number(celsius) || 0;
    var u = unit || getUnit();
    if (u === "F") {
      var f = Math.round(c * 9 / 5 + 32);
      return f + "°";
    }
    return Math.round(c) + "°";
  }

  function isPinned(pillId) {
    var prefs = loadPrefs();
    var id = String(pillId || "");
    return prefs.pinnedIds.indexOf(id) !== -1;
  }

  function togglePin(pillId) {
    var prefs = loadPrefs();
    var id = String(pillId || "");
    var idx = prefs.pinnedIds.indexOf(id);
    var nowPinned = false;
    if (idx !== -1) {
      prefs.pinnedIds.splice(idx, 1);
      nowPinned = false;
    } else {
      prefs.pinnedIds.push(id);
      nowPinned = true;
      if (prefs.customOrder.indexOf(id) === -1) {
        prefs.customOrder.unshift(id);
      }
    }
    savePrefs(prefs);
    refreshUI();
    if (typeof window !== "undefined" && window.toast) {
      window.toast(nowPinned ? tr("Pill pinned") : tr("Pill unpinned"));
    }
    return nowPinned;
  }

  function reorderPill(pillId, direction) {
    var prefs = loadPrefs();
    var all = getAllPills();
    var currentOrder = prefs.customOrder.length ? prefs.customOrder.slice() : all.map(function (p) { return p.id; });

    all.forEach(function (p) {
      if (currentOrder.indexOf(p.id) === -1) currentOrder.push(p.id);
    });

    var idx = currentOrder.indexOf(pillId);
    if (idx === -1) return;
    var targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= currentOrder.length) return;

    var temp = currentOrder[idx];
    currentOrder[idx] = currentOrder[targetIdx];
    currentOrder[targetIdx] = temp;

    prefs.customOrder = currentOrder;
    savePrefs(prefs);
    refreshUI();
  }

  function resetPrefs() {
    prefsState = {
      pinnedIds: DEFAULT_PINNED.slice(),
      customOrder: [],
      unit: "C"
    };
    savePrefs(prefsState);
    refreshUI();
    if (typeof window !== "undefined" && window.toast) {
      window.toast(tr("Reset to default"));
    }
  }

  /* Add Custom Place */
  function addPlace(cityName, cb) {
    var name = String(cityName || "").trim();
    if (!name) {
      if (typeof window !== "undefined" && window.toast) window.toast(tr("Enter a city name"));
      return;
    }

    var id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!id) id = "place-" + Date.now();

    var existing = getPlace(id);
    if (existing) {
      if (!isPinned("weather:" + id)) togglePin("weather:" + id);
      openWeatherModal(id);
      return;
    }

    var hasFetch = typeof window !== "undefined" && typeof window.fetch === "function";
    if (hasFetch && typeof navigator !== "undefined" && navigator.onLine) {
      var geoUrl = "https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(name) + "&count=1&language=en&format=json";
      window.fetch(geoUrl)
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && data.results && data.results.length) {
            var r = data.results[0];
            fetchForecast(r.latitude, r.longitude, r.name, r.country || "", id, cb);
          } else {
            fallbackAddPlace(name, id, cb);
          }
        })
        .catch(function () {
          fallbackAddPlace(name, id, cb);
        });
    } else {
      fallbackAddPlace(name, id, cb);
    }
  }

  function fetchForecast(lat, lon, name, country, id, cb) {
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon + "&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max&timezone=auto";
    window.fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (res) {
        var cur = res.current || {};
        var daily = res.daily || {};
        var temp = Math.round(cur.temperature_2m || 15);
        var min = (daily.temperature_2m_min && daily.temperature_2m_min[0]) ? Math.round(daily.temperature_2m_min[0]) : temp - 5;
        var max = (daily.temperature_2m_max && daily.temperature_2m_max[0]) ? Math.round(daily.temperature_2m_max[0]) : temp + 4;
        var code = cur.weather_code || 0;

        var dailyItems = [];
        var days = [tr("Today"), tr("Tomorrow"), tr("Tue"), tr("Wed"), tr("Thu")];
        for (var i = 0; i < Math.min(5, (daily.time || []).length); i++) {
          dailyItems.push({
            dayLabel: days[i] || tr("Today"),
            min: Math.round(daily.temperature_2m_min[i] || min),
            max: Math.round(daily.temperature_2m_max[i] || max),
            code: daily.weather_code ? daily.weather_code[i] : code
          });
        }

        var newPlace = {
          id: id,
          name: name,
          country: country,
          lat: lat,
          lon: lon,
          temp: temp,
          tempMin: min,
          tempMax: max,
          code: code,
          humidity: cur.relative_humidity_2m || 60,
          wind: Math.round(cur.wind_speed_10m || 10),
          precipitation: Math.round(cur.precipitation || 0),
          uv: (daily.uv_index_max && daily.uv_index_max[0]) ? Math.round(daily.uv_index_max[0]) : 4,
          hourly: [
            { hour: "12:00", temp: temp, code: code },
            { hour: "15:00", temp: max, code: code },
            { hour: "18:00", temp: temp - 1, code: code },
            { hour: "21:00", temp: min + 2, code: code }
          ],
          daily: dailyItems.length ? dailyItems : [
            { dayLabel: tr("Today"), min: min, max: max, code: code },
            { dayLabel: tr("Tomorrow"), min: min + 1, max: max + 1, code: code }
          ]
        };

        saveNewPlace(newPlace);
        if (cb) cb(newPlace);
      })
      .catch(function () {
        fallbackAddPlace(name, id, cb);
      });
  }

  function fallbackAddPlace(name, id, cb) {
    var hash = 0;
    for (var i = 0; i < name.length; i++) hash = ((hash << 5) - hash) + name.charCodeAt(i);
    var baseTemp = 12 + Math.abs(hash % 16);
    var codes = [0, 1, 2, 3, 51, 61];
    var code = codes[Math.abs(hash) % codes.length];

    var newPlace = {
      id: id,
      name: name,
      country: "",
      lat: 0,
      lon: 0,
      temp: baseTemp,
      tempMin: baseTemp - 5,
      tempMax: baseTemp + 4,
      code: code,
      humidity: 55 + Math.abs(hash % 35),
      wind: 8 + Math.abs(hash % 15),
      precipitation: (code >= 51) ? 35 : 0,
      uv: 3 + Math.abs(hash % 5),
      hourly: [
        { hour: "12:00", temp: baseTemp, code: code },
        { hour: "15:00", temp: baseTemp + 3, code: code },
        { hour: "18:00", temp: baseTemp + 1, code: code },
        { hour: "21:00", temp: baseTemp - 2, code: code }
      ],
      daily: [
        { dayLabel: tr("Today"), min: baseTemp - 5, max: baseTemp + 4, code: code },
        { dayLabel: tr("Tomorrow"), min: baseTemp - 4, max: baseTemp + 5, code: code },
        { dayLabel: tr("Tue"), min: baseTemp - 6, max: baseTemp + 3, code: code },
        { dayLabel: tr("Wed"), min: baseTemp - 5, max: baseTemp + 2, code: code },
        { dayLabel: tr("Thu"), min: baseTemp - 4, max: baseTemp + 4, code: code }
      ]
    };

    saveNewPlace(newPlace);
    if (cb) cb(newPlace);
  }

  function saveNewPlace(newPlace) {
    var list = loadPlaces();
    list.push(newPlace);
    savePlaces();

    var prefs = loadPrefs();
    var pillId = "weather:" + newPlace.id;
    if (prefs.pinnedIds.indexOf(pillId) === -1) {
      prefs.pinnedIds.unshift(pillId);
    }
    if (prefs.customOrder.indexOf(pillId) === -1) {
      prefs.customOrder.unshift(pillId);
    }
    savePrefs(prefs);

    refreshUI();
    if (typeof window !== "undefined" && window.toast) {
      window.toast(tr("Place added") + ": " + newPlace.name);
    }
  }

  function removePlace(placeId) {
    var list = loadPlaces();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === placeId) {
        idx = i;
        break;
      }
    }
    if (idx !== -1) {
      var removed = list.splice(idx, 1)[0];
      savePlaces();
      var pillId = "weather:" + placeId;
      var prefs = loadPrefs();
      var pinIdx = prefs.pinnedIds.indexOf(pillId);
      if (pinIdx !== -1) prefs.pinnedIds.splice(pinIdx, 1);
      var ordIdx = prefs.customOrder.indexOf(pillId);
      if (ordIdx !== -1) prefs.customOrder.splice(ordIdx, 1);
      savePrefs(prefs);

      if (activeWeatherModalId === placeId) closeWeatherModal();
      refreshUI();
      if (typeof window !== "undefined" && window.toast) {
        window.toast(tr("Place removed") + ": " + (removed ? removed.name : placeId));
      }
    }
  }

  /* HTML Generators */
  function getWeatherIcon(iconName) {
    return WEATHER_ICONS[iconName] || WEATHER_ICONS["generic"];
  }

  function renderPill(place, unit, pinned) {
    var cond = codeToCondition(place.code);
    var u = unit || getUnit();
    var tempStr = formatTemp(place.temp, u);
    var rangeStr = formatTemp(place.tempMax, u) + " / " + formatTemp(place.tempMin, u);
    var condLabel = cond.name;

    var pinBadge = pinned ? '<span class="pill-pin-mark" title="' + esc(tr("Pinned")) + '">📌</span>' : "";

    return '<button class="sc-pill wx-pill ' + esc(cond.css) + ' wx-pill-' + esc(place.id) + '" type="button" data-wx-id="' + esc(place.id) + '" aria-label="' + esc(place.name) + " " + esc(tempStr) + " " + esc(condLabel) + '">'
      + '<span class="wx-icon-ring">' + getWeatherIcon(cond.icon) + '</span>'
      + '<span class="sc-pill-content">'
      + '<span class="sc-pill-top"><span class="sc-badge is-live wx-badge is-temp">' + esc(tempStr) + '</span><span class="sc-pill-title">' + esc(place.name) + '</span>' + pinBadge + '</span>'
      + '<span class="sc-pill-bottom"><span class="wx-cond">' + esc(condLabel) + '</span><span class="wx-range">' + esc(rangeStr) + '</span></span>'
      + '</span>'
      + '<span class="sc-pill-arrow"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg></span>'
      + '</button>';
  }

  function pillsHtml() {
    var list = loadPlaces();
    var u = getUnit();
    return list.map(function (place) {
      var pinned = isPinned("weather:" + place.id);
      return '<div class="sp-row-item" role="listitem">' + renderPill(place, u, pinned) + '</div>';
    }).join("");
  }

  /* Unified Pill Registry: combines Spaces, Soccer & Weather with Pinning & Ordering */
  function getAllPills() {
    var pills = [];
    var u = getUnit();

    // 1. Weather Pills
    var places = loadPlaces();
    places.forEach(function (place) {
      var id = "weather:" + place.id;
      var pinned = isPinned(id);
      pills.push({
        id: id,
        type: "weather",
        title: place.name,
        badgeText: formatTemp(place.temp, u),
        isPinned: pinned,
        html: '<div class="sp-row-item" role="listitem">' + renderPill(place, u, pinned) + '</div>'
      });
    });

    // 2. Soccer Pills
    if (root.SoccerScores && root.SoccerScores.loadTeams) {
      var teams = root.SoccerScores.loadTeams();
      teams.forEach(function (team) {
        var id = "soccer:" + team.id;
        var pinned = isPinned(id);
        var renderFn = root.SoccerScores.renderPill || (root.SoccerScoresLogic && root.SoccerScoresLogic.renderPill);
        var rendered = renderFn ? renderFn(team) : "";
        pills.push({
          id: id,
          type: "soccer",
          title: team.nameKey,
          badgeText: team.isLive ? tr("LIVE") : tr("Full Time"),
          isPinned: pinned,
          html: '<div class="sp-row-item" role="listitem">' + rendered + '</div>'
        });
      });
    }

    // 3. Space Pills
    if (root.Spaces && root.Spaces.homePillsHtml) {
      var id = "space:superintelmusic";
      var pinned = isPinned(id);
      var spaceHtml = root.Spaces.homePillsHtml();
      pills.push({
        id: id,
        type: "space",
        title: tr("Radio"),
        badgeText: tr("LIVE"),
        isPinned: pinned,
        html: spaceHtml
      });
    }

    return pills;
  }

  function unifiedRowHtml() {
    var all = getAllPills();
    var prefs = loadPrefs();
    var order = prefs.customOrder || [];

    var sorted = all.slice().sort(function (a, b) {
      var idxA = order.indexOf(a.id);
      var idxB = order.indexOf(b.id);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;

      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return 0;
    });

    var innerPillsHtml = sorted.map(function (item) { return item.html; }).join("");

    var manageBtn = '<div class="sp-row-item" role="listitem">'
      + '<button class="sp-pill-manage-btn" type="button" data-act="open-manage-pills" aria-label="' + esc(tr("Customize pills")) + '" title="' + esc(tr("Customize pills")) + '">'
      + '<span class="sp-manage-pin-ico">📌</span>'
      + '<span class="sp-manage-label">' + esc(tr("Customize")) + '</span>'
      + '</button>'
      + '</div>';

    return '<div class="sp-row-wrap" role="region" aria-label="' + esc(tr("Live")) + '"><div class="sp-row" role="list">' + innerPillsHtml + manageBtn + '</div></div>';
  }

  function homeRow() {
    return unifiedRowHtml();
  }

  /* Weather Details Modal HTML */
  function renderWeatherModalHtml(placeId) {
    var place = getPlace(placeId);
    if (!place) return "";

    var cond = codeToCondition(place.code);
    var u = getUnit();
    var tempStr = formatTemp(place.temp, u);
    var pinned = isPinned("weather:" + place.id);

    // Hourly Forecast HTML
    var hourlyHtml = "";
    if (place.hourly && place.hourly.length) {
      hourlyHtml = '<div class="wx-hourly-strip">' + place.hourly.map(function (h) {
        var hCond = codeToCondition(h.code);
        return '<div class="wx-hourly-item">'
          + '<span class="wx-hourly-time">' + esc(h.hour) + '</span>'
          + getWeatherIcon(hCond.icon)
          + '<span class="wx-hourly-temp">' + esc(formatTemp(h.temp, u)) + '</span>'
          + '</div>';
      }).join("") + '</div>';
    }

    // Daily Forecast HTML
    var dailyHtml = "";
    if (place.daily && place.daily.length) {
      dailyHtml = '<div class="wx-daily-list">' + place.daily.map(function (d) {
        var dCond = codeToCondition(d.code);
        var label = d.dayLabel || (d.dayKey ? tr(d.dayKey) : tr("Today"));
        return '<div class="wx-daily-row">'
          + '<span class="wx-daily-day">' + esc(label) + '</span>'
          + '<span class="wx-daily-icon">' + getWeatherIcon(dCond.icon) + '</span>'
          + '<span class="wx-daily-cond">' + esc(dCond.name) + '</span>'
          + '<div class="wx-daily-range">'
          + '<span class="wx-daily-min">' + esc(formatTemp(d.min, u)) + '</span>'
          + '<div class="wx-daily-bar"><div class="wx-daily-bar-fill" style="left:20%;right:20%"></div></div>'
          + '<span class="wx-daily-max">' + esc(formatTemp(d.max, u)) + '</span>'
          + '</div>'
          + '</div>';
      }).join("") + '</div>';
    }

    return '<div class="wx-modal-overlay is-open" data-wx-act="close-overlay">'
      + '<div class="wx-modal-dialog" role="dialog" aria-modal="true" aria-label="' + esc(tr("Weather Details")) + '">'
      + '<div class="wx-modal-head">'
      + '<div class="wx-modal-title-wrap">'
      + '<span class="wx-modal-city">' + esc(place.name) + '</span>'
      + (place.country ? '<span class="wx-modal-country">' + esc(place.country) + '</span>' : '')
      + '</div>'
      + '<button class="wx-close-btn" type="button" data-wx-act="close" aria-label="' + esc(tr("Close")) + '"><svg viewBox="0 0 24 24"><path d="M18.3 5.71a.996.996 0 0 0-1.41 0L12 10.59 7.11 5.7A.996.996 0 1 0 5.7 7.11L10.59 12 5.7 16.89a.996.996 0 1 0 1.41 1.41L12 13.41l4.89 4.89a.996.996 0 1 0 1.41-1.41L13.41 12l4.89-4.89c.38-.38.38-1.02 0-1.4z"/></svg></button>'
      + '</div>'
      + '<div class="wx-hero">'
      + '<div class="wx-hero-icon-large">' + getWeatherIcon(cond.icon) + '</div>'
      + '<div class="wx-hero-temp-row">'
      + '<span class="wx-hero-temp">' + esc(tempStr) + '</span>'
      + '<div class="wx-unit-toggle">'
      + '<button class="wx-unit-btn' + (u === "C" ? " active" : "") + '" type="button" data-wx-act="set-unit" data-unit="C">°C</button>'
      + '<button class="wx-unit-btn' + (u === "F" ? " active" : "") + '" type="button" data-wx-act="set-unit" data-unit="F">°F</button>'
      + '</div>'
      + '</div>'
      + '<span class="wx-hero-cond">' + esc(cond.name) + '</span>'
      + '<span class="wx-hero-sub">' + esc(tr("High")) + " " + esc(formatTemp(place.tempMax, u)) + " • " + esc(tr("Low")) + " " + esc(formatTemp(place.tempMin, u)) + " • " + esc(tr("Feels like")) + " " + esc(formatTemp(place.temp - 1, u)) + '</span>'
      + '</div>'
      + '<div class="wx-toolbar">'
      + '<button class="wx-action-btn' + (pinned ? " is-pinned-on" : "") + '" type="button" data-wx-act="toggle-pin" data-id="' + esc(place.id) + '">'
      + '📌 <span>' + (pinned ? esc(tr("Pinned")) : esc(tr("Pin to row"))) + '</span>'
      + '</button>'
      + '<button class="wx-action-btn" type="button" data-wx-act="open-manage">'
      + '⚙️ <span>' + esc(tr("Manage Pills")) + '</span>'
      + '</button>'
      + '<button class="wx-action-btn" type="button" data-wx-act="remove-place" data-id="' + esc(place.id) + '">'
      + '🗑️ <span>' + esc(tr("Remove place")) + '</span>'
      + '</button>'
      + '</div>'
      + '<div class="wx-stats-grid">'
      + '<div class="wx-stat-card"><span class="wx-stat-label">💧 ' + esc(tr("Humidity")) + '</span><span class="wx-stat-val">' + esc(place.humidity) + '%</span></div>'
      + '<div class="wx-stat-card"><span class="wx-stat-label">💨 ' + esc(tr("Wind")) + '</span><span class="wx-stat-val">' + esc(place.wind) + " km/h</span></div>"
      + '<div class="wx-stat-card"><span class="wx-stat-label">☔ ' + esc(tr("Precipitation")) + '</span><span class="wx-stat-val">' + esc(place.precipitation) + '%</span></div>'
      + '<div class="wx-stat-card"><span class="wx-stat-label">☀️ ' + esc(tr("UV Index")) + '</span><span class="wx-stat-val">' + esc(place.uv) + '</span></div>'
      + '</div>'
      + (hourlyHtml ? '<div class="wx-section-heading">' + esc(tr("Hourly Forecast")) + '</div>' + hourlyHtml : '')
      + (dailyHtml ? '<div class="wx-section-heading">' + esc(tr("Daily Forecast")) + '</div>' + dailyHtml : '')
      + '</div>'
      + '</div>';
  }

  /* Manage Pills Modal HTML */
  function renderManageModalHtml() {
    var all = getAllPills();
    var prefs = loadPrefs();
    var order = prefs.customOrder || [];

    var pinnedItems = all.filter(function (p) { return p.isPinned; });
    pinnedItems.sort(function (a, b) {
      var idxA = order.indexOf(a.id);
      var idxB = order.indexOf(b.id);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return 0;
    });

    var unpinnedItems = all.filter(function (p) { return !p.isPinned; });
    var popularPlaces = ["London", "Barcelona", "Tokyo", "New York", "Tula", "Paris", "Rome", "Kyiv"];

    var pinnedRows = pinnedItems.length ? pinnedItems.map(function (item, idx) {
      var typeClass = "is-" + item.type;
      return '<div class="manage-pill-item">'
        + '<div class="manage-pill-info">'
        + '<span class="manage-pill-type-tag ' + typeClass + '">' + esc(item.type) + '</span>'
        + '<span class="manage-pill-name">' + esc(item.title) + '</span>'
        + '</div>'
        + '<div class="manage-pill-actions">'
        + '<button class="manage-arrow-btn" type="button" data-act="pill-move" data-id="' + esc(item.id) + '" data-dir="-1" aria-label="' + esc(tr("Move left")) + '"' + (idx === 0 ? " disabled" : "") + '>←</button>'
        + '<button class="manage-arrow-btn" type="button" data-act="pill-move" data-id="' + esc(item.id) + '" data-dir="1" aria-label="' + esc(tr("Move right")) + '"' + (idx === pinnedItems.length - 1 ? " disabled" : "") + '>→</button>'
        + '<button class="manage-pin-btn is-active" type="button" data-act="pill-unpin" data-id="' + esc(item.id) + '">📌 ' + esc(tr("Unpin pill")) + '</button>'
        + '</div>'
        + '</div>';
    }).join("") : '<div style="padding:12px 18px;color:var(--sub);font-size:13px">' + esc(tr("Available Pills")) + '</div>';

    var unpinnedRows = unpinnedItems.length ? unpinnedItems.map(function (item) {
      var typeClass = "is-" + item.type;
      return '<div class="manage-pill-item">'
        + '<div class="manage-pill-info">'
        + '<span class="manage-pill-type-tag ' + typeClass + '">' + esc(item.type) + '</span>'
        + '<span class="manage-pill-name">' + esc(item.title) + '</span>'
        + '</div>'
        + '<div class="manage-pill-actions">'
        + '<button class="manage-pin-btn" type="button" data-act="pill-pin" data-id="' + esc(item.id) + '">📌 ' + esc(tr("Pin pill")) + '</button>'
        + '</div>'
        + '</div>';
    }).join("") : '';

    var chipsHtml = popularPlaces.map(function (city) {
      return '<button class="wx-place-chip" type="button" data-act="quick-add" data-city="' + esc(city) + '">+ ' + esc(city) + '</button>';
    }).join("");

    return '<div class="wx-modal-overlay is-open" data-act="close-overlay">'
      + '<div class="wx-modal-dialog" role="dialog" aria-modal="true" aria-label="' + esc(tr("Customize Pills")) + '">'
      + '<div class="wx-modal-head">'
      + '<div class="wx-modal-title-wrap">'
      + '<span class="wx-modal-city">📌 ' + esc(tr("Customize Pills")) + '</span>'
      + '<span class="wx-modal-country">' + esc(tr("Manage Pills")) + '</span>'
      + '</div>'
      + '<button class="wx-close-btn" type="button" data-act="close" aria-label="' + esc(tr("Close")) + '"><svg viewBox="0 0 24 24"><path d="M18.3 5.71a.996.996 0 0 0-1.41 0L12 10.59 7.11 5.7A.996.996 0 1 0 5.7 7.11L10.59 12 5.7 16.89a.996.996 0 1 0 1.41 1.41L12 13.41l4.89 4.89a.996.996 0 1 0 1.41-1.41L13.41 12l4.89-4.89c.38-.38.38-1.02 0-1.4z"/></svg></button>'
      + '</div>'
      + '<div class="wx-section-heading">' + esc(tr("Pinned Pills")) + ' (' + pinnedItems.length + ')</div>'
      + '<div class="manage-pills-list">' + pinnedRows + '</div>'
      + (unpinnedRows ? '<div class="wx-section-heading">' + esc(tr("Available Pills")) + '</div><div class="manage-pills-list">' + unpinnedRows + '</div>' : '')
      + '<div class="wx-section-heading">' + esc(tr("Add Place")) + '</div>'
      + '<form class="wx-add-form" data-act="add-form">'
      + '<input id="wx-add-input" class="wx-add-input" type="text" placeholder="' + esc(tr("Enter city or place name...")) + '" autocomplete="off" />'
      + '<button class="wx-add-btn" type="submit">' + esc(tr("Add")) + '</button>'
      + '</form>'
      + '<div class="wx-section-heading" style="padding-top:4px">' + esc(tr("Popular Places")) + '</div>'
      + '<div class="wx-chip-cloud">' + chipsHtml + '</div>'
      + '<div class="manage-foot">'
      + '<button class="wx-action-btn" type="button" data-act="reset-defaults">' + esc(tr("Reset to default")) + '</button>'
      + '<button class="wx-action-btn is-pinned-on" type="button" data-act="close">' + esc(tr("Close")) + '</button>'
      + '</div>'
      + '</div>'
      + '</div>';
  }

  /* Modal Management */
  function openWeatherModal(placeId) {
    activeWeatherModalId = placeId;
    if (typeof document === "undefined") return;
    var container = document.getElementById("weather-sheet");
    if (!container) {
      container = document.createElement("div");
      container.id = "weather-sheet";
      document.body.appendChild(container);
    }
    container.hidden = false;
    container.innerHTML = renderWeatherModalHtml(placeId);
  }

  function closeWeatherModal() {
    activeWeatherModalId = null;
    if (typeof document === "undefined") return;
    var container = document.getElementById("weather-sheet");
    if (container) {
      container.hidden = true;
      container.innerHTML = "";
    }
  }

  function openManageModal() {
    manageModalOpen = true;
    if (typeof document === "undefined") return;
    var container = document.getElementById("pills-manage-sheet");
    if (!container) {
      container = document.createElement("div");
      container.id = "pills-manage-sheet";
      document.body.appendChild(container);
    }
    container.hidden = false;
    container.innerHTML = renderManageModalHtml();
  }

  function closeManageModal() {
    manageModalOpen = false;
    if (typeof document === "undefined") return;
    var container = document.getElementById("pills-manage-sheet");
    if (container) {
      container.hidden = true;
      container.innerHTML = "";
    }
  }

  function refreshUI() {
    savePlaces();
    if (typeof document === "undefined") return;
    var rowWrap = document.querySelector(".sp-row-wrap");
    if (rowWrap) {
      rowWrap.outerHTML = unifiedRowHtml();
    } else {
      var rowEl = document.querySelector(".sp-row");
      if (rowEl) {
        var tempWrap = document.createElement("div");
        tempWrap.innerHTML = unifiedRowHtml();
        var newRow = tempWrap.querySelector(".sp-row");
        if (newRow) rowEl.innerHTML = newRow.innerHTML;
      }
    }

    if (activeWeatherModalId) {
      var wSheet = document.getElementById("weather-sheet");
      if (wSheet && !wSheet.hidden) {
        wSheet.innerHTML = renderWeatherModalHtml(activeWeatherModalId);
      }
    }

    if (manageModalOpen) {
      var mSheet = document.getElementById("pills-manage-sheet");
      if (mSheet && !mSheet.hidden) {
        mSheet.innerHTML = renderManageModalHtml();
      }
    }
  }

  /* Event Delegation */
  if (typeof document !== "undefined") {
    document.addEventListener("click", function (event) {
      var target = event.target;
      if (!target) return;

      var wxBtn = target.closest("[data-wx-id]");
      if (wxBtn) {
        event.preventDefault();
        var pId = wxBtn.getAttribute("data-wx-id");
        openWeatherModal(pId);
        return;
      }

      var manageBtn = target.closest("[data-act='open-manage-pills'], [data-wx-act='open-manage'], [data-act='manage-pills']");
      if (manageBtn) {
        event.preventDefault();
        openManageModal();
        return;
      }

      var wxActBtn = target.closest("[data-wx-act]");
      if (wxActBtn) {
        event.preventDefault();
        var act = wxActBtn.getAttribute("data-wx-act");
        var id = wxActBtn.getAttribute("data-id");
        if (act === "close") {
          closeWeatherModal();
        } else if (act === "close-overlay") {
          if (event.target === wxActBtn) closeWeatherModal();
        } else if (act === "toggle-pin") {
          togglePin("weather:" + id);
        } else if (act === "set-unit") {
          var unit = wxActBtn.getAttribute("data-unit");
          setUnit(unit);
        } else if (act === "remove-place") {
          removePlace(id);
        }
        return;
      }

      var mActBtn = target.closest("#pills-manage-sheet [data-act]");
      if (mActBtn) {
        var mAct = mActBtn.getAttribute("data-act");
        var pId = mActBtn.getAttribute("data-id");
        if (mAct === "close") {
          event.preventDefault();
          closeManageModal();
        } else if (mAct === "close-overlay") {
          if (event.target === mActBtn) {
            event.preventDefault();
            closeManageModal();
          }
        } else if (mAct === "pill-pin" || mAct === "pill-unpin") {
          event.preventDefault();
          togglePin(pId);
        } else if (mAct === "pill-move") {
          event.preventDefault();
          var dir = parseInt(mActBtn.getAttribute("data-dir") || "0", 10);
          reorderPill(pId, dir);
        } else if (mAct === "quick-add") {
          event.preventDefault();
          var city = mActBtn.getAttribute("data-city");
          addPlace(city);
        } else if (mAct === "reset-defaults") {
          event.preventDefault();
          resetPrefs();
        }
      }
    });

    document.addEventListener("submit", function (event) {
      var target = event.target;
      if (target && target.matches && target.matches("[data-act='add-form']")) {
        event.preventDefault();
        var input = document.getElementById("wx-add-input");
        if (input && input.value) {
          addPlace(input.value);
          input.value = "";
        }
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (manageModalOpen) closeManageModal();
        else if (activeWeatherModalId) closeWeatherModal();
      }
    });
  }

  function afterRender(route) {
    if (route && route.name === "home") {
      if (typeof window !== "undefined" && typeof window.fetch === "function" && typeof navigator !== "undefined" && navigator.onLine) {
        var list = loadPlaces();
        var updated = false;
        var p = list.map(function (place) {
          if (place.lat && place.lon) {
            var url = "https://api.open-meteo.com/v1/forecast?latitude=" + place.lat + "&longitude=" + place.lon + "&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max&timezone=auto";
            return window.fetch(url)
              .then(function (r) { return r.json(); })
              .then(function (data) {
                var cur = data.current || {};
                if (cur.temperature_2m != null) {
                  place.temp = Math.round(cur.temperature_2m);
                  place.code = cur.weather_code || 0;
                  if (cur.relative_humidity_2m != null) place.humidity = cur.relative_humidity_2m;
                  if (cur.wind_speed_10m != null) place.wind = Math.round(cur.wind_speed_10m);
                  if (cur.precipitation != null) place.precipitation = Math.round(cur.precipitation);
                  updated = true;
                }
              })
              .catch(function () {});
          }
          return Promise.resolve();
        });
        Promise.all(p).then(function () {
          if (updated) refreshUI();
        });
      }
    }
  }

  var api = {
    loadPlaces: loadPlaces,
    savePlaces: savePlaces,
    getPlace: getPlace,
    addPlace: addPlace,
    removePlace: removePlace,
    loadPrefs: loadPrefs,
    savePrefs: savePrefs,
    isPinned: isPinned,
    togglePin: togglePin,
    reorderPill: reorderPill,
    resetPrefs: resetPrefs,
    setUnit: setUnit,
    getUnit: getUnit,
    renderPill: renderPill,
    pillsHtml: pillsHtml,
    getAllPills: getAllPills,
    unifiedRowHtml: unifiedRowHtml,
    homeRow: homeRow,
    openWeatherModal: openWeatherModal,
    closeWeatherModal: closeWeatherModal,
    openManageModal: openManageModal,
    closeManageModal: closeManageModal,
    refreshUI: refreshUI,
    afterRender: afterRender
  };

  root.WeatherPills = api;
  root.WeatherPillsLogic = {
    loadPlaces: loadPlaces,
    savePlaces: savePlaces,
    getPlace: getPlace,
    loadPrefs: loadPrefs,
    savePrefs: savePrefs,
    isPinned: isPinned,
    togglePin: togglePin,
    reorderPill: reorderPill,
    renderPill: renderPill,
    pillsHtml: pillsHtml,
    getAllPills: getAllPills,
    unifiedRowHtml: unifiedRowHtml,
    codeToCondition: codeToCondition,
    formatTemp: formatTemp,
    getDefaultPlaces: getDefaultPlaces
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
