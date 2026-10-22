#!/usr/bin/env python3
"""Print Cloudflare R2 usage and warn near the free-tier cap.

This does not upload feed media. Videos and other files larger than 1 MiB
stay on the source URL. Account images already stored by the worker, and the
public music and radio bucket, are the R2 copies that exist.

CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are read from the environment.
When either is missing, this prints that usage was not measured and exits 0.
The token is never printed.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

SMALL_COPY_BYTES = 1024 * 1024
WARN_BYTES = 8 * 1024 ** 3
FREE_BYTES = 10 * 1024 ** 3
GRAPHQL = "https://api.cloudflare.com/client/v4/graphql"


def kept_copy(kind: str, size: int) -> str:
    """Where a new file is kept. Anything over 1 MiB stays on the source URL."""
    try:
        nbytes = int(size)
    except (TypeError, ValueError):
        nbytes = SMALL_COPY_BYTES + 1
    if nbytes > SMALL_COPY_BYTES:
        return "source"
    return "r2"


def should_warn(nbytes: int) -> bool:
    try:
        return int(nbytes) >= WARN_BYTES
    except (TypeError, ValueError):
        return False


def warn_line(nbytes: int) -> str:
    if not should_warn(nbytes):
        return ""
    return f"[r2] warning: usage is {format_gb(int(nbytes))}, at or above 8 GB of the 10 GB free tier"


def policy_line() -> str:
    return "[r2] videos and other files larger than 1 MiB stay on the source URL. R2 is not given a full video copy."


def format_gb(nbytes: int) -> str:
    return f"{nbytes / (1024 ** 3):.2f} GB"


def scrub(text: str, secrets) -> str:
    cleaned = str(text)
    for secret in secrets:
        if secret:
            cleaned = cleaned.replace(str(secret), "***")
    return cleaned


def _num(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def latest_totals(groups) -> dict:
    """Sum the newest sample for each bucket. One series with no bucket name is account-wide."""
    latest = {}
    for row in groups or []:
        if not isinstance(row, dict):
            continue
        dims = row.get("dimensions") if isinstance(row.get("dimensions"), dict) else {}
        bucket = str(dims.get("bucketName") or "")
        when = str(dims.get("datetime") or dims.get("datetimeHour") or "")
        previous = latest.get(bucket)
        if previous is None or when >= previous[0]:
            latest[bucket] = (when, row.get("max") if isinstance(row.get("max"), dict) else {})
    payload = metadata = objects = 0
    for _when, sample in latest.values():
        payload += _num(sample.get("payloadSize"))
        metadata += _num(sample.get("metadataSize"))
        objects += _num(sample.get("objectCount"))
    return {"payload": payload, "metadata": metadata, "objects": objects, "buckets": len(latest)}


def _graphql(token: str, account: str, dimensions: str, urlopen) -> list:
    end = datetime.now(timezone.utc).replace(microsecond=0)
    start = end - timedelta(days=2)
    query = f"""
    query ($accountTag: String!, $startDate: Time!, $endDate: Time!) {{
      viewer {{
        accounts(filter: {{accountTag: $accountTag}}) {{
          r2StorageAdaptiveGroups(
            limit: 10000
            filter: {{datetime_geq: $startDate, datetime_leq: $endDate}}
            orderBy: [datetime_DESC]
          ) {{
            max {{ payloadSize metadataSize objectCount }}
            dimensions {{ {dimensions} }}
          }}
        }}
      }}
    }}
    """
    body = json.dumps({
        "query": query,
        "variables": {
            "accountTag": account,
            "startDate": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "endDate": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
    }).encode("utf-8")
    request = urllib.request.Request(
        GRAPHQL,
        data=body,
        method="POST",
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "User-Agent": "r2-usage/1.0",
        },
    )
    with urlopen(request, timeout=30) as response:
        payload = response.read()
    doc = json.loads(payload.decode("utf-8"))
    if doc.get("errors"):
        raise RuntimeError("storage query was rejected")
    accounts = ((doc.get("data") or {}).get("viewer") or {}).get("accounts") or []
    if not accounts or not isinstance(accounts[0], dict):
        return []
    groups = accounts[0].get("r2StorageAdaptiveGroups") or []
    return groups if isinstance(groups, list) else []


def measure(token: str, account: str, urlopen=urllib.request.urlopen) -> dict:
    last_error = None
    for dimensions in ("datetime bucketName", "bucketName", "datetime"):
        try:
            groups = _graphql(token, account, dimensions, urlopen)
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, RuntimeError, UnicodeError, ValueError) as err:
            last_error = err
            continue
        if groups:
            return latest_totals(groups)
    if last_error:
        raise last_error
    return {"payload": 0, "metadata": 0, "objects": 0, "buckets": 0}


def _credentials() -> tuple[str, str] | None:
    token = (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
    account = (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    if token and account:
        return token, account
    return None


def main() -> int:
    print(policy_line())
    creds = _credentials()
    if not creds:
        print("[r2] usage was not measured; CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set")
        return 0
    token, account = creds
    try:
        totals = measure(token, account)
    except Exception as err:
        print("[r2] usage was not measured:", scrub(str(err), [token, account]))
        return 0
    total = totals["payload"] + totals["metadata"]
    print(
        f"[r2] usage {format_gb(total)} "
        f"(payload {format_gb(totals['payload'])}, metadata {format_gb(totals['metadata'])}, "
        f"objects {totals['objects']}, buckets {totals['buckets']}) of the 10 GB free tier"
    )
    if total == 0 and totals["buckets"] == 0:
        print("[r2] usage was not measured; the storage query returned no rows")
    warning = warn_line(total)
    if warning:
        print(warning)
    return 0


if __name__ == "__main__":
    sys.exit(main())
