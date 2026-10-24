<!--
# Optional live relay (not built)

The site can already show comments that the sync saved. Instagram, Threads, and X do not offer a no-login, browser-readable comment feed: their pages omit CORS for this site, and the public X embed has no reply bodies. A small relay would let the browser ask our own code, on a free host, at the moment someone opens a post.

This is a proposal only. Nothing here is deployed.

## Account

Create a free [Cloudflare](https://dash.cloudflare.com/sign-up) account. The Workers free tier (100,000 requests per day on the current free plan) is enough for a personal reader. No paid X API, no Instagram session, and no cookie belongs in the GitHub repo. The worker would use the same public pages the sync already reads.

## What it would do

One Worker script, deployed with `wrangler` from that Cloudflare account:

- `GET /threads?user=&code=` fetches the public mobile post page and returns the visible replies (author, text, time, likes) as JSON.
- `GET /x?id=` fetches the public syndication embed and returns the post text and counts. Reply bodies are not in that embed, so this route would not invent them. A later live reply list still needs a source that publishes replies without a login.
- `GET /instagram?code=` fetches public oembed and returns the caption, author, and thumbnail. The public oembed has no comment list, so this route cannot add one without a logged-in session, which this project will not store.
- Responses set `Access-Control-Allow-Origin` to the Pages origin (`https://<owner>.github.io`) only.
- Cache each response for about two minutes, then the browser falls back to `fallback/*.json` and `comments/*.json`.
- The worker does not forward cookies, does not call `api.x.com` / `api.twitter.com`, and does not retry a 429 or a captcha.

The Pages app would call the worker only after fxtwitter, Invidious, and Piped miss, and it would label the result with the worker’s fetch time.

## Why it stays optional

The sync fallback already covers what those public pages return, without a second account. The worker only removes the delay until the next sync for Threads replies (and X/Instagram post fields). It does not unlock Instagram comment bodies or X reply bodies, because those are not on the public no-login endpoints.
-->
