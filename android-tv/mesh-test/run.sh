#!/bin/bash
# Plain-JVM checks for the TV app's Bitchat mesh (crypto, Noise XX, packets, relay).
# Needs JDK 17. Optional: pip install noiseprotocol for the Noise interop check.
set -euo pipefail
cd "$(dirname "$0")"
JAVA_HOME=${JAVA_HOME:-/workspace/android/jdk}
out=$(mktemp -d); trap 'rm -rf "$out"' EXIT
"$JAVA_HOME/bin/javac" -d "$out" ../app/src/main/java/app/viktorych/tv/mesh/{Crypto,Noise,Packet,MeshCore,NostrSign}.java MeshTest.java
if python3 -c "import noise" 2>/dev/null; then
  mkdir "$out/io"; python3 interop.py "$out/io" & py=$!
  "$JAVA_HOME/bin/java" -cp "$out" MeshTest "$out/io"; wait $py
else
  "$JAVA_HOME/bin/java" -cp "$out" MeshTest
fi
if [ -f "$out/io/event.json" ] && command -v node >/dev/null; then
  node -e '
    const N = require("../../nostr.js"); const ev = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    Promise.resolve(N.verifyEvent(ev)).then(ok => { const pow = parseInt(ev.id.slice(0, 2), 16) === 0;
      console.log((ok && pow ? "ok   " : "FAIL ") + "nostr event verifies in nostr.js, 8-bit PoW"); process.exit(ok && pow ? 0 : 1); });' "$out/io/event.json"
fi
# Nostr receive path (parse, id and signature check, area filter, dedup). Needs org.json,
# which plain Java lacks: set JSON_JAR to a json-*.jar (Maven org.json:json) to run it.
if [ -n "${JSON_JAR:-}" ] && [ -f "$JSON_JAR" ]; then
  "$JAVA_HOME/bin/javac" -d "$out" -cp "$out:$JSON_JAR" stubs/android/util/Base64.java stubs/android/os/Build.java \
    ../app/src/main/java/app/viktorych/tv/mesh/NostrRelay.java NostrRelayTest.java
  "$JAVA_HOME/bin/java" -cp "$out:$JSON_JAR" app.viktorych.tv.mesh.NostrRelayTest
fi
