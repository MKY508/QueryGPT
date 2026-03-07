#!/bin/sh
set -eu

APP_DIR="/workspace/apps/web"
CACHE_DIR="/opt/querygpt/web-node_modules"
IMAGE_HASH_FILE="/opt/querygpt/package-lock.sha256"
TARGET_HASH_FILE="$APP_DIR/node_modules/.package-lock.sha256"

package_lock_hash() {
  sha256sum package-lock.json | awk '{print $1}'
}

copy_cached_modules() {
  mkdir -p node_modules
  find node_modules -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  cp -a "$CACHE_DIR"/. node_modules/
  printf '%s\n' "$1" > "$TARGET_HASH_FILE"
}

install_modules() {
  npm ci
  printf '%s\n' "$1" > "$TARGET_HASH_FILE"
}

cd "$APP_DIR"

current_hash="$(package_lock_hash)"
image_hash="$(cat "$IMAGE_HASH_FILE" 2>/dev/null || true)"
target_hash="$(cat "$TARGET_HASH_FILE" 2>/dev/null || true)"

if [ ! -d node_modules/.bin ] || [ "$current_hash" != "$target_hash" ]; then
  if [ -n "$image_hash" ] && [ "$current_hash" = "$image_hash" ]; then
    copy_cached_modules "$current_hash"
  else
    install_modules "$current_hash"
  fi
fi

exec "$@"
