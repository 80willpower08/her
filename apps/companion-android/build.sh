#!/usr/bin/env bash
# Convenience wrapper: builds the companion APK from WSL.
#
# Why this script exists: /mnt/c/ (the Windows-mounted filesystem) doesn't
# support the filesystem semantics Gradle's internal lock files expect, so
# we redirect Gradle's project cache to a native WSL path. Without that
# we get "Input/output error" creating OutputFilesRepository.
#
# Usage:
#   ./build.sh              # debug APK
#   ./build.sh release      # release APK (unsigned)

set -eo pipefail

# Source the user's shell so JAVA_HOME / ANDROID_HOME / etc are resolved
# the same way as in an interactive WSL terminal. sdkman's init script
# touches unbound vars, so we disable -u just for that block.
if [ -s "$HOME/.sdkman/bin/sdkman-init.sh" ]; then
    set +u
    source "$HOME/.sdkman/bin/sdkman-init.sh"
    set -u
fi
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export JAVA_HOME="${JAVA_HOME:-$HOME/.sdkman/candidates/java/current}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

CACHE_DIR="$HOME/.her-companion-cache"
mkdir -p "$CACHE_DIR"

VARIANT="${1:-debug}"
case "$VARIANT" in
    debug)   TASK=assembleDebug ;;
    release) TASK=assembleRelease ;;
    *) echo "Unknown variant: $VARIANT (use debug or release)"; exit 1 ;;
esac

cd "$(dirname "$0")"

# Make sure local.properties points at the SDK.
echo "sdk.dir=$ANDROID_HOME" > local.properties

./gradlew --project-cache-dir="$CACHE_DIR" "$TASK"

APK_DIR="app/build/outputs/apk/$VARIANT"
APK=$(ls -t "$APK_DIR"/*.apk 2>/dev/null | head -1 || true)
if [ -n "$APK" ]; then
    echo ""
    echo "✅ APK built: $APK"
    echo "Size: $(du -h "$APK" | awk '{print $1}')"
    echo ""
    echo "Permissions baked in:"
    "$ANDROID_HOME/build-tools/34.0.0/aapt" dump permissions "$APK" \
        | grep uses-permission \
        | grep -v DYNAMIC_RECEIVER
fi
