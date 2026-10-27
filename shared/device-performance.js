/* One device-performance record.
   Level and profile are the same choice: light is lite, balanced is balanced,
   max is max. Peer-assisted media keeps its own fields in this record. */

import { UPLOAD_CAPS, UPLOAD_DEFAULT } from "./peer-media.js";

export const DEVICE_PERFORMANCE_KEY = "viktorychapp-device-performance-v1";

export function profileOf(raw) {
  const src = raw && typeof raw === "object" ? raw : { profile: raw };
  const text = String(src.level || src.profile || src.performance || src.mode || "balanced").toLowerCase();
  if (text === "max" || text === "high" || text === "full") return "max";
  if (text === "lite" || text === "light" || text === "low" || text === "saver" || text === "battery") return "lite";
  return "balanced";
}

export function levelOf(raw) {
  return profileOf(raw) === "lite" ? "light" : profileOf(raw);
}

export function normalizeToggle(value) {
  if (value === true || value === "on") return "on";
  if (value === false || value === "off") return "off";
  return "auto";
}

export function normalizeCap(value) {
  const n = Number(value) || 0;
  return UPLOAD_CAPS.indexOf(n) >= 0 ? n : UPLOAD_DEFAULT;
}

export function peerSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const profile = profileOf(src);
  return {
    profile: profile,
    level: profile === "lite" ? "light" : profile,
    peerMedia: normalizeToggle(src.peerMedia),
    peerUploadCap: normalizeCap(src.peerUploadCap),
    peerShareWhileWatching: src.peerShareWhileWatching !== false
  };
}

export function patchDevicePerformance(raw, patch) {
  const base = raw && typeof raw === "object" ? Object.assign({}, raw) : {};
  const next = patch && typeof patch === "object" ? patch : {};
  const levelIncoming = next.level != null || next.profile != null || next.performance != null || next.mode != null;
  if (levelIncoming || base.level != null || base.profile != null) {
    const profile = levelIncoming
      ? profileOf({ level: next.level, profile: next.profile, performance: next.performance, mode: next.mode })
      : profileOf(base);
    base.profile = profile;
    base.level = profile === "lite" ? "light" : profile;
  }
  if (next.peerMedia != null) base.peerMedia = normalizeToggle(next.peerMedia);
  if (next.peerUploadCap != null) base.peerUploadCap = normalizeCap(next.peerUploadCap);
  if (typeof next.peerShareWhileWatching === "boolean") base.peerShareWhileWatching = next.peerShareWhileWatching;
  return base;
}

export function loadDevicePerformance(storage) {
  try {
    const text = storage && storage.getItem ? storage.getItem(DEVICE_PERFORMANCE_KEY) : "";
    const parsed = text ? JSON.parse(text) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

export function saveDevicePerformance(storage, value) {
  if (!storage || !storage.setItem) return;
  storage.setItem(DEVICE_PERFORMANCE_KEY, JSON.stringify(value && typeof value === "object" ? value : {}));
}

const api = {
  KEY: DEVICE_PERFORMANCE_KEY,
  profileOf: profileOf,
  peerSettings: peerSettings,
  patchDevicePerformance: patchDevicePerformance,
  loadDevicePerformance: loadDevicePerformance,
  saveDevicePerformance: saveDevicePerformance
};

const scope = typeof globalThis !== "undefined" ? globalThis : null;
if (scope && scope.window && !scope.window.ViktorychDevicePerformance) scope.window.ViktorychDevicePerformance = api;
