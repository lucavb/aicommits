#!/usr/bin/env bash
# Bundle-verification gate for the Release workflow (the a84c636 supply-chain
# check, reshaped).
#
# The freshly built dist/cli.mjs must match the committed reference digest in
# dist/cli.mjs.reference.sha256. On mismatch the change is either explained
# or unexplained:
#
#   explained — a tracked build input (src/, rollup.config.ts, tsconfig.json,
#     package.json, package-lock.json, .nvmrc) changed since the reference
#     was last refreshed, compared against the working tree so local
#     uncommitted changes count (brand-new untracked files do not — commit
#     them first). The reference is refreshed: in CI (BUNDLE_REFRESH_PUSH=1)
#     it is committed and pushed as a [skip ci] commit; locally the file is
#     rewritten for the developer to commit.
#
#   unexplained — the bundle changed with no tracked input changing. That is
#     artifact drift (dependency or toolchain tampering, poisoned build
#     environment) and the gate fails closed: the artifact must not ship
#     until a human explains it.
set -euo pipefail

bundle='dist/cli.mjs'
reference='dist/cli.mjs.reference.sha256'
inputs=(src/ rollup.config.ts tsconfig.json package.json package-lock.json .nvmrc)

digest() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d' ' -f1
    else
        shasum -a 256 "$1" | cut -d' ' -f1
    fi
}

if [[ ! -f "$bundle" ]]; then
    echo "::error::verify-bundle: $bundle not found — run 'npm run build' first."
    exit 1
fi

built=$(digest "$bundle")
committed=$(cut -d' ' -f1 "$reference")

if [[ "$built" == "$committed" ]]; then
    echo "verify-bundle: $bundle matches the committed reference ($built)."
    exit 0
fi

echo "verify-bundle: digest mismatch — built $built, committed $committed."

last_refresh=$(git log -1 --format=%H -- "$reference")
if [[ -z "$last_refresh" ]]; then
    echo "::error::verify-bundle: no commit in history touches $reference; refusing to auto-refresh."
    exit 1
fi

if git diff --quiet "$last_refresh" -- "${inputs[@]}"; then
    echo "::error::verify-bundle: $bundle changed but no tracked build input changed since $last_refresh — unexplained artifact drift. Do not ship until the cause is found. To refresh the reference anyway: npm run build && sha256sum $bundle > $reference and commit the result."
    exit 1
fi

printf '%s  %s\n' "$built" "$bundle" > "$reference"

if [[ "${BUNDLE_REFRESH_PUSH:-}" == "1" ]]; then
    git config user.name 'github-actions[bot]'
    git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
    git add "$reference"
    git commit -m "chore(ci): auto-refresh bundle reference digest [skip ci]"
    if ! git push origin "HEAD:refs/heads/${GITHUB_REF_NAME}"; then
        echo "::error::verify-bundle: lost the push race (the branch moved while this run refreshed the reference); the newer commit's run will retry."
        exit 1
    fi
    echo "verify-bundle: reference auto-refreshed to $built and pushed."
else
    echo "verify-bundle: reference rewritten locally to $built — commit it together with your change."
fi
