/* Voice, video and screen share for native Messages servers.
   A WebRTC full mesh: every person sends audio (and camera or screen) straight
   to every other person. The server room (a Durable Object) only relays the
   offers, answers and ICE candidates. Only public STUN servers are used, no
   TURN relay, so two people behind strict NATs (some mobile carriers, many
   offices and campus networks, symmetric NAT) may never connect; that peer
   shows "Couldn't connect" while everyone else keeps talking.
   Each peer connection carries three fixed transceivers: audio, camera,
   screen. Turning the camera or screen on and off swaps tracks with
   replaceTrack, so nothing renegotiates after the first offer.
   ES5 on purpose: older iOS Safari runs this file. */
(function () {
  "use strict";
  var ICE = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
  var hooks = null;
  var V = {
    sid: "", cid: "", status: "idle", why: "", mid: "",
    mu: false, df: false, cam: false, scr: false, sm: false,
    peers: {}, roster: {}, speaking: {}, ws: null, want: false, retry: 0, retryTimer: 0,
    mic: null, camTrack: null, scrTrack: null, ctx: null, meters: {}, meterTimer: 0, joinedAt: 0
  };
  var listeners = [];
  var media = {};
  var sinkBox = null;

  function emit() { listeners.forEach(function (fn) { try { fn(V); } catch (err) { /* a painter failed; the next change repaints */ } }); }
  function supported() {
    return typeof window !== "undefined" && !!window.RTCPeerConnection && !!window.RTCPeerConnection.prototype.addTransceiver && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }
  function canScreen() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "");
  }
  function state() { return { mu: V.mu || V.sm, df: V.df, cam: V.cam, scr: V.scr }; }
  function sendWs(obj) {
    if (V.ws && V.ws.readyState === 1) { try { V.ws.send(JSON.stringify(obj)); return true; } catch (err) { return false; } }
    return false;
  }
  function pushState() { sendWs({ op: "vstate", st: state() }); emit(); }

  /* ---------- local media ---------- */
  function getMic() {
    if (V.mic && V.mic.readyState === "live") return Promise.resolve(V.mic);
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }).then(function (stream) {
      V.mic = stream.getAudioTracks()[0] || null;
      if (V.mic) { V.mic.enabled = !(V.mu || V.sm || V.df); meter("me", new MediaStream([V.mic])); }
      return V.mic;
    });
  }
  function senders(pc) {
    var t = pc.getTransceivers ? pc.getTransceivers() : [];
    return { audio: t[0] && t[0].sender, cam: t[1] && t[1].sender, scr: t[2] && t[2].sender };
  }
  function eachPeer(fn) { Object.keys(V.peers).forEach(function (id) { fn(V.peers[id], id); }); }
  function setTracks(p) {
    var s = senders(p.pc);
    var jobs = [];
    if (s.audio) jobs.push(s.audio.replaceTrack(V.mic || null));
    if (s.cam) jobs.push(s.cam.replaceTrack(V.cam ? V.camTrack : null));
    if (s.scr) jobs.push(s.scr.replaceTrack(V.scr ? V.scrTrack : null));
    return Promise.all(jobs).catch(function () { /* the peer is closing */ });
  }
  function localVideo(kind) {
    var track = kind === "scr" ? V.scrTrack : V.camTrack;
    var key = "me:" + kind;
    var el = media[key];
    if (!track) { if (el) { el.srcObject = null; } return null; }
    if (!el) { el = media[key] = makeVideo(true); }
    if (!el.srcObject || el.srcObject.getVideoTracks()[0] !== track) el.srcObject = new MediaStream([track]);
    playSoon(el);
    return el;
  }

  /* ---------- media elements ---------- */
  function makeVideo(muted) {
    var el = document.createElement("video");
    el.setAttribute("playsinline", "");
    el.setAttribute("autoplay", "");
    el.playsInline = true;
    el.autoplay = true;
    el.muted = !!muted;
    el.className = "vsrv-vvideo";
    el.setAttribute("data-voice", "");
    return el;
  }
  function playSoon(el) {
    try { var p = el.play(); if (p && p.catch) p.catch(function () { /* waits for the next tap */ }); } catch (err) { /* old browsers play on their own */ }
  }
  function sinks() {
    if (sinkBox && sinkBox.parentNode) return sinkBox;
    sinkBox = document.createElement("div");
    sinkBox.setAttribute("aria-hidden", "true");
    sinkBox.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-9999px;top:0";
    document.body.appendChild(sinkBox);
    return sinkBox;
  }
  function peerAudio(p) {
    if (!p.audioEl) {
      p.audioEl = document.createElement("audio");
      p.audioEl.setAttribute("autoplay", "");
      p.audioEl.setAttribute("playsinline", "");
      p.audioEl.setAttribute("data-voice", "");
      sinks().appendChild(p.audioEl);
    }
    return p.audioEl;
  }
  function applyAudio(p) {
    if (!p.audioEl) return;
    var st = (V.roster[p.id] && V.roster[p.id].st) || {};
    p.audioEl.muted = V.df || !!p.localMute || !!st.sm;
    p.audioEl.volume = Math.max(0, Math.min(1, p.volume == null ? 1 : p.volume));
  }
  function unlockAudio() {
    eachPeer(function (p) { if (p.audioEl) playSoon(p.audioEl); });
    if (V.ctx && V.ctx.state === "suspended" && V.ctx.resume) V.ctx.resume();
  }

  /* ---------- speaking meters ---------- */
  function audioCtx() {
    if (V.ctx) return V.ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { V.ctx = new AC(); } catch (err) { V.ctx = null; }
    return V.ctx;
  }
  function meter(id, stream) {
    var ctx = audioCtx();
    if (!ctx || !stream) return;
    dropMeter(id);
    try {
      var src = ctx.createMediaStreamSource(stream);
      var an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      V.meters[id] = { src: src, an: an, buf: new Uint8Array(an.fftSize), hot: 0 };
    } catch (err) { return; }
    if (!V.meterTimer) V.meterTimer = setInterval(readMeters, 120);
  }
  function dropMeter(id) {
    var m = V.meters[id];
    if (!m) return;
    try { m.src.disconnect(); } catch (err) { /* already gone */ }
    delete V.meters[id];
    delete V.speaking[id];
  }
  function readMeters() {
    var changed = false;
    Object.keys(V.meters).forEach(function (id) {
      var m = V.meters[id];
      m.an.getByteTimeDomainData(m.buf);
      var sum = 0;
      for (var i = 0; i < m.buf.length; i += 1) { var d = (m.buf[i] - 128) / 128; sum += d * d; }
      var rms = Math.sqrt(sum / m.buf.length);
      var muted = id === "me" ? (V.mu || V.sm) : !!(V.roster[id] && V.roster[id].st && V.roster[id].st.mu);
      if (rms > 0.04 && !muted) m.hot = Date.now() + 350;
      var on = m.hot > Date.now();
      if (!!V.speaking[id] !== on) { V.speaking[id] = on; changed = true; }
    });
    if (changed) listeners.forEach(function (fn) { try { fn(V, "speaking"); } catch (err) { /* ignore */ } });
  }

  /* ---------- peers ---------- */
  function peer(id, initiator) {
    if (V.peers[id]) return V.peers[id];
    var pc;
    try { pc = new RTCPeerConnection({ iceServers: ICE, bundlePolicy: "max-bundle" }); }
    catch (err) { return null; }
    var p = { id: id, pc: pc, initiator: !!initiator, queue: [], conn: "connecting", restarts: 0, haveRemote: false, volume: 1 };
    V.peers[id] = p;
    if (initiator) {
      pc.addTransceiver("audio", { direction: "sendrecv" });
      pc.addTransceiver("video", { direction: "sendrecv" });
      pc.addTransceiver("video", { direction: "sendrecv" });
    }
    pc.onicecandidate = function (ev) { if (ev.candidate) sendWs({ op: "rtc", to: id, d: { t: "ice", c: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate } }); };
    pc.ontrack = function () { wireRemote(p); };
    pc.oniceconnectionstatechange = function () {
      var s = pc.iceConnectionState;
      if (s === "connected" || s === "completed") { p.conn = "connected"; p.restarts = 0; clearTimeout(p.failTimer); }
      else if (s === "failed") { recover(p); }
      else if (s === "disconnected") { p.conn = "unstable"; clearTimeout(p.failTimer); p.failTimer = setTimeout(function () { if (pc.iceConnectionState === "disconnected") recover(p); }, 5000); }
      emit();
    };
    setTracks(p);
    return p;
  }
  function wireRemote(p) {
    var t = p.pc.getTransceivers ? p.pc.getTransceivers() : [];
    var a = t[0] && t[0].receiver && t[0].receiver.track;
    if (a) {
      var el = peerAudio(p);
      if (!el.srcObject || el.srcObject.getAudioTracks()[0] !== a) { el.srcObject = new MediaStream([a]); meter(p.id, el.srcObject); }
      applyAudio(p);
      playSoon(el);
    }
    ["cam", "scr"].forEach(function (kind, i) {
      var track = t[i + 1] && t[i + 1].receiver && t[i + 1].receiver.track;
      if (!track) return;
      var key = p.id + ":" + kind;
      var v = media[key] || (media[key] = makeVideo(true));
      if (!v.srcObject || v.srcObject.getVideoTracks()[0] !== track) v.srcObject = new MediaStream([track]);
      playSoon(v);
    });
    emit();
  }
  function recover(p) {
    clearTimeout(p.failTimer);
    if (p.restarts >= 2) { p.conn = "failed"; emit(); return; }
    p.restarts += 1;
    p.conn = "connecting";
    if (p.initiator) offer(p, true);
    else sendWs({ op: "rtc", to: p.id, d: { t: "restart" } });
    emit();
  }
  function offer(p, restart) {
    var pc = p.pc;
    return pc.createOffer(restart ? { iceRestart: true } : {}).then(function (o) { return pc.setLocalDescription(o); }).then(function () {
      sendWs({ op: "rtc", to: p.id, d: { t: "offer", sdp: pc.localDescription.sdp } });
    }).catch(function () { p.conn = "failed"; emit(); });
  }
  function drainIce(p) {
    var q = p.queue; p.queue = [];
    q.forEach(function (c) { p.pc.addIceCandidate(c).catch(function () { /* stale candidate */ }); });
  }
  function onSignal(from, d) {
    if (!d || !V.cid) return;
    if (d.t === "offer") {
      var p = V.peers[from];
      if (p && p.initiator && !p.haveRemote) {
        /* Both sides offered at once; the lower id keeps its offer. */
        if (V.mid < from) return;
        dropPeer(from);
        p = null;
      }
      p = p || peer(from, false);
      if (!p) return;
      p.pc.setRemoteDescription({ type: "offer", sdp: String(d.sdp || "") }).then(function () {
        p.haveRemote = true;
        (p.pc.getTransceivers ? p.pc.getTransceivers() : []).forEach(function (t) { try { t.direction = "sendrecv"; } catch (err) { /* old Safari keeps the offer's */ } });
        drainIce(p);
        return setTracks(p);
      }).then(function () { return p.pc.createAnswer(); }).then(function (a) { return p.pc.setLocalDescription(a); }).then(function () {
        sendWs({ op: "rtc", to: from, d: { t: "answer", sdp: p.pc.localDescription.sdp } });
        wireRemote(p);
      }).catch(function () { p.conn = "failed"; emit(); });
      return;
    }
    var q = V.peers[from];
    if (!q) return;
    if (d.t === "answer") {
      q.pc.setRemoteDescription({ type: "answer", sdp: String(d.sdp || "") }).then(function () { q.haveRemote = true; drainIce(q); wireRemote(q); }).catch(function () { q.conn = "failed"; emit(); });
    } else if (d.t === "ice" && d.c) {
      if (q.haveRemote) q.pc.addIceCandidate(d.c).catch(function () { /* stale candidate */ });
      else q.queue.push(d.c);
    } else if (d.t === "restart" && q.initiator) {
      if (q.restarts < 3) { q.restarts += 1; offer(q, true); }
    }
  }
  function dropPeer(id) {
    var p = V.peers[id];
    if (!p) return;
    clearTimeout(p.failTimer);
    try { p.pc.close(); } catch (err) { /* closed */ }
    if (p.audioEl) { p.audioEl.srcObject = null; if (p.audioEl.parentNode) p.audioEl.parentNode.removeChild(p.audioEl); }
    ["cam", "scr"].forEach(function (k) { var v = media[id + ":" + k]; if (v) { v.srcObject = null; if (v.parentNode) v.parentNode.removeChild(v); delete media[id + ":" + k]; } });
    dropMeter(id);
    delete V.peers[id];
  }

  /* ---------- the voice socket ---------- */
  function connect() {
    if (!V.want || !hooks) return;
    var sid = V.sid;
    hooks.call("/" + sid + "/ticket", { method: "POST", body: {} }).then(function (res) {
      if (!V.want || V.sid !== sid) return;
      if (res.status !== 200 || !res.body.ticket) { if (res.status === 403) { fail("perm"); return; } retry(); return; }
      var url = hooks.api().replace(/^http/i, "ws") + "/v1/servers/ws?s=" + sid + "&k=v&ticket=" + encodeURIComponent(res.body.ticket);
      var ws;
      try { ws = new WebSocket(url); } catch (err) { retry(); return; }
      V.ws = ws;
      ws.onopen = function () { V.retry = 0; sendWs({ op: "vjoin", c: V.cid, st: state() }); };
      ws.onmessage = function (ev) { onMessage(ws, ev.data); };
      ws.onclose = function () {
        if (V.ws !== ws) return;
        V.ws = null;
        if (V.want) { V.status = "reconnecting"; emit(); retry(); }
      };
      ws.onerror = function () { /* onclose follows */ };
    });
  }
  function retry() {
    clearTimeout(V.retryTimer);
    if (!V.want) return;
    V.retry = Math.min(V.retry + 1, 6);
    V.retryTimer = setTimeout(connect, Math.min(15000, 600 * Math.pow(2, V.retry - 1)));
  }
  function onMessage(ws, raw) {
    if (ws !== V.ws) return;
    var msg;
    try { msg = JSON.parse(String(raw)); } catch (err) { return; }
    if (!msg) return;
    if (msg.op === "ready") { V.mid = msg.me || V.mid; V.roster = msg.voice || {}; return; }
    if (msg.op === "vready") {
      V.status = "connected";
      V.joinedAt = V.joinedAt || Date.now();
      /* The room announces a leave whenever a voice socket closes, so the
         others have already dropped their side: start every peer fresh. */
      Object.keys(V.peers).forEach(dropPeer);
      (msg.peers || []).forEach(function (row) {
        V.roster[row.a] = { c: V.cid, st: row.st || {}, j: row.j || 0 };
        var p = peer(row.a, true);
        if (p) offer(p, false);
      });
      V.roster[V.mid] = { c: V.cid, st: state(), j: V.joinedAt };
      emit();
      return;
    }
    if (msg.op === "voice") {
      if (msg.c) V.roster[msg.a] = { c: msg.c, st: msg.st || {}, j: msg.j || 0 };
      else delete V.roster[msg.a];
      if (msg.a === V.mid) {
        var st = msg.st || {};
        if (msg.c === V.cid && !!st.sm !== V.sm) { V.sm = !!st.sm; if (V.mic) V.mic.enabled = !(V.mu || V.sm || V.df); }
      } else if (!msg.c || msg.c !== V.cid) dropPeer(msg.a);
      else if (V.peers[msg.a]) applyAudio(V.peers[msg.a]);
      emit();
      return;
    }
    if (msg.op === "rtc") { onSignal(msg.from, msg.d); return; }
    if (msg.op === "verr") { fail(msg.why || "error"); return; }
    if (msg.op === "resync") { if (V.ws) { var old = V.ws; V.ws = null; try { old.close(1000, "resync"); } catch (err) { /* closed */ } } connect(); }
  }
  function fail(why) {
    var wasIn = V.status === "connected";
    teardown();
    V.status = "idle";
    V.why = why;
    emit();
    if (hooks && hooks.notice) hooks.notice(why, wasIn);
  }
  function teardown() {
    V.want = false;
    clearTimeout(V.retryTimer);
    if (V.ws) { var ws = V.ws; V.ws = null; try { ws.send(JSON.stringify({ op: "vleave" })); } catch (err) { /* closed */ } try { ws.close(1000, "leave"); } catch (err) { /* closed */ } }
    Object.keys(V.peers).forEach(dropPeer);
    [V.mic, V.camTrack, V.scrTrack].forEach(function (t) { if (t) { try { t.stop(); } catch (err) { /* stopped */ } } });
    V.mic = null; V.camTrack = null; V.scrTrack = null; V.cam = false; V.scr = false; V.sm = false;
    ["me:cam", "me:scr"].forEach(function (k) { var v = media[k]; if (v) { v.srcObject = null; if (v.parentNode) v.parentNode.removeChild(v); delete media[k]; } });
    dropMeter("me");
    if (V.meterTimer) { clearInterval(V.meterTimer); V.meterTimer = 0; }
    V.roster = {}; V.speaking = {}; V.joinedAt = 0;
    V.sid = ""; V.cid = "";
  }

  /* ---------- public actions ---------- */
  function join(sid, cid) {
    if (!supported()) { V.why = "unsupported"; emit(); return Promise.resolve(false); }
    if (V.sid === sid && V.cid === cid && V.want) return Promise.resolve(true);
    if (V.want) teardown();
    V.sid = sid; V.cid = cid; V.want = true; V.status = "connecting"; V.why = "";
    audioCtx();
    unlockAudio();
    emit();
    return getMic().catch(function () {
      /* No microphone or the prompt was declined: join to listen. */
      V.mu = true;
      if (hooks && hooks.notice) hooks.notice("nomic", false);
      return null;
    }).then(function () {
      if (!V.want || V.cid !== cid) return false;
      connect();
      return true;
    });
  }
  function leave() { teardown(); V.status = "idle"; V.why = ""; emit(); }
  function setMute(on) {
    if (V.sm && !on) return;
    V.mu = !!on;
    if (!V.mu && V.df) V.df = false;
    if (!V.mu && !V.mic && V.want) {
      getMic().then(function () { eachPeer(setTracks); pushState(); }, function () { V.mu = true; if (hooks && hooks.notice) hooks.notice("nomic", false); emit(); });
      return;
    }
    if (V.mic) V.mic.enabled = !(V.mu || V.sm || V.df);
    eachPeer(applyAudio);
    pushState();
  }
  function setDeaf(on) {
    V.df = !!on;
    if (V.mic) V.mic.enabled = !(V.mu || V.sm || V.df);
    eachPeer(applyAudio);
    pushState();
  }
  function setCamera(on) {
    if (!on) {
      if (V.camTrack) { try { V.camTrack.stop(); } catch (err) { /* stopped */ } }
      V.camTrack = null; V.cam = false;
      eachPeer(setTracks); pushState();
      return Promise.resolve(false);
    }
    return navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: "user" }, audio: false }).then(function (stream) {
      if (!V.want) { stream.getTracks().forEach(function (t) { t.stop(); }); return false; }
      V.camTrack = stream.getVideoTracks()[0] || null;
      V.cam = !!V.camTrack;
      if (V.camTrack) V.camTrack.onended = function () { setCamera(false); };
      eachPeer(setTracks); pushState();
      return V.cam;
    }, function () { if (hooks && hooks.notice) hooks.notice("nocam", false); return false; });
  }
  function setScreen(on) {
    if (!on) {
      if (V.scrTrack) { try { V.scrTrack.stop(); } catch (err) { /* stopped */ } }
      V.scrTrack = null; V.scr = false;
      eachPeer(setTracks); pushState();
      return Promise.resolve(false);
    }
    if (!canScreen()) { if (hooks && hooks.notice) hooks.notice("noscreen", false); return Promise.resolve(false); }
    return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false }).then(function (stream) {
      if (!V.want) { stream.getTracks().forEach(function (t) { t.stop(); }); return false; }
      V.scrTrack = stream.getVideoTracks()[0] || null;
      if (V.scrTrack && "contentHint" in V.scrTrack) { try { V.scrTrack.contentHint = "detail"; } catch (err) { /* read only */ } }
      V.scr = !!V.scrTrack;
      if (V.scrTrack) V.scrTrack.onended = function () { setScreen(false); };
      eachPeer(setTracks); pushState();
      return V.scr;
    }, function () { return false; });
  }
  function setPeerVolume(id, vol) { var p = V.peers[id]; if (!p) return; p.volume = vol; applyAudio(p); }
  function setPeerMute(id, on) { var p = V.peers[id]; if (!p) return; p.localMute = !!on; applyAudio(p); emit(); }
  function moderate(id, act) { return sendWs({ op: "vmod", a: id, mu: act === "mute", kick: act === "kick" }); }
  /* Put the live <video> nodes into placeholders after a repaint. */
  function mount(root) {
    if (!root || !root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll("[data-vmedia]"), function (slot) {
      var key = slot.getAttribute("data-vmedia");
      var kind = key.split(":")[1];
      var el = key.indexOf("me:") === 0 ? localVideo(kind) : media[key];
      if (!el) return;
      if (el.parentNode !== slot) slot.appendChild(el);
      if (key === "me:cam") el.className = "vsrv-vvideo mirror"; else el.className = "vsrv-vvideo";
      playSoon(el);
    });
  }
  function peerConn(id) { var p = V.peers[id]; return p ? p.conn : (id === V.mid ? "connected" : "connecting"); }

  window.ViktorychVoice = {
    init: function (h) { hooks = h; },
    supported: supported,
    canScreen: canScreen,
    state: function () { return V; },
    on: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
    join: join,
    leave: leave,
    setMute: setMute,
    setDeaf: setDeaf,
    setCamera: setCamera,
    setScreen: setScreen,
    setPeerVolume: setPeerVolume,
    setPeerMute: setPeerMute,
    moderate: moderate,
    mount: mount,
    peerConn: peerConn,
    unlock: unlockAudio,
    cap: 8
  };
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("pagehide", function () { if (V.want) teardown(); });
  }
})();
