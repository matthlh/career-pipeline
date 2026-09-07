#!/bin/sh
# Refuse to publish a real address.
#
# The repo is public and the contact store is not. Only RFC 2606 reserved
# domains may ship: the .example TLD used by data.example.js, and example.com
# for placeholders. Anything else is a real person's inbox.
#
#   scripts/leakcheck.sh app/dist          check a build artifact
#   scripts/leakcheck.sh                   check everything git would publish
#
# With no arguments it scans tracked files *and* untracked ones that gitignore
# does not exclude - that is, everything a `git add -A` would sweep in. Scanning
# only tracked files meant a new file could not fail this until after it had
# already been committed, which is the moment it stops being cheap to fix.
#
# Exit 1 on a find, so it works as a pre-commit hook and as a CI gate.
set -eu

if [ $# -gt 0 ]; then
  found=$(grep -rhoE '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' "$@" 2>/dev/null || true)
else
  found=$(git ls-files -z --cached --others --exclude-standard | xargs -0 grep -hoE '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' 2>/dev/null || true)
fi

leaks=$(printf '%s\n' "$found" \
  | grep -viE '@[a-zA-Z0-9.-]*\.example$|@example\.(com|org|net)$' \
  | grep -v '^$' | sort -u || true)

if [ -n "$leaks" ]; then
  echo "Real-looking addresses found - refusing:" >&2
  printf '%s\n' "$leaks" >&2
  exit 1
fi
echo "No real addresses in ${*:-anything git would publish}."
