/* Weather pills, customizable locations, and pill pinning management.
   Integrates seamlessly with Spaces radio and Soccer live scores inside .sp-row. */
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

  var STORAGE_PLACES = "viktorychapp-weather-places-v3";
  var STORAGE_OBS = "viktorychapp-weather-obs-v1";
  var STORAGE_HOME = "viktorychapp-weather-home-v1";
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

  /* Saved places are cities the user chose. Temperatures are not stored here. */
  function getDefaultPlaces() {
    return [];
  }

  var DEFAULT_PINNED = [
    "soccer:arsenal-tula",
    "soccer:fc-barcelona",
    "space:superintelmusic"
  ];

  /* State Management */
  var placesState = null;
  var obsState = null;
  var homeState = null;
  var prefsState = null;
  var activeWeatherModalId = null;
  var manageModalOpen = false;
  var weatherTimer = null;
  var weatherFetching = false;

  function pillApi() {
    return root.PillData || (typeof globalThis !== "undefined" ? globalThis.PillData : null);
  }

  function readJson(key) {
    if (typeof localStorage === "undefined") return null;
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function writeJson(key, value) {
    if (typeof localStorage === "undefined") return;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) {}
  }

  function identities() {
    if (placesState) return placesState;
    var parsed = readJson(STORAGE_PLACES);
    placesState = Array.isArray(parsed) ? parsed.filter(function (place) {
      return place && place.explicit && place.lat != null && place.lon != null;
    }) : [];
    return placesState;
  }

  function saveIdentities() {
    writeJson(STORAGE_PLACES, identities());
  }

  function loadObs() {
    if (obsState) return obsState;
    var parsed = readJson(STORAGE_OBS);
    obsState = parsed && typeof parsed === "object" ? parsed : {};
    return obsState;
  }

  function saveObsMap() {
    writeJson(STORAGE_OBS, loadObs());
  }

  function loadHome() {
    if (homeState) return homeState;
    var parsed = readJson(STORAGE_HOME);
    homeState = parsed && typeof parsed === "object" ? parsed : { setting: null };
    if (!homeState.setting) homeState.setting = null;
    return homeState;
  }

  function saveHome() {
    writeJson(STORAGE_HOME, loadHome());
  }

  function freshPlace(identity, now) {
    var api = pillApi();
    if (!api || !identity) return null;
    var obs = loadObs()[identity.id];
    if (!obs) return null;
    var record = {
      kind: "weather",
      id: identity.id,
      updatedAt: obs.updatedAt
    };
    if (api.presentRecord(record, now) == null) return null;
    var place = {};
    Object.keys(identity).forEach(function (key) { place[key] = identity[key]; });
    Object.keys(obs).forEach(function (key) { place[key] = obs[key]; });
    place.fresh = true;
    return place;
  }

  function loadPlaces() {
    var now = Date.now();
    var home = resolvedHome();
    var list = identities().slice();
    if (home && !list.some(function (place) { return place.id === home.id; })) list.unshift(home);
    return list.map(function (place) { return freshPlace(place, now); }).filter(Boolean);
  }

  function savePlaces() {
    saveIdentities();
  }

  function getPlace(placeId) {
    var list = loadPlaces();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === placeId) return list[i];
    }
    return null;
  }

  function rememberPlace(identity, obs) {
    var list = identities();
    var next = {
      id: identity.id,
      name: identity.name,
      country: identity.country || "",
      lat: identity.lat,
      lon: identity.lon,
      explicit: true
    };
    var replaced = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === next.id) {
        list[i] = next;
        replaced = true;
      }
    }
    if (!replaced) list.push(next);
    placesState = list;
    saveIdentities();
    if (obs) {
      var map = loadObs();
      map[next.id] = obs;
      obsState = map;
      saveObsMap();
    }
    return freshPlace(next, Date.now());
  }

  function loadPrefs() {
    if (prefsState) return prefsState;
    var def = {
      pinnedIds: DEFAULT_PINNED.slice(),
      customOrder: [],
      hiddenIds: [],
      disabledTypes: [],
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
            if (!Array.isArray(parsed.hiddenIds)) parsed.hiddenIds = [];
            if (!Array.isArray(parsed.disabledTypes)) parsed.disabledTypes = [];
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
    notify(nowPinned ? tr("Pill pinned") : tr("Pill unpinned"));
    return nowPinned;
  }

  /* Hidden pills stay in the registry but never render, so a user can switch a
     single pill off without losing its pin state or order. */
  function isHidden(pillId) {
    var prefs = loadPrefs();
    return prefs.hiddenIds.indexOf(String(pillId || "")) !== -1;
  }

  function setHidden(pillId, hidden) {
    var prefs = loadPrefs();
    var id = String(pillId || "");
    if (!id) return false;
    var idx = prefs.hiddenIds.indexOf(id);
    if (hidden && idx === -1) {
      prefs.hiddenIds.push(id);
    } else if (!hidden && idx !== -1) {
      prefs.hiddenIds.splice(idx, 1);
    } else {
      return hidden ? true : false;
    }
    savePrefs(prefs);
    refreshUI();
    notify(hidden ? tr("Pill hidden") : tr("Pill shown"));
    return hidden;
  }

  function toggleHidden(pillId) {
    return setHidden(pillId, !isHidden(pillId));
  }

  /* Whole categories (weather / matches / radio) can be switched off. A
     disabled category is not rendered and its loader stops doing work. */
  var PILL_TYPES = ["weather", "soccer", "space"];

  function isTypeDisabled(type) {
    var prefs = loadPrefs();
    return prefs.disabledTypes.indexOf(String(type || "")) !== -1;
  }

  function setTypeDisabled(type, disabled) {
    var key = String(type || "");
    if (PILL_TYPES.indexOf(key) === -1) return false;
    var prefs = loadPrefs();
    var idx = prefs.disabledTypes.indexOf(key);
    if (disabled && idx === -1) {
      prefs.disabledTypes.push(key);
    } else if (!disabled && idx !== -1) {
      prefs.disabledTypes.splice(idx, 1);
    } else {
      return !!disabled;
    }
    savePrefs(prefs);
    refreshUI();
    notify(disabled ? tr("Pills turned off") : tr("Pills turned on"));
    return !!disabled;
  }

  function toggleTypeDisabled(type) {
    return setTypeDisabled(type, !isTypeDisabled(type));
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
      hiddenIds: [],
      disabledTypes: [],
      unit: "C"
    };
    savePrefs(prefsState);
    refreshUI();
    notify(tr("Reset to default"));
  }

  var weatherGeo = null;

  function resolvedHome() {
    var api = pillApi();
    if (!api || identities().length) return null;
    var geo = weatherGeo && weatherGeo.granted ? {
      id: "here",
      name: tr("Current location"),
      country: "",
      lat: weatherGeo.lat,
      lon: weatherGeo.lon
    } : null;
    var setting = loadHome().setting;
    return api.resolveLocation({
      chosen: null,
      geoGranted: !!(weatherGeo && weatherGeo.granted),
      geo: geo,
      setting: setting
    });
  }

  function viewObs(parsed) {
    var api = pillApi();
    var zone = parsed.timezone || (api ? api.viewerZone() : "UTC");
    var today = api ? api.civilDay(Date.now(), zone) : "";
    var daily = (parsed.daily || []).map(function (day) {
      return {
        date: day.date,
        dayLabel: day.date === today ? tr("Today") : (day.date || ""),
        min: day.min,
        max: day.max,
        code: day.code
      };
    });
    var first = daily[0] || {};
    return {
      kind: "weather",
      source: parsed.source,
      updatedAt: parsed.updatedAt,
      timezone: zone,
      temp: parsed.temp,
      code: parsed.code,
      humidity: parsed.humidity,
      wind: parsed.wind,
      feels: parsed.feels,
      precipChance: parsed.precipChance,
      precipMm: parsed.precipMm,
      uv: parsed.uv,
      tempMin: first.min == null ? parsed.temp : first.min,
      tempMax: first.max == null ? parsed.temp : first.max,
      hourly: parsed.hourly || [],
      daily: daily
    };
  }

  function fetchJson(url) {
    return fetch(url, { method: "GET", credentials: "omit", cache: "no-store", redirect: "follow" }).then(function (res) {
      if (!res.ok) throw new Error("status");
      return res.json();
    });
  }

  function acceptWeather(json) {
    var api = pillApi();
    if (!api || !json) return null;
    var fetched = Number(json.fetchedAt) || Date.now();
    var body = json.payload && typeof json.payload === "object" ? json.payload : json;
    var parsed = api.parseOpenMeteo(body, fetched) || api.parseMetNo(body, fetched, api.viewerZone());
    if (!parsed) return null;
    parsed.updatedAt = fetched;
    var view = viewObs(parsed);
    if (api.flagStale(view, Date.now()).stale) return null;
    return view;
  }

  function fetchObservation(place) {
    var api = pillApi();
    if (!api || typeof fetch !== "function" || !place) return Promise.resolve(null);
    var direct = api.openMeteoUrl(place.lat, place.lon);
    return fetchJson(direct).then(function (json) {
      var obs = acceptWeather(json);
      if (!obs) throw new Error("bad");
      return obs;
    }).catch(function () {
      var base = api.apiBase(root);
      if (!base) return null;
      return fetchJson(base + "/v1/pills/weather?lat=" + encodeURIComponent(place.lat) + "&lon=" + encodeURIComponent(place.lon)).then(function (json) {
        return acceptWeather(json);
      }).catch(function () { return null; });
    });
  }

  function geocodeName(name) {
    var api = pillApi();
    if (!api || typeof fetch !== "function") return Promise.resolve(null);
    return fetchJson(api.geocodeUrl(name)).then(function (data) {
      var row = data && data.results && data.results[0];
      if (!row || row.latitude == null) throw new Error("empty");
      return { name: row.name, country: row.country || "", lat: row.latitude, lon: row.longitude };
    }).catch(function () {
      var base = api.apiBase(root);
      if (!base) return null;
      return fetchJson(base + "/v1/pills/geocode?name=" + encodeURIComponent(name)).then(function (data) {
        var row = data && data.results && data.results[0];
        if (!row || row.lat == null) return null;
        return { name: row.name, country: row.country || "", lat: Number(row.lat), lon: Number(row.lon) };
      }).catch(function () { return null; });
    });
  }

  function storeObs(id, obs) {
    var map = loadObs();
    map[id] = obs;
    obsState = map;
    saveObsMap();
  }

  /* Add a city the user named. A failed lookup does not invent a temperature. */
  function addPlace(cityName, cb) {
    var name = String(cityName || "").trim();
    if (!name) {
      notify(tr("Enter a city name"));
      return;
    }
    var id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!id) id = "place-" + Date.now();
    var existing = getPlace(id);
    if (existing) {
      if (!isPinned("weather:" + id)) togglePin("weather:" + id);
      openWeatherModal(id);
      if (cb) cb(existing);
      return existing;
    }
    return geocodeName(name).then(function (hit) {
      if (!hit) {
        notify(tr("Weather is unavailable"));
        if (cb) cb(null);
        return null;
      }
      var identity = { id: id, name: hit.name || name, country: hit.country || "", lat: hit.lat, lon: hit.lon, explicit: true };
      return fetchObservation(identity).then(function (obs) {
        if (!obs) {
          notify(tr("Weather is unavailable"));
          if (cb) cb(null);
          return;
        }
        var place = rememberPlace(identity, obs);
        var prefs = loadPrefs();
        var pillId = "weather:" + identity.id;
        if (prefs.pinnedIds.indexOf(pillId) === -1) prefs.pinnedIds.unshift(pillId);
        if (prefs.customOrder.indexOf(pillId) === -1) prefs.customOrder.unshift(pillId);
        savePrefs(prefs);
        refreshUI();
        notify(tr("Place added") + ": " + identity.name);
        if (cb) cb(place);
      });
    });
  }

  function setFallbackCity(cityName) {
    var name = String(cityName || "").trim();
    if (!name) {
      notify(tr("Enter a city name"));
      return Promise.resolve(null);
    }
    return geocodeName(name).then(function (hit) {
      if (!hit) {
        notify(tr("Weather is unavailable"));
        return null;
      }
      var setting = { id: "fallback", name: hit.name || name, country: hit.country || "", lat: hit.lat, lon: hit.lon };
      loadHome().setting = setting;
      saveHome();
      return fetchObservation(setting).then(function (obs) {
        if (!obs) {
          notify(tr("Weather is unavailable"));
          return;
        }
        storeObs(setting.id, obs);
        refreshUI();
        notify(tr("Place added") + ": " + setting.name);
      });
    });
  }

  function useMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      notify(tr("Location is off"));
      return;
    }
    navigator.geolocation.getCurrentPosition(function (pos) {
      weatherGeo = { granted: true, lat: pos.coords.latitude, lon: pos.coords.longitude };
      var identity = {
        id: "here",
        name: tr("Current location"),
        country: "",
        lat: weatherGeo.lat,
        lon: weatherGeo.lon,
        explicit: true
      };
      fetchObservation(identity).then(function (obs) {
        if (!obs) {
          notify(tr("Weather is unavailable"));
          return;
        }
        rememberPlace(identity, obs);
        refreshUI();
      });
    }, function () {
      notify(tr("Location is off"));
    }, { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 8000 });
  }

  function removePlace(placeId) {
    var list = identities();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === placeId) { idx = i; break; }
    }
    if (idx === -1) return;
    var removed = list.splice(idx, 1)[0];
    placesState = list;
    saveIdentities();
    var map = loadObs();
    delete map[placeId];
    obsState = map;
    saveObsMap();
    var home = loadHome();
    if (home.setting && home.setting.id === placeId) {
      home.setting = null;
      saveHome();
    }
    var prefs = loadPrefs();
    var pillId = "weather:" + placeId;
    var pinIdx = prefs.pinnedIds.indexOf(pillId);
    if (pinIdx !== -1) prefs.pinnedIds.splice(pinIdx, 1);
    var ordIdx = prefs.customOrder.indexOf(pillId);
    if (ordIdx !== -1) prefs.customOrder.splice(ordIdx, 1);
    savePrefs(prefs);
    if (activeWeatherModalId === placeId) closeWeatherModal();
    refreshUI();
    notify(tr("Place removed") + ": " + (removed ? removed.name : placeId));
  }

  /* HTML Generators */
  function getWeatherIcon(iconName) {
    return WEATHER_ICONS[iconName] || WEATHER_ICONS["generic"];
  }

  function ageText(updatedAt) {
    var api = pillApi();
    if (!api) return "";
    var phrase = api.updatedPhrase(updatedAt, Date.now());
    return tr(phrase.key, { count: phrase.count });
  }

  function marquee(text) {
    var safe = esc(text || "");
    return '<span class="sp-marquee" data-sp-marquee><span class="sp-marquee-clip"><span class="sp-marquee-track"><span class="sp-marquee-copy"><span class="sp-marquee-text">' + safe + '</span></span><span class="sp-marquee-copy" aria-hidden="true"><span class="sp-marquee-text">' + safe + '</span></span></span></span></span>';
  }

  function renderPill(place, unit, pinned) {
    if (!place || place.temp == null || place.updatedAt == null) return "";
    var api = pillApi();
    if (!api || api.flagStale({ kind: "weather", updatedAt: place.updatedAt }, Date.now()).stale) return "";
    var cond = codeToCondition(place.code);
    var u = unit || getUnit();
    var tempStr = formatTemp(place.temp, u);
    var rangeStr = formatTemp(place.tempMax, u) + " / " + formatTemp(place.tempMin, u);
    var condLabel = cond.name;
    var age = ageText(place.updatedAt);
    var pinBadge = pinned ? '<span class="pill-pin-mark" title="' + esc(tr("Pinned")) + '">📌</span>' : "";

    return '<button class="sc-pill wx-pill ' + esc(cond.css) + ' wx-pill-' + esc(place.id) + '" type="button" data-wx-id="' + esc(place.id) + '" data-updated="' + esc(place.updatedAt) + '" aria-label="' + esc(place.name) + " " + esc(tempStr) + " " + esc(condLabel) + " " + esc(age) + '">'
      + '<span class="wx-icon-ring">' + getWeatherIcon(cond.icon) + '</span>'
      + '<span class="sc-pill-content">'
      + '<span class="sc-pill-top"><span class="sc-badge is-live wx-badge is-temp">' + esc(tempStr) + '</span><span class="sc-pill-title">' + marquee(place.name) + '</span>' + pinBadge + '</span>'
      + '<span class="sc-pill-bottom"><span class="wx-cond">' + marquee(condLabel) + '</span><span class="wx-range">' + esc(rangeStr) + '</span></span>'
      + '</span>'
      + '<span class="pill-age">' + esc(age) + '</span>'
      + '<span class="sc-pill-arrow"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg></span>'
      + '</button>';
  }

  function pillsHtml() {
    var list = loadPlaces();
    var u = getUnit();
    if (isTypeDisabled("weather")) return "";
    return list.map(function (place) {
      var id = "weather:" + place.id;
      if (isHidden(id)) return "";
      var pinned = isPinned(id);
      var html = renderPill(place, u, pinned);
      if (!html) return "";
      return '<div class="sp-row-item" role="listitem">' + html + '</div>';
    }).join("");
  }

  /* Unified Pill Registry: combines Spaces, Soccer & Weather with Pinning, Ordering, Hiding & Category switches */
  function getAllPills(includeHidden) {
    var pills = [];
    var u = getUnit();
    var showHidden = !!includeHidden;

    // 1. Weather Pills
    var places = loadPlaces();
    if (!isTypeDisabled("weather")) {
      places.forEach(function (place) {
        var id = "weather:" + place.id;
        if (!showHidden && isHidden(id)) return;
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
    }

    // 2. Soccer Pills
    if (!isTypeDisabled("soccer") && root.SoccerScores && root.SoccerScores.loadTeams) {
      var teams = root.SoccerScores.loadTeams();
      teams.forEach(function (team) {
        var id = "soccer:" + team.id;
        if (isHidden(id)) return;
        var pinned = isPinned(id);
        var renderFn = root.SoccerScores.renderPill || (root.SoccerScoresLogic && root.SoccerScoresLogic.renderPill);
        var rendered = renderFn ? renderFn(team) : "";
        if (!rendered) return;
        var live = team.match && (team.match.status === "live" || team.match.status === "halftime");
        pills.push({
          id: id,
          type: "soccer",
          title: team.nameKey,
          badgeText: live ? tr("LIVE") : (team.match && team.match.status === "scheduled" ? tr("Scheduled") : tr("Full Time")),
          isPinned: pinned,
          html: '<div class="sp-row-item" role="listitem">' + rendered + '</div>'
        });
      });
    }

    // 3. Space Pills
    if (!isTypeDisabled("space") && root.Spaces && root.Spaces.homePillsHtml) {
      var id = "space:superintelmusic";
      if (showHidden || !isHidden(id)) {
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

  function precipLabel(place) {
    if (place && place.precipChance != null && place.precipChance !== "") return tr("Rain chance");
    return tr("Precipitation");
  }

  function precipValue(place) {
    if (!place) return "—";
    if (place.precipChance != null && place.precipChance !== "") return Math.round(Number(place.precipChance)) + "%";
    if (place.precipMm != null && place.precipMm !== "") {
      var mm = Math.round(Number(place.precipMm) * 10) / 10;
      return mm + " mm";
    }
    return "—";
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
      + '<span class="wx-hero-sub">' + esc(tr("High")) + " " + esc(formatTemp(place.tempMax, u)) + " • " + esc(tr("Low")) + " " + esc(formatTemp(place.tempMin, u)) + (place.feels == null ? "" : " • " + esc(tr("Feels like")) + " " + esc(formatTemp(place.feels, u))) + " • " + esc(ageText(place.updatedAt)) + '</span>'
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
      + '<div class="wx-stat-card"><span class="wx-stat-label">💧 ' + esc(tr("Humidity")) + '</span><span class="wx-stat-val">' + (place.humidity == null ? "—" : esc(place.humidity) + "%") + '</span></div>'
      + '<div class="wx-stat-card"><span class="wx-stat-label">💨 ' + esc(tr("Wind")) + '</span><span class="wx-stat-val">' + (place.wind == null ? "—" : esc(Math.round(place.wind)) + " km/h") + '</span></div>'
      + '<div class="wx-stat-card"><span class="wx-stat-label">☔ ' + esc(precipLabel(place)) + '</span><span class="wx-stat-val">' + esc(precipValue(place)) + '</span></div>'
      + '<div class="wx-stat-card"><span class="wx-stat-label">☀️ ' + esc(tr("UV Index")) + '</span><span class="wx-stat-val">' + (place.uv == null ? "—" : esc(place.uv)) + '</span></div>'
      + '</div>'
      + (hourlyHtml ? '<div class="wx-section-heading">' + esc(tr("Hourly Forecast")) + '</div>' + hourlyHtml : '')
      + (dailyHtml ? '<div class="wx-section-heading">' + esc(tr("Daily Forecast")) + '</div>' + dailyHtml : '')
      + '</div>'
      + '</div>';
  }

  /* Manage Pills Modal HTML */
  function typeLabel(type) {
    if (type === "weather") return tr("Weather");
    if (type === "soccer") return tr("Matches");
    return tr("Radio");
  }

  function renderManageModalHtml() {
    var all = getAllPills();
    var hiddenItems = getAllPills(true).filter(function (p) { return isHidden(p.id); });
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
        + '<button class="manage-hide-btn" type="button" data-act="pill-hide" data-id="' + esc(item.id) + '" aria-label="' + esc(tr("Hide pill")) + '" title="' + esc(tr("Hide pill")) + '">' + esc(tr("Hide")) + '</button>'
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
        + '<button class="manage-hide-btn" type="button" data-act="pill-hide" data-id="' + esc(item.id) + '" aria-label="' + esc(tr("Hide pill")) + '" title="' + esc(tr("Hide pill")) + '">' + esc(tr("Hide")) + '</button>'
        + '</div>'
        + '</div>';
    }).join("") : '';

    var hiddenRows = hiddenItems.length ? hiddenItems.map(function (item) {
      return '<div class="manage-pill-item is-hidden">'
        + '<div class="manage-pill-info">'
        + '<span class="manage-pill-type-tag is-' + esc(item.type) + '">' + esc(item.type) + '</span>'
        + '<span class="manage-pill-name">' + esc(item.title) + '</span>'
        + '</div>'
        + '<div class="manage-pill-actions">'
        + '<button class="manage-pin-btn" type="button" data-act="pill-show" data-id="' + esc(item.id) + '" aria-label="' + esc(tr("Show pill")) + '">' + esc(tr("Show")) + '</button>'
        + '</div>'
        + '</div>';
    }).join("") : "";

    var typeRows = PILL_TYPES.map(function (type) {
      var off = isTypeDisabled(type);
      return '<div class="manage-pill-item">'
        + '<div class="manage-pill-info">'
        + '<span class="manage-pill-type-tag is-' + esc(type) + '">' + esc(type) + '</span>'
        + '<span class="manage-pill-name">' + esc(typeLabel(type)) + '</span>'
        + '</div>'
        + '<div class="manage-pill-actions">'
        + '<button class="manage-toggle-btn' + (off ? " is-off" : " is-on") + '" type="button" data-act="type-toggle" data-type="' + esc(type) + '" aria-pressed="' + (off ? "false" : "true") + '">' + (off ? esc(tr("Off")) : esc(tr("On"))) + '</button>'
        + '</div>'
        + '</div>';
    }).join("");

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
      + (hiddenRows ? '<div class="wx-section-heading">' + esc(tr("Hidden Pills")) + ' (' + hiddenItems.length + ')</div><div class="manage-pills-list">' + hiddenRows + '</div>' : '')
      + '<div class="wx-section-heading">' + esc(tr("Pill types")) + '</div>'
      + '<div class="manage-pills-list">' + typeRows + '</div>'
      + '<div class="wx-section-heading">' + esc(tr("Add Place")) + '</div>'
      + '<form class="wx-add-form" data-act="add-form">'
      + '<input id="wx-add-input" class="wx-add-input" type="text" placeholder="' + esc(tr("Enter city or place name...")) + '" autocomplete="off" />'
      + '<button class="wx-add-btn" type="submit">' + esc(tr("Add")) + '</button>'
      + '</form>'
      + '<div class="wx-section-heading">' + esc(tr("Home city")) + '</div>'
      + '<button class="wx-action-btn" type="button" data-act="use-location">' + esc(tr("Use my location")) + '</button>'
      + '<form class="wx-add-form" data-act="fallback-form">'
      + '<input id="wx-fallback-input" class="wx-add-input" type="text" placeholder="' + esc(tr("Home city")) + '" autocomplete="off" />'
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
    /* The row is rebuilt below, so remember where the user scrolled to and
       paint it back, otherwise the pills jump to the start on every update. */
    if (typeof window !== "undefined" && window.ViktorychHScroll && window.ViktorychHScroll.remember) window.ViktorychHScroll.remember();
    var prevRow = document.querySelector(".sp-row");
    var prevLeft = prevRow ? prevRow.scrollLeft : 0;
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

    if (prevLeft) {
      var restoreRowScroll = function () {
        var nextRow = document.querySelector(".sp-row");
        if (nextRow && nextRow.scrollLeft !== prevLeft) nextRow.scrollLeft = prevLeft;
      };
      restoreRowScroll();
      if (typeof window !== "undefined" && window.requestAnimationFrame) {
        window.requestAnimationFrame(restoreRowScroll);
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
        } else if (mAct === "pill-hide") {
          event.preventDefault();
          setHidden(pId, true);
        } else if (mAct === "pill-show") {
          event.preventDefault();
          setHidden(pId, false);
        } else if (mAct === "type-toggle") {
          event.preventDefault();
          toggleTypeDisabled(mActBtn.getAttribute("data-type"));
        } else if (mAct === "pill-move") {
          event.preventDefault();
          var dir = parseInt(mActBtn.getAttribute("data-dir") || "0", 10);
          reorderPill(pId, dir);
        } else if (mAct === "quick-add") {
          event.preventDefault();
          var city = mActBtn.getAttribute("data-city");
          addPlace(city);
        } else if (mAct === "use-location") {
          event.preventDefault();
          useMyLocation();
        } else if (mAct === "reset-defaults") {
          event.preventDefault();
          resetPrefs();
        }
      }
    });

    document.addEventListener("submit", function (event) {
      var target = event.target;
      if (!target || !target.matches) return;
      if (target.matches("[data-act='add-form']")) {
        event.preventDefault();
        var input = document.getElementById("wx-add-input");
        if (input && input.value) {
          addPlace(input.value);
          input.value = "";
        }
      } else if (target.matches("[data-act='fallback-form']")) {
        event.preventDefault();
        var fallback = document.getElementById("wx-fallback-input");
        if (fallback && fallback.value) {
          setFallbackCity(fallback.value);
          fallback.value = "";
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

  function readGrantedGeo() {
    if (typeof navigator === "undefined" || !navigator.permissions || typeof navigator.permissions.query !== "function") return Promise.resolve();
    return navigator.permissions.query({ name: "geolocation" }).then(function (status) {
      if (!status || status.state !== "granted" || !navigator.geolocation) return null;
      return new Promise(function (resolve) {
        navigator.geolocation.getCurrentPosition(function (pos) {
          weatherGeo = { granted: true, lat: pos.coords.latitude, lon: pos.coords.longitude };
          resolve(weatherGeo);
        }, function () { resolve(null); }, { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 8000 });
      });
    }).catch(function () { return null; });
  }

  function weatherTargets() {
    var list = identities().slice();
    var home = resolvedHome();
    if (home && !list.some(function (place) { return place.id === home.id; })) list.unshift(home);
    return list;
  }

  function armWeather() {
    if (weatherTimer) clearTimeout(weatherTimer);
    if (typeof setTimeout !== "function") return;
    weatherTimer = setTimeout(function () {
      weatherTimer = null;
      refreshWeather();
    }, 12 * 60 * 1000);
  }

  function refreshWeather() {
    var api = pillApi();
    if (!api || weatherFetching || typeof fetch !== "function") return Promise.resolve(false);
    if (isTypeDisabled("weather")) return Promise.resolve(false);
    weatherFetching = true;
    return readGrantedGeo().then(function () {
      var jobs = weatherTargets().map(function (place) {
        var existing = loadObs()[place.id];
        if (existing && !api.flagStale({ kind: "weather", updatedAt: existing.updatedAt }, Date.now()).stale) return Promise.resolve(false);
        return fetchObservation(place).then(function (obs) {
          if (!obs) return false;
          if (place.explicit) rememberPlace(place, obs);
          else storeObs(place.id, obs);
          return true;
        });
      });
      return Promise.all(jobs).then(function (flags) {
        weatherFetching = false;
        if (flags.some(Boolean)) refreshUI();
        armWeather();
        return true;
      });
    }).catch(function () {
      weatherFetching = false;
      armWeather();
      return false;
    });
  }

  function afterRender(route) {
    if (route && route.name && route.name !== "home") return;
    if (isTypeDisabled("weather")) return;
    var api = pillApi();
    if (!api) return;
    var needs = weatherTargets().some(function (place) {
      var obs = loadObs()[place.id];
      return !obs || api.flagStale({ kind: "weather", updatedAt: obs.updatedAt }, Date.now()).stale;
    });
    if (!needs) {
      armWeather();
      return;
    }
    refreshWeather();
  }

  var api = {
    loadPlaces: loadPlaces,
    savePlaces: savePlaces,
    getPlace: getPlace,
    addPlace: addPlace,
    removePlace: removePlace,
    setFallbackCity: setFallbackCity,
    useMyLocation: useMyLocation,
    rememberPlace: rememberPlace,
    refreshWeather: refreshWeather,
    loadPrefs: loadPrefs,
    savePrefs: savePrefs,
    isPinned: isPinned,
    togglePin: togglePin,
    isHidden: isHidden,
    setHidden: setHidden,
    toggleHidden: toggleHidden,
    isTypeDisabled: isTypeDisabled,
    setTypeDisabled: setTypeDisabled,
    toggleTypeDisabled: toggleTypeDisabled,
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
    isHidden: isHidden,
    setHidden: setHidden,
    isTypeDisabled: isTypeDisabled,
    setTypeDisabled: setTypeDisabled,
    reorderPill: reorderPill,
    renderPill: renderPill,
    pillsHtml: pillsHtml,
    getAllPills: getAllPills,
    unifiedRowHtml: unifiedRowHtml,
    codeToCondition: codeToCondition,
    formatTemp: formatTemp,
    getDefaultPlaces: getDefaultPlaces,
    rememberPlace: rememberPlace,
    resolvedHome: resolvedHome,
    setFallbackCity: setFallbackCity,
    useMyLocation: useMyLocation,
    refreshWeather: refreshWeather
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
