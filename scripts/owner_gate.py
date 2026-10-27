#!/usr/bin/env python3
"""Compare an actor with the owner without keeping the owner id in source.

The workflow passes OWNER_ACTOR_SHA256, the hex sha256 of the owner login.
Tests may still pass the same plaintext on both sides.
"""

from __future__ import annotations

import hashlib
import hmac


def allowed(actor: str, owner: str) -> bool:
    actor = actor or ""
    owner = (owner or "").strip()
    if not actor or not owner:
        return False
    folded = owner.lower()
    if len(folded) == 64 and all(ch in "0123456789abcdef" for ch in folded):
        digest = hashlib.sha256(actor.encode("utf-8")).hexdigest()
        return hmac.compare_digest(digest, folded)
    return hmac.compare_digest(actor, owner)
