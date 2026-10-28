# Peer-to-peer live

Go live is opt-in. The purple live card is not part of this feature and is not shown. Allowed viewers see a slim Live row on Home, in the same area as stories, and a notification when they follow the host or are on the custom list. Invite-only and only-me sessions are not announced.

## What stays on the devices

Camera, screen, window, and tab video move from browser to browser with WebRTC. The Worker, D1, and R2 never receive media bytes. They do not re-encode the stream. The host’s capture uses the camera or display at the size the browser provides. When a viewer already has the stream, that browser can relay the tracks to a few more viewers.

Chat and reactions use a WebRTC data channel on the same peer connections. Those messages are not stored.

A local recording, if the host turns it on, is a file download on that device. It is not uploaded. When the host sends both camera and screen, the camera is drawn on top in the page. The recording keeps the screen track and the microphone. It does not burn the camera into the file, because mixing in a canvas would re-encode the source.

## Signaling

The existing account Durable Object also serves rooms named `live:` plus the session id. There is still one Durable Object class. A viewer gets a single-use ticket only after the Worker checks the audience. The socket then forwards SDP and ICE between a viewer and their parent. That JSON is not written to D1. Someone who is not allowed gets the same not-found response as a missing session, so the list and the ticket route do not reveal it.

Free STUN servers are always offered:

- `stun:stun.l.google.com:19302`
- `stun:stun.cloudflare.com:3478`

There is no TURN server unless the site owner adds one. Symmetric NAT and some mobile networks cannot connect with STUN alone. A viewer in that situation sees a reconnecting state and never receives video. To add a free TURN server the owner runs, from `worker/`:

```
npx wrangler secret put LIVE_TURN_URLS
npx wrangler secret put LIVE_TURN_USERNAME
npx wrangler secret put LIVE_TURN_CREDENTIAL
```

`LIVE_TURN_URLS` is a comma-separated list of at most four `turn:` or `turns:` URLs. Leave the secrets unset to keep STUN only. Anyone the audience check allows can see the TURN username and credential in the ticket response, so use a relay account that is not used for anything else. The app does not bill a TURN provider and does not ship a paid one.

## Relay tree

The host is the root. Each peer accepts a limited number of children (fan-out). The default is 3 and the maximum is 8. The next viewer attaches to the closest peer that still has room. If a peer leaves, its children are attached again. The host lowers the outbound video bitrate as its own child count grows. That cap is a WebRTC sender setting. The browser may still change resolution on its own. A relay is a new encode on that viewer’s device, not a bit-exact copy and not a server transcode.

The tree only works while the parent stays connected. A full tree refuses new signaling sockets. Viewers need the host to be connected first.

## Audience

The host picks one:

- Everyone: any signed-in account. Logged-out visitors are not told the session exists.
- Followers: accounts that follow the host.
- Mutuals: accounts that follow each other.
- Only me.
- Custom list: up to eight 12-digit account numbers. The server has no shared list of people, so this is the list for this session only.
- Invite link: the link can require a password. The password is stored as a hash.

The host can kick a connected viewer and block that account for the rest of the session. Chat removal is best-effort across the data channels. A determined peer can ignore it. The block is the part the Worker enforces.

Notifications go to at most 40 followers, or to the custom list. They are skipped for only-me and invite-only sessions. A public session is not pushed to every account.

## Browser limits

iPhone and iPad Safari do not offer screen, window, or tab capture. Those controls are omitted. The camera and microphone stay. Desktop browsers that lack `getDisplayMedia` also omit screen capture. If a device cannot capture anything, the sheet says so and does not show a start button.

Autoplay can block sound until the viewer taps the page. A paused or muted host stops those tracks. Changing source replaces the tracks. It does not upload them.

Sessions that stop sending a heartbeat are ended after six hours. The Worker does not record the video.
