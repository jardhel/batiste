#!/bin/bash
# Usage: ./publish-all.sh <OTP_CODE>
set -e

OTP="$1"
if [ -z "$OTP" ]; then
  echo "Usage: ./publish-all.sh <6-digit-OTP>"
  exit 1
fi

DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Level 0: core, connectors, marketplace ==="
(cd "$DIR/packages/core" && npm publish --access public --otp="$OTP") &
(cd "$DIR/packages/connectors" && npm publish --access public --otp="$OTP") &
(cd "$DIR/packages/marketplace" && npm publish --access public --otp="$OTP") &
wait
echo "✓ Level 0 done"

echo "=== Level 1: audit, auth, scope, transport, code ==="
(cd "$DIR/packages/audit" && npm publish --access public --otp="$OTP") &
(cd "$DIR/packages/auth" && npm publish --access public --otp="$OTP") &
(cd "$DIR/packages/scope" && npm publish --access public --otp="$OTP") &
(cd "$DIR/packages/transport" && npm publish --access public --otp="$OTP") &
(cd "$DIR/packages/code" && npm publish --access public --otp="$OTP") &
wait
echo "✓ Level 1 done"

echo "=== Level 2: aidk ==="
(cd "$DIR/packages/aidk" && npm publish --access public --otp="$OTP")
echo "✓ Level 2 done"

echo "=== Level 3: cli ==="
(cd "$DIR/packages/cli" && npm publish --access public --otp="$OTP")
echo "✓ Level 3 done"

echo ""
echo "🎉 All 10 @batiste-aidk packages published!"
