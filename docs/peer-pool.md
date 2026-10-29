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
- `PLAYWRIGHT_CORE=… node scripts/peer_pool_test.mjs` runs three Chrome
  pages. It checks peer hits, a single server read, and that a tampered chunk
  is rejected and the normal request answers instead. It uses real WebRTC
  where the sandbox allows it, and a stand-in transport otherwise.
