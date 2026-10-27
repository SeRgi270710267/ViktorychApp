// Pure decisions for the minute TikTok live watcher.
//
// A GitHub `*/5` schedule is only a hint: the live poller in this repository
// ran every two to six hours, so most lives were over before a recorder
// started. The Worker cron asks these helpers what to do once a minute.
// Nothing here performs I/O, so the rules can be checked without a network.

export const WATCH_LIMIT = 4;
export const WATCH_RETRY_MS = 10 * 60 * 1000;
export const WATCH_HEARTBEAT_MS = 8 * 60 * 1000;
export const WATCH_PART_MS = 3 * 60 * 1000;

function parseMs(value) {
  const at = Date.parse(String(value || ""));
  return Number.isFinite(at) ? at : 0;
}

export function fresh(value, nowMs, ms) {
  const at = parseMs(value);
  const now = Number(nowMs) || 0;
  return at > 0 && now >= at && now - at < Math.max(1, Number(ms) || 0);
}

// Added-account order is the priority. A cron invocation checks a slice of
// the list so a large directory cannot exceed the Worker subrequest budget.
export function watchHandles(doc, limit = WATCH_LIMIT, minute = 0) {
  const live = doc && doc.live && typeof doc.live === "object" ? doc.live : {};
  const names = Object.keys(live)
    .map((name) => String(name || ""))
    .filter((name) => /^[A-Za-z0-9._]{2,24}$/.test(name))
    .sort();
  const size = Math.max(1, Math.min(Number(limit) || WATCH_LIMIT, 12));
  if (names.length <= size) return names;
  const start = (((Number(minute) || 0) * size) % names.length + names.length) % names.length;
  const first = names.slice(start, start + size);
  const overflow = start + size - names.length;
  return overflow > 0 ? first.concat(names.slice(0, overflow)) : first;
}

// Decide whether a live room needs a recorder, another part, or nothing.
// `job` is owner/live-jobs/<handle>.json, `marker` is the last dispatch we
// made for this room, and `roomId` is the room TikTok returned just now.
export function watchDecision(job, marker, roomId, nowMs) {
  const room = String(roomId || "");
  const active = job && job.active && typeof job.active === "object" ? job.active : null;
  const saved = job && Array.isArray(job.saved) ? job.saved : [];
  const mark = marker && typeof marker === "object" ? marker : {};
  const now = Number(nowMs) || 0;

  if (room && String(mark.roomId || "") === room && fresh(mark.at, now, WATCH_RETRY_MS)) {
    return { action: "skip", part: 0, why: "dispatched" };
  }
  if (saved.some((row) => row && String(row.roomId || "") === room)) {
    return { action: "skip", part: 0, why: "saved" };
  }
  if (!active) return { action: "record", part: 1, why: "new" };

  const activeRoom = String(active.roomId || "");
  const part = Math.max(1, Number(active.part) || 1);
  if (!room || activeRoom !== room) {
    const busy = !!active.capturing && fresh(active.heartbeat, now, WATCH_HEARTBEAT_MS);
    if (busy) return { action: "skip", part: 0, why: "other" };
    return { action: "record", part: 1, why: "new" };
  }
  if (active.capturing) {
    if (fresh(active.heartbeat, now, WATCH_HEARTBEAT_MS)) {
      return { action: "skip", part: 0, why: "recording" };
    }
    // The runner died. Start the part again; it is the only copy we can get.
    return { action: "record", part, why: "stale" };
  }
  if (active.needsPart) {
    if (fresh(active.dispatchedAt, now, WATCH_PART_MS)) {
      return { action: "skip", part: 0, why: "part" };
    }
    return { action: "part", part, why: "part" };
  }
  if (active.captureDone) {
    // Capture is over. Wait for the uploader to mark the room saved instead
    // of recording the same room a second time.
    return { action: "skip", part: 0, why: "captureDone" };
  }
  if (!active.capturing && fresh(active.dispatchedAt, now, WATCH_RETRY_MS)) {
    // A dispatch is out but has not opened its capture yet.
    return { action: "skip", part: 0, why: "waiting" };
  }
  if (String(active.state || "") === "queued") {
    return { action: "skip", part: 0, why: "queued" };
  }
  if (String(active.state || "") === "blocked") {
    return { action: "record", part, why: "unblocked" };
  }
  // Recording is claimed, a dispatch never opened a capture, or the row is
  // otherwise unlabeled. A fresh attempt is the only way this live gets its
  // copy, and the mark above already throttles how often it repeats.
  return { action: "record", part, why: "retry" };
}

// An uploader is worth a runner only when a capture is open, or a finished
// part still has segments. A leftover segment count on a dead or blocked row
// is not a queue: the uploader would start, find nothing, and be called again.
export function needsUpload(active, nowMs) {
  if (!active || typeof active !== "object") return false;
  if (String(active.state || "") === "blocked") return false;
  if (!!active.capturing && fresh(active.heartbeat, nowMs, WATCH_HEARTBEAT_MS)) return true;
  const segments = Number(active.segments || 0) > 0;
  return segments && (!!active.captureDone || !!active.needsPart);
}

// The uploader writes owner/live-upload/<slot>.json on every pass.
export function uploaderStale(beat, nowMs, ms = 5 * 60 * 1000) {
  if (!beat || !beat.at) return true;
  return !fresh(beat.at, nowMs, ms);
}
