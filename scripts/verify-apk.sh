#!/usr/bin/env bash
set -euo pipefail
APK="${1:?APK path required}"
test -s "$APK"
TOOLS="$ANDROID_HOME/build-tools/35.0.0"
certs="$("$TOOLS/apksigner" verify --print-certs "$APK")"
badging="$("$TOOLS/aapt2" dump badging "$APK")"
package="$(sed -n "s/^package: name='\([^']*\)'.*/\1/p" <<< "$badging")"
sha1="$(sed -n 's/^Signer #1 certificate SHA-1 digest: //p' <<< "$certs" | tr -d ':\r ' | tr '[:lower:]' '[:upper:]')"
sha256="$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' <<< "$certs" | tr -d ':\r ' | tr '[:lower:]' '[:upper:]')"
printf 'Package: %s\nSHA-1: %s\nSHA-256: %s\n' "$package" "$sha1" "$sha256"
[[ "$package" == 'jp.chaatu.mailtalk' ]]
[[ "$sha1" == '90E2627BE6F758F8A99AC4DF063AB0A4A26A6A25' ]]
[[ "$sha256" == '0C427EA68FF5A35A523665245B0D69BD60E1E9149720A17F40EA4B40F13367C5' ]]
echo 'Built APK identity matches Google Cloud registration.'
