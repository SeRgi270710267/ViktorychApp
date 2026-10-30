#!/bin/sh
# Installs a pre-commit hook that refuses commits containing secrets or
# personal data. Prints only file, line, and rule; never the value.
set -e
root=$(git rev-parse --show-toplevel)
hooks=$(git rev-parse --git-path hooks)
mkdir -p "$hooks"
cat > "$hooks/pre-commit" <<'HOOK'
#!/bin/sh
root=$(git rev-parse --show-toplevel)
exec python3 "$root/scripts/secret_scan.py" --staged
HOOK
chmod +x "$hooks/pre-commit"
echo "pre-commit secret scan installed in $hooks"
