#!/bin/bash
# Build and sign the TV app. The key stays outside the repo:
#   KEYDIR (default /workspace/secrets) holds viktorychtv.jks and viktorychtv.pass.
# Needs JDK 17 and the Android SDK (platform 35, build-tools 35).
set -euo pipefail
cd "$(dirname "$0")"
KEYDIR=${KEYDIR:-/workspace/secrets}
export TV_KEYSTORE="$KEYDIR/viktorychtv.jks"
TV_KEYSTORE_PASS="$(cat "$KEYDIR/viktorychtv.pass")"; export TV_KEYSTORE_PASS
export TV_KEY_ALIAS=viktorychtv
gradle --no-daemon -q assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../tv/ViktorychTV.apk
echo "built ../tv/ViktorychTV.apk"
