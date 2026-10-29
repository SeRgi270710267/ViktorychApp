# Sharing pool

Devices that turned the pool on and are online at the same time pass each
other public feed documents and app files they already have. The server
sends each version once to the first reader instead of once per reader.

## What is shared

| Item | Trusted by | Notes |
| --- | --- | --- |
| Feed documents (`feeds.json`, `stories.json`, `people.json`, `status.json`, `feeds.config.json`, `data/music.json`, `archive/*.json`) | ECDSA P-256 manifest signed by the Worker | Only the public copy. The owner's copy has owner-only fields, so owner devices never take or give documents. |
| App files for a new version | `shell-manifest.json` on Pages (same origin) | Prefilled into the `shell-pool` cache before the service worker downloads, so its reuse-by-hash step skips those files. Files under 16 KB are not worth a peer round trip. |
| Hotlinked media | not shared | Cross-origin images and video are opaque responses: the page cannot read the bytes, so there is nothing to hash or pass on. HLS segments keep using the media swarm (`peer-media.js`). |

## How it works

1. **Signing.** When a signed-in non-owner reads `/v1/data/<key>`, the Worker
   signs `{key, mark, sha256, size, chunk hashes}` for exactly the bytes it
   answers with. It does this once per version per isolate and writes the
   result to the public pulse bucket as `pool/v1/<key>`. `mark` is the R2 etag
   the pulse publishes. Clients read manifests straight from the bucket, so
   reading one costs no Worker request.
2. **Signaling.** Signaling uses the `AccountChannel` Durable Object named
   `pool:main`. Joining takes a short-lived ticket from
   `POST /v1/media/swarm/ticket`, then `GET /v1/pool/room?ticket=…`. The room
   only relays `have`, WebRTC `signal` and `stats` messages, and it never
   handles bytes. Relay (TURN) candidates are stripped. Only public STUN is
   used.
3. **Peers.** Each device connects to at most 4 peers. A device asks a peer
   only when that peer has advertised the hash the current manifest names.
4. **Race.** The peer gets a head start of 3× its round trip, clamped to
   60–250 ms. After that the normal request starts too, and the first good
   answer wins. A miss, a timeout (2.5 s) or a bad chunk goes straight to the
   normal request.
5. **Verify.** Every 64 KB chunk is checked against the manifest, and then
   the whole item is checked. A peer that sends bad bytes is counted and
   skipped.
6. **Limits.** Each device uploads at most 20 MB a day and keeps up to 16 MB
   of verified items in memory. Sharing pauses 60 s after the tab is hidden.

## When it is on

`Settings → Data usage → Sharing pool` offers Auto, On and Off.

- **Auto** is on only on unmetered Wi-Fi or wired connections, and only on a
  desktop or a device that is charging. It is off in TV mode.
- **On** also runs in TV mode and on battery.
- **Save data** and mobile data always turn it off.
- The data-saving value is Off.

The page shows "Saved X MB from peers, shared Y MB". The owner usage panel
shows the 7-day peer hit rate, the bytes offloaded from the server, the
devices in the pool now, and rejected chunks. These numbers are reported by
devices, so they are estimates.

## Getting past blocks (Russia, India)

The pool is the last step in the fallback chain that PR #341 added: the
main server, then the Render backup, then the other site copy and the media
relay, then peers.

- **Feed data when the servers fail or stall.** A data read that fails on
  every server, or is still waiting after 4 s, asks peers for the newest
  copy they hold. The copy must match a manifest the Worker signed, so a
  peer can hold back an update but cannot fake or alter one. The first good
  answer wins. If nothing newer than this tab's copy exists, the read fails
  as before and the app keeps what it shows.
- **Updates without the change signal.** Peers pass the signed manifests
  for what they hold over the data channel (`mf`, and `want` to ask for
  one). When the change signal is out of reach and a peer vouches for a
  newer `feeds.json`, the app reads again (`viktorych-pool-news`) and the
  copy comes from peers.
- **Rescue mode.** A device that does not share (Auto without a charger,
  or mobile data with the switch on On) joins the pool only while our
  servers keep failing (10 minutes after the last failure). It only
  downloads: nothing is uploaded and nothing is announced. Save data, TV
  mode and Off keep it out. On mobile data, Auto keeps it out too.
- **Two rooms.** The room runs on the Worker and, with the same rules and
  code (`backup-server/pool-room.mjs`, a small built-in WebSocket server, so
  the backup still needs no npm packages), on the Render backup. Tickets come
  from the shared D1 table, so either server can issue one. Sharing devices
  join both rooms, so a reader who only reaches Render still finds someone
  with fresh copies. Readers in rescue join one, the first that answers.
  The two rooms do not talk to each other.
- **STUN.** Cloudflare (3478), Google (19302) and Nextcloud (443). Port
  443 tends to stay open on networks that block other UDP ports. There is
  still no TURN: if two devices cannot reach each other directly, they
  cannot share.
- **The slow-connection note** says "new posts came from other devices"
  for 10 minutes after peers answered while the connection is slow.

### What it cannot do

- **Photos and videos.** Media lives on other sites. The browser gets an
  opaque response that cannot be read or hashed, so there is nothing to
  verify. Passing it on unverified would let any peer swap content, so
  media still goes direct, through the relay, or not at all.
- **Total blocks.** Peers find each other through the Worker or Render. If
  both are blocked and the device has no copy, the pool cannot start.
  Devices already connected keep exchanging while their links stay up.
- **A peer is needed.** Rescue only works when someone online holds a newer
  signed copy, which in practice means at least one device in the pool
  that can reach the server.

## Privacy

WebRTC peers see each other's IP address. This is the same for any direct
connection, and Settings says so. No account id travels in the room. Peers
are identified by random per-connection ids. Only devices that turned the
pool on connect.

## Expected savings

The benefit depends on how many devices are online together:

- **Fewer than 2 or 3 online at once:** nothing.
- **5 to 20 users:** typically 2 to 5 overlap. Each feed version that changes
  while they are online is fetched once from the server and then from
  peers. That is roughly 30 to 70 % of feed document bytes during busy
  periods, and close to zero at quiet times. App updates save a bit more,
  because everyone downloads the same files.
- **Larger groups:** the savings grow with the number of people online
  together.

Worker requests for feed documents do not drop to zero. Each reader still
fetches pulse and manifests from R2. Peer reads only replace the data
request when a peer already has the current version.

## Keys

The private signing key is the Worker secret `POOL_SIGN_JWK` (P-256 JWK). The
public half is `POOL_PUBLIC_JWK` in `shared/peer-pool.js`. Without the secret
the Worker writes no manifests and the pool only shares app files.

## Tests

- `node worker/test/peer-pool.test.mjs` (Miniflare). It checks the rules, the
  manifest the data read signs, room relay and stats.
- `node worker/test/pool-backup-room.test.mjs` runs the Render room on real
  WebSockets: ready, peer, signal relay, single-use tickets and bye.
- `PLAYWRIGHT_CORE=… node scripts/peer_pool_test.mjs` runs three Chrome
  pages. It checks peer hits, a single server read, and that a tampered chunk
  is rejected and the normal request answers instead. It also checks the
  blocked case: a newer signed feed reaching a page whose change signal and
  server both fail, and a phone on mobile data that joins only while
  blocked, gets the feed in rescue mode and uploads nothing. It uses real WebRTC
  where the sandbox allows it, and a stand-in transport otherwise.

## Carrying anything: opaque blobs

The pool is content-agnostic. Any module (private list shards, quoted or
referenced items, media references) can hand it bytes, and any peer may
cache, request, advertise and relay them. What a user's feed *shows* is
decided by that feed's own code, never by what the pool carries.

```js
const pool = window.ViktorychPool;
const h = await pool.putBlob(bytes);            // SHA-256 hex, "" if too big (> 6 MB)
pool.hasBlob(h);                                // held here or by a connected peer
const got = await pool.getBlob(h, size, {       // Uint8Array or null
  priority: "visible",                          // "visible" | "next" | "likely" | "background"
  waitMs: 1500                                  // how long to wait for a holder to show up
});
```

- The only name on the wire is the content id (SHA-256 of the bytes). Room
  announcements carry `{h, size}` only; manifest requests carry a 32-hex
  key id (`keyId(key)` in `shared/peer-pool.js`), never a file, account or
  list name. Put no names inside the bytes either: encrypt private shards
  before `putBlob`, so a relaying peer holds ciphertext it cannot read.
- Every blob is checked against its hash before `getBlob` returns it; a bad
  copy is counted as rejected and the caller gets `null` and falls back to
  its own fetch. The pool never decides what is current: the caller passes
  the hash it got from a source it trusts (a signed index, the server).
- `getBlob` only reads from peers. It is a fallback or a race partner for
  the caller's own request, never a replacement for it.

## Local scheduler (`shared/pool-scheduler.js`)

All decisions are made on the device from what it measured. There is no
coordinator. Settings has a switch, "Choose sources and sharing
automatically" (on by default). Off means every peer is equal, the flat
20 MB/day cap, and oldest-first eviction.

- **Source scores.** Each peer (`peer:<id>`) and the normal request chain
  (`origin`) keep a moving average of latency, throughput and failures,
  which fades back to a prior over 30 minutes. Peers are pulled from in score
  order. `pool.scheduler.race([{name, run(signal)}])` starts the two best
  sources together, takes the first good answer, aborts the other, and
  falls back to the rest. `pool.scheduler.record(name, {ms, bytes, ok})`
  and `rank(names)` are there for other chains. The API chain from #341
  keeps its own Worker/Render speed order (`bySpeed`); the pool compares
  peers against that chain as one source.
- **Priorities.** `getBlob` work runs at most 3 at a time: visible, then
  next screen, then likely next, then background. Background work is
  dropped when the budget says no prefetch.
- **Device budget.** Seeding is off with Save data, mobile data, a metered link, or
  battery under 15% when not charging. It is low (5 MB/day, 2 peers) in a
  background tab, on 3G or under 30% battery. It is normal (20 MB/day,
  3 peers) otherwise, and high (40 MB/day, 4 peers) on unmetered Wi-Fi or
  wired while charging or on a desktop. Prefetch is only allowed at normal
  or high in a visible tab. Rescue still downloads with seeding off.
- **Cache.** The memory store is 2% of free quota, between 4 and 32 MB
  (16 MB when unknown). It evicts by recency weighted by how often peers
  asked for an item.
- **Seeding.** Announcements list the rarest items first and collapse
  duplicate content ids. A peer that asks for the same chunk twice gets a
  miss.
