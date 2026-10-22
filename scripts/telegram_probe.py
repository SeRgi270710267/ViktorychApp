#!/usr/bin/env python3
"""Confirm the Telegram backup secrets without printing them.

Prints true or false for TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID,
TELEGRAM_API_ID, and TELEGRAM_API_HASH. Then calls getMe, getChat, and
getChatMember, and uploads one tiny text file. A failed getChat prints
Telegram's description and nothing else from the request.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

NAMES = (
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHANNEL_ID",
    "TELEGRAM_API_ID",
    "TELEGRAM_API_HASH",
)
API = "https://api.telegram.org"


def presence_line(name: str, environ: dict) -> str:
    present = bool((environ.get(name) or "").strip())
    return name + "=" + ("true" if present else "false")


def scrub(text: str, secrets: list) -> str:
    cleaned = str(text or "")
    for secret in secrets:
        value = str(secret or "")
        if len(value) >= 4:
            cleaned = cleaned.replace(value, "[redacted]")
    return cleaned


def error_text(parsed: dict, secrets: list) -> str:
    text = str((parsed or {}).get("description") or "telegram error")
    return scrub(text, secrets)


def call(token: str, method: str, fields: dict | None = None, payload: bytes | None = None, content_type: str | None = None) -> dict:
    url = API + "/bot" + token + "/" + method
    data = payload
    headers = {"User-Agent": "viktorych-telegram-probe"}
    if payload is None and fields is not None:
        data = urllib.parse.urlencode(fields).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read()
    except urllib.error.HTTPError as err:
        raw = err.read()
    except urllib.error.URLError:
        return {"ok": False, "description": "network error"}
    try:
        parsed = json.loads(raw.decode("utf-8", "replace"))
    except json.JSONDecodeError:
        return {"ok": False, "description": "telegram returned a non-json body"}
    if not isinstance(parsed, dict):
        return {"ok": False, "description": "telegram returned an unexpected body"}
    return parsed


def send_document(token: str, channel: str) -> dict:
    boundary = "----viktorychprobe"
    content = b"viktorych telegram probe\n"
    chunks = []

    def add(name: str, value: bytes, filename: str = "", mime: str = "") -> None:
        head = '--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"'
        if filename:
            head += '; filename="' + filename + '"'
        head += "\r\n"
        if mime:
            head += "Content-Type: " + mime + "\r\n"
        head += "\r\n"
        chunks.append(head.encode("utf-8") + value + b"\r\n")

    add("chat_id", channel.encode("utf-8"))
    add("disable_notification", b"true")
    add("caption", b"viktorych telegram probe")
    add("document", content, filename="viktorych-telegram-probe.txt", mime="text/plain")
    body = b"".join(chunks) + ("--" + boundary + "--\r\n").encode("utf-8")
    return call(token, "sendDocument", payload=body, content_type="multipart/form-data; boundary=" + boundary)


def selftest() -> int:
    sample = {name: "" for name in NAMES}
    sample["TELEGRAM_BOT_TOKEN"] = "sentinel-secret-value"
    lines = [presence_line(name, sample) for name in NAMES]
    if lines != [
        "TELEGRAM_BOT_TOKEN=true",
        "TELEGRAM_CHANNEL_ID=false",
        "TELEGRAM_API_ID=false",
        "TELEGRAM_API_HASH=false",
    ]:
        print("FAIL presence lines", file=sys.stderr)
        return 1
    cleaned = scrub("Bad Request: chat not found sentinel-secret-value", ["sentinel-secret-value"])
    if cleaned != "Bad Request: chat not found [redacted]" or "sentinel-secret-value" in cleaned:
        print("FAIL scrub", file=sys.stderr)
        return 1
    text = error_text({"ok": False, "description": "Forbidden: bot is not a member of the channel chat"}, [])
    if "bot is not a member" not in text:
        print("FAIL description", file=sys.stderr)
        return 1
    print("telegram probe selftest ok")
    return 0


def main(argv: list | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if "--selftest" in args:
        return selftest()
    for name in NAMES:
        print(presence_line(name, os.environ))
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    channel = (os.environ.get("TELEGRAM_CHANNEL_ID") or "").strip()
    secrets = [os.environ.get(name) or "" for name in NAMES]
    missing = [name for name in NAMES if not (os.environ.get(name) or "").strip()]
    if not token or not channel:
        print("getMe=skip")
        print("getChat=skip")
        return 1
    failed = bool(missing)
    me = call(token, "getMe")
    if not me.get("ok"):
        print("getMe=fail")
        print("getMe_error=" + error_text(me, secrets))
        return 1
    identity = me.get("result") or {}
    print("getMe=ok")
    username = str(identity.get("username") or "")
    if username:
        print("getMe_username=" + username)
    user_id = identity.get("id")
    chat = call(token, "getChat", {"chat_id": channel})
    if not chat.get("ok"):
        print("getChat=fail")
        print("getChat_error=" + error_text(chat, secrets))
        return 1
    info = chat.get("result") or {}
    print("getChat=ok")
    print("getChat_type=" + str(info.get("type") or ""))
    title = scrub(str(info.get("title") or ""), secrets)
    if title:
        print("getChat_title=" + title)
    if user_id is None:
        print("getChatMember=fail")
        print("getChatMember_error=getMe returned no user id")
        failed = True
    else:
        member = call(token, "getChatMember", {"chat_id": channel, "user_id": str(user_id)})
        if not member.get("ok"):
            print("getChatMember=fail")
            print("getChatMember_error=" + error_text(member, secrets))
            failed = True
        else:
            row = member.get("result") or {}
            status = str(row.get("status") or "")
            print("getChatMember=" + (status or "fail"))
            if status == "creator":
                print("can_post_messages=true")
            elif status == "administrator":
                can_post = bool(row.get("can_post_messages"))
                print("can_post_messages=" + ("true" if can_post else "false"))
                if not can_post:
                    print("getChatMember_error=bot is an admin but cannot post messages")
                    failed = True
            else:
                print("getChatMember_error=bot is not an admin")
                failed = True
    sent = send_document(token, channel)
    if not sent.get("ok"):
        print("upload=fail")
        print("upload_error=" + error_text(sent, secrets))
        return 1
    message = sent.get("result") or {}
    print("upload=ok")
    print("upload_message_id=" + str(message.get("message_id") or ""))
    if failed:
        print("secrets_complete=false")
        return 1
    print("secrets_complete=true")
    return 0


if __name__ == "__main__":
    sys.exit(main())
