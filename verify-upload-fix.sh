#!/bin/bash
# Upload Connection Fix Verification Script
# Run this to check if the fixes were applied correctly

echo "🔍 Upload Connection Fix Verification"
echo "======================================"
echo ""

check_file() {
  local file=$1
  local pattern=$2
  local description=$3
  
  if grep -q "$pattern" "$file"; then
    echo "✅ $description"
    return 0
  else
    echo "❌ $description - NOT FOUND"
    return 1
  fi
}

failed=0

echo "Checking Server Relay (src/lib/wsRelayServer.js)..."
check_file "src/lib/wsRelayServer.js" "resuming: opts.resuming" "Resume parameter added"
failed=$((failed + $?))
check_file "src/lib/wsRelayServer.js" "resumed: true" "Resume response implemented"
failed=$((failed + $?))
check_file "src/lib/wsRelayServer.js" "completionTimer = setTimeout" "Improved upload completion timing"
failed=$((failed + $?))
check_file "src/lib/wsRelayServer.js" ", 500)" "500ms timeout for completion"
failed=$((failed + $?))
echo ""

echo "Checking Relay Client (src/lib/relayClient.js)..."
check_file "src/lib/relayClient.js" "resuming = false" "Resume parameter in requestConnection"
failed=$((failed + $?))
check_file "src/lib/relayClient.js" "resuming," "Resume parameter passed to server"
failed=$((failed + $?))
echo ""

echo "Checking FileManager (src/components/FileManager.js)..."
check_file "src/components/FileManager.js" "hasActiveTransfer" "Active transfer check added"
failed=$((failed + $?))
check_file "src/components/FileManager.js" "Skipping reconnection check - active transfer" "Skip logic implemented"
failed=$((failed + $?))
echo ""

echo "Checking Local Relay (public/local-relay.js)..."
check_file "public/local-relay.js" "completionTimer = null" "Completion timer variable added"
failed=$((failed + $?))
check_file "public/local-relay.js" "clearTimeout(completionTimer)" "Timer cleanup implemented"
failed=$((failed + $?))
check_file "public/local-relay.js" ", 500)" "500ms timeout for local relay"
failed=$((failed + $?))
echo ""

echo "Checking minified local relay (public/local-relay.min.js)..."
if [ -f "public/local-relay.min.js" ]; then
  echo "✅ Minified local relay exists"
  file_size=$(stat -f%z "public/local-relay.min.js" 2>/dev/null || stat -c%s "public/local-relay.min.js" 2>/dev/null)
  if [ "$file_size" -gt 50000 ]; then
    echo "✅ Minified file has reasonable size: $file_size bytes"
  else
    echo "⚠️  Minified file seems small: $file_size bytes - check if build succeeded"
  fi
else
  echo "❌ Minified local relay not found - run: npm run build:relay"
  failed=$((failed + 1))
fi
echo ""

echo "======================================"
if [ $failed -eq 0 ]; then
  echo "✅ All checks passed! Fixes are properly applied."
  echo ""
  echo "Next steps:"
  echo "1. Restart your dev server: npm run dev"
  echo "2. Test upload during tab switches"
  echo "3. Check console logs for '⏭️ Skipping reconnection check' during active uploads"
  exit 0
else
  echo "❌ $failed check(s) failed. Please review the fixes."
  exit 1
fi
