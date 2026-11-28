#!/bin/sh
# Publishes a release built by `bun run release:build` as the latest GitHub release.
#
#   scripts/publish-release.sh v1.0.0-build.1180
#
# Run it only when the owner has approved publishing. It refuses a build whose commit is not on
# origin/main, and it uploads exactly the files in dist/release/<tag>/: the APK, the CLI binaries
# and SHA256SUMS, with notes.md as the release notes.
set -eu

tag="${1:-}"
[ -n "$tag" ] || { echo "usage: scripts/publish-release.sh <tag>" >&2; exit 2; }
root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/dist/release/$tag"
[ -d "$dir" ] || { echo "no build at $dir; run bun run release:build first" >&2; exit 1; }
[ -f "$dir/SHA256SUMS" ] && [ -f "$dir/notes.md" ] || { echo "$dir is incomplete" >&2; exit 1; }

# The commit the build came from is in the APK's versionName (X.Y.Z+<sha>) and the notes' first line.
sha="$(sed -n '1s/^Puck [0-9.]*+\([0-9a-f]*\) .*/\1/p' "$dir/notes.md")"
[ -n "$sha" ] || { echo "could not read the build's commit from notes.md" >&2; exit 1; }
git -C "$root" fetch --quiet origin main
git -C "$root" merge-base --is-ancestor "$sha" origin/main || {
  echo "commit $sha is not on origin/main; push it first" >&2
  exit 1
}
(cd "$dir" && shasum -a 256 -c SHA256SUMS >/dev/null) || { echo "checksums in $dir do not match" >&2; exit 1; }

set --
for file in "$dir"/*; do
  case "$(basename "$file")" in notes.md) ;; *) set -- "$@" "$file" ;; esac
done

echo "Publishing $tag ($sha) with:"
for file in "$@"; do echo "  $(basename "$file")"; done
gh release create "$tag" "$@" \
  --repo ZeshanGIT/puck \
  --target "$(git -C "$root" rev-parse "$sha")" \
  --title "Puck $tag" \
  --notes-file "$dir/notes.md" \
  --latest
