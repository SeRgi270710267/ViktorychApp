# Nearby chat (Bitchat-compatible)

A backup way to talk when the internet, our servers or the app are blocked.
It speaks the public [Bitchat](https://github.com/permissionlesstech/bitchat)
protocol, so the TV app and the Bitchat apps on phones can chat with each other.

## Fallback only

- Nothing runs by default. The site offers "Nearby chat" only when every
  normal path (direct, relay, Render backup, P2P) has failed, i.e. when the
  "Connection is slow" note shows, or when the TV app is offline.
- Bluetooth and Nostr connections exist only while the chat screen is open.
  There is no background service, so no battery or data is used otherwise.
- Settings > Digital Resistance & Proxy has an off switch. The TV chat
  screen has its own Turn off button. The owner can turn it off for everyone
  with the `bitchat` server feature switch (web part).
- Bluetooth permission is asked for only when the user presses
  "Allow Bluetooth" on the chat screen.

## TV app (android-tv)

`app/src/main/java/app/viktorych/tv/mesh/` is a dependency-free Java port of
the protocol (old TV boxes lack native X25519/Ed25519):

| Part | What it does |
| --- | --- |
| `Packet` | Bitchat binary packets v1/v2: header, sender/recipient, route, raw-deflate compression, PKCS#7-style padding to 256/512/1024/2048, Ed25519 signatures over the TTL-free padded form, announce TLVs, private-message TLVs, fragments. |
| `Noise` | `Noise_XX_25519_ChaChaPoly_SHA256`, empty prologue, 4-byte nonce prefix on transport messages, 64-message replay window. |
| `MeshCore` | Peers (peer ID = first 8 bytes of SHA-256 of the Noise key), signed announces, public messages, private messages with delivery acks, store-and-forward relay with TTL 7 (5 when busy), 5-minute dedup, jitter, fragmentation and reassembly. |
| `BleMesh` | GATT service `F47B5E2D-4A9E-4C5A-9B3F-8E1D2C3A4B5C`, characteristic `A1B2C3D4-E5F6-4A5B-8C9D-0E1F2A3B4C5D`. Central (scan, connect, MTU 517, notify, write without response) always; peripheral (GATT server + advertising) only when the chip can advertise. |
| `NostrRelay`, `NostrSign` | Bitchat location channels: kind 20000 events with `["g", geohash]`, `["n", nickname]` and an 8-bit NIP-13 proof of work, over public relays (Bitchat's defaults, editable on the screen). Every event's id and BIP-340 signature is checked. |
| `MeshActivity` | D-pad friendly screen: everyone nearby, area chat, private chat with a nearby person, name, area, relays, off switch, new identity. Opened by `viktorychtv://mesh`. |

Keys (Noise, Ed25519, Nostr) are made on the TV and kept in the app's private
storage; "New identity" replaces them.

Tests: `android-tv/mesh-test/run.sh` (plain JVM). It checks the crypto against
the JDK, Noise XX against the Python `noiseprotocol` package when installed,
BIP-340 test vector 0, packets, a three-node relay with forced fragmentation,
signed Nostr events against the site's `nostr.js`, and (with `JSON_JAR` set)
the Nostr receive path.

## Limits

- Android 12+ asks for "Nearby devices"; Android 6 to 11 asks for location
  and needs Location turned on to scan (the location is never read).
- Many TV boxes can't advertise over Bluetooth LE. Then the TV runs as a
  central only: it still connects to phones running Bitchat, but two such TVs
  can't see each other directly.
- Browsers and iPhones can't use Bluetooth LE from a web page; the site offers
  the internet area chat there instead.
- Not implemented yet: Bitchat's gossip sync (`requestSync`), courier
  envelopes, file and voice messages (relayed, not shown), and Bitchat's
  private messages over Nostr (its own format, not NIP-17).

## Licences and credit

Protocol details come from the Bitchat whitepaper and the iOS source, which
are released into the public domain under [The Unlicense](https://github.com/permissionlesstech/bitchat/blob/main/LICENSE).
Thanks to permissionlesstech and the Bitchat contributors. No code from
bitchat-android (GPL-3.0) is used. The crypto follows RFC 7748, RFC 8032,
RFC 8439, the Noise specification and BIP-340.
