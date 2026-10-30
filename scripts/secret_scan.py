#!/usr/bin/env python3
"""Secret and personal-data scan for the public tree.

Run it before every commit (scripts/install_git_hooks.sh adds a pre-commit
hook) and in CI. It reports a path, a line number, and a rule name only.
Matched values are never printed.

    python3 scripts/secret_scan.py            # every tracked file
    python3 scripts/secret_scan.py --staged   # what is about to be committed
    python3 scripts/secret_scan.py PATH...    # given files
    python3 scripts/secret_scan.py --selftest

A line that is a known false positive can end with the marker
"secret-scan: allow" and a short reason. Handles and account ids from the
private catalog are checked separately by scripts/handle_guard.py.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ALLOW_MARK = "secret-scan: allow"
MAX_BYTES = 2_000_000
SKIP_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf",
    ".otf", ".mp3", ".mp4", ".webm", ".ogg", ".wasm", ".zip", ".gz", ".apk",
}
SKIP_FILES = {"hls-1.7.3.min.js", "mpegts-1.8.0.min.js"}

# Files that must never be committed, whatever they contain.
FORBIDDEN_NAMES = [
    (re.compile(r"(^|/)\.env(\.[^/]*)?$"), "env-file"),
    (re.compile(r"\.(pem|key|p12|pfx|jks|keystore|ppk|asc|gpg)$", re.I), "key-file"),
    (re.compile(r"(^|/)(id_rsa|id_ed25519|id_ecdsa)(\.pub)?$"), "ssh-key"),
    (re.compile(r"(^|/)cookies?(\.txt|\.json)?$", re.I), "cookie-file"),
    (re.compile(r"\.(har|sqlite3?|db)$", re.I), "capture-or-database"),
    (re.compile(r"(^|/)\.dev\.vars$"), "wrangler-dev-vars"),
    (re.compile(r"(^|/)(service-account|credentials|client_secret)[^/]*\.json$", re.I), "credential-json"),
]
FORBIDDEN_EXEMPT = {".env.example", ".dev.vars.example"}

SECRET_RULES = [
    ("private-key", r"-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----"),
    ("github-token", r"\bgh[pousr]_[A-Za-z0-9]{36,}\b"),
    ("github-pat", r"\bgithub_pat_[A-Za-z0-9_]{60,}\b"),
    ("stripe-key", r"\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b"),
    ("stripe-test-key", r"\b(?:sk|rk)_test_[A-Za-z0-9]{16,}\b"),
    ("stripe-webhook-secret", r"\bwhsec_[A-Za-z0-9]{24,}\b"),
    ("discord-bot-or-user-token", r"\b[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,40}\b"),
    ("discord-webhook", r"discord(?:app)?\.com/api/webhooks/\d+/[A-Za-z0-9_-]{20,}"),
    ("telegram-bot-token", r"\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b"),
    ("render-api-key", r"\brnd_[A-Za-z0-9]{24,}\b"),
    ("aws-access-key", r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    ("slack-token", r"\bxox[abposr]-[A-Za-z0-9-]{10,}\b"),
    ("google-oauth-secret", r"\bGOCSPX-[A-Za-z0-9_-]{20,}\b"),
    ("google-refresh-token", r"\b1//0[A-Za-z0-9_-]{40,}\b"),
    ("vk-token", r"\bvk1\.a\.[A-Za-z0-9_-]{40,}\b"),
    ("jwt", r"\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}\b"),
    ("npm-token", r"\bnpm_[A-Za-z0-9]{36}\b"),
    ("openai-style-key", r"\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b"),
    ("session-cookie", r"\b(?:auth_token|ct0|sessionid|sessid|remixsid|__Secure-[A-Za-z0-9_-]+)=[A-Za-z0-9%._-]{20,}"),
    ("url-credentials", r"\b[a-z][a-z0-9+.-]*://[^\s:/@\"']{1,64}:[^\s:/@\"']{6,}@[A-Za-z0-9.-]+"),
    ("keystore-password", r"\b(?:storePassword|keyPassword|KEYSTORE_PASSWORD)\s*[=:]\s*[\"']?(?!\$|System\.getenv|providers\.|env\.)[^\s\"']{6,}"),
    # A known secret name assigned a literal long value (not a reference to an env var or a secret store).
    ("assigned-secret", r"\b(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN|CF_ANALYTICS_TOKEN|GH_TOKEN|GITHUB_TOKEN|DISCORD_USER_TOKEN|DISCORD_BOT_TOKEN|TELEGRAM_BOT_TOKEN|ACCOUNT_PEPPER|OWNER_CLAIM_CODE|TURNSTILE_SECRET|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|RENDER_API_KEY|YOUTUBE_API_KEY|VK_TOKEN|VK_SERVICE_KEY|TG_API_HASH|TG_STORIES_SESSION|IG_SESSION|WORKER_DISPATCH_TOKEN|GITHUB_DISPATCH_TOKEN)\s*[=:]\s*[\"'][A-Za-z0-9_\-+/=.]{20,}[\"']"),
]

PII_RULES = [
    # Personal mailboxes. Placeholder domains and GitHub noreply addresses are fine.
    ("personal-email", r"\b[A-Za-z0-9._%+-]+@(?:gmail|googlemail|yahoo|yandex|ya|mail|bk|inbox|list|rambler|outlook|hotmail|live|icloud|me|proton|protonmail|pm|gmx|wp|o2|onet|interia|tutanota|aol|zoho|qq|163|rediffmail)\.[a-z.]{2,6}\b"),
    ("phone-number", r"(?<![\w/.=%-])\+(?:7|1|48|91|34|44|49|380|375)(?:[\s-]?\(?\d\)?){8,11}(?![\w/])"),
    ("signed-url-client-ip", r"[?&](?:ip|client_ip)=(?!0\b|10\.|127\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|192\.168\.)(?:\d{1,3}\.){3}\d{1,3}\b"),
    ("ipv4-public-literal", r"(?<![\w.\-/])(?!(?:10|127|0|192\.0\.2|198\.51\.100|203\.0\.113|255|169\.254)\.)(?!192\.168\.)(?!172\.(?:1[6-9]|2\d|3[01])\.)(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?::\d{2,5})?(?![\w.])(?=\s*[\"'`,;)\]]|\s*$)"),
]

COMPILED = [(name, re.compile(rx)) for name, rx in SECRET_RULES] + [(name, re.compile(rx)) for name, rx in PII_RULES]
# Public resolvers and well-known test addresses that are not personal data.
# Tests use made-up client addresses for rate-limit checks.
TEST_PATH = re.compile(r"(^|/)(test|tests|fixtures)/|[._-]test\.[a-z]+$|_test\.[a-z]+$")
PUBLIC_IPS = {"1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4", "9.9.9.9", "149.112.112.112"}


def git_files(staged: bool) -> list[str]:
    if staged:
        out = subprocess.run(["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], cwd=ROOT, capture_output=True, check=True).stdout
    else:
        out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True).stdout
    return [p for p in out.decode("utf-8", "replace").split("\0") if p]


def staged_text(path: str) -> str | None:
    res = subprocess.run(["git", "show", ":" + path], cwd=ROOT, capture_output=True)
    if res.returncode != 0 or len(res.stdout) > MAX_BYTES or b"\0" in res.stdout[:8000]:
        return None
    return res.stdout.decode("utf-8", "replace")


def file_text(path: str) -> str | None:
    full = ROOT / path
    try:
        if not full.is_file() or full.stat().st_size > MAX_BYTES:
            return None
        data = full.read_bytes()
    except OSError:
        return None
    if b"\0" in data[:8000]:
        return None
    return data.decode("utf-8", "replace")


def name_findings(path: str) -> list[tuple[str, int, str]]:
    base = path.rsplit("/", 1)[-1]
    if base in FORBIDDEN_EXEMPT:
        return []
    return [(path, 0, rule) for rx, rule in FORBIDDEN_NAMES if rx.search(path)]


def text_findings(path: str, text: str) -> list[tuple[str, int, str]]:
    found = []
    for number, line in enumerate(text.splitlines(), 1):
        if ALLOW_MARK in line:
            continue
        for name, rx in COMPILED:
            for match in rx.finditer(line):
                value = match.group(0)
                if name == "ipv4-public-literal":
                    if TEST_PATH.search(path) or value.split(":")[0] in PUBLIC_IPS:
                        continue
                    # Version strings such as Chrome/120.0.0.0 or 1.2.3.4-beta.
                    before = line[max(0, match.start() - 12):match.start()]
                    if re.search(r"(?:[A-Za-z]/|[Vv]ersion\W?|v)$", before):
                        continue
                found.append((path, number, name))
                break
    return found


def scan(paths: list[str], staged: bool) -> list[tuple[str, int, str]]:
    findings = []
    for path in paths:
        findings.extend(name_findings(path))
        base = path.rsplit("/", 1)[-1]
        if base in SKIP_FILES or Path(path).suffix.lower() in SKIP_SUFFIXES or path.startswith(("fonts/", "node_modules/")) or "/node_modules/" in path:
            continue
        if path == "scripts/secret_scan.py":
            continue
        text = staged_text(path) if staged else file_text(path)
        if text is None:
            continue
        findings.extend(text_findings(path, text))
    return findings


def report(findings: list[tuple[str, int, str]]) -> int:
    if not findings:
        print("secret scan: clean")
        return 0
    for path, line, rule in findings:
        where = f"{path}:{line}" if line else path
        print(f"secret scan: {where}: {rule}")
    print(f"secret scan: {len(findings)} finding(s). Values are not printed. Remove the value, move it to a GitHub or Worker secret, "
          f"or, for a proven false positive, end the line with '{ALLOW_MARK} <reason>'.")
    return 1


def selftest() -> int:
    # Samples are assembled at run time so this file never holds a match.
    j = "".join
    bad = {
        "private-key": j(["-----BEGIN ", "OPENSSH PRIVATE", " KEY-----"]),
        "github-token": j(["gh", "p_", "A1b2" * 9]),
        "stripe-key": j(["sk", "_live_", "Zz9" * 8]),
        "discord-bot-or-user-token": j(["M", "T" * 23, ".", "Gabcde", ".", "x" * 30]),
        "telegram-bot-token": j(["123456789", ":AA", "b" * 33]),
        "jwt": j(["ey", "J", "a" * 20, ".ey", "J", "b" * 20, ".", "c" * 25]),
        "session-cookie": j(["auth", "_token=", "f" * 32]),
        "url-credentials": j(["https://", "user", ":", "hunter22", "@example.org"]),
        "assigned-secret": j(["CLOUDFLARE", "_API_TOKEN = \"", "q" * 30, "\""]),
        "personal-email": j(["someone", "@", "gmail", ".com"]),
        "phone-number": j(["call +", "48 601 234 567"]),
        "signed-url-client-ip": j(["https://r1.example/v?", "ip=", "81.2.69.160"]),
        "ipv4-public-literal": j(["host = \"", "81.2.69.160", "\""]),
    }
    ok = True
    for rule, sample in bad.items():
        got = [f[2] for f in text_findings("t.txt", sample)]
        if rule not in got:
            print(f"selftest: {rule} was not detected")
            ok = False
    good = [
        "contact: pat@example.com, ci@users.noreply.github.com",
        "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36",
        "resolver = \"1.1.1.1\"",
        "candidate:1 1 UDP 1 203.0.113.5 9 typ host",
        "token: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
        "CLOUDFLARE_API_TOKEN = os.environ.get(\"CLOUDFLARE_API_TOKEN\")",
        j(["ghp_", "short"]),
        j(["sk", "_live_", "x" * 20, "  # ", ALLOW_MARK, " documented sample"]),
    ]
    for line in good:
        if text_findings("t.txt", line):
            print("selftest: false positive on a safe line")
            ok = False
    for path, rule in ((".env", "env-file"), ("android/release.jks", "key-file"), ("x/cookies.txt", "cookie-file"), ("dump.har", "capture-or-database")):
        if rule not in [f[2] for f in name_findings(path)]:
            print(f"selftest: {path} was not refused")
            ok = False
    if name_findings(".env.example"):
        print("selftest: .env.example should be allowed")
        ok = False
    print("secret scan selftest " + ("ok" if ok else "FAILED"))
    return 0 if ok else 1


def main(argv: list[str]) -> int:
    if "--selftest" in argv:
        return selftest()
    staged = "--staged" in argv
    paths = [a for a in argv if not a.startswith("--")]
    if not paths:
        paths = git_files(staged)
    return report(scan(paths, staged))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
