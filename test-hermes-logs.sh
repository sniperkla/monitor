#!/bin/bash
# Test script to diagnose Hermes log streaming
# Run this ON YOUR fc-fedora40 server

echo "═══════════════════════════════════════════════════════════"
echo "🔍 Hermes Log Streaming Diagnostic Test"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Test 1: Check if log directory exists
echo "📁 Test 1: Checking log directory..."
if [ -d ~/.hermes/logs ]; then
    echo "✅ Directory exists: ~/.hermes/logs"
    ls -lah ~/.hermes/logs/
else
    echo "❌ Directory NOT found: ~/.hermes/logs"
    echo "Creating it now..."
    mkdir -p ~/.hermes/logs
fi
echo ""

# Test 2: Check current log files
echo "📄 Test 2: Current log files..."
LOG_FILES=$(ls -1t ~/.hermes/logs/*.log 2>/dev/null | head -5)
if [ -z "$LOG_FILES" ]; then
    echo "❌ No .log files found"
else
    echo "✅ Found log files:"
    echo "$LOG_FILES"
fi
echo ""

# Test 3: Check which log file tail -F would follow
echo "🎯 Test 3: Which log file would tail -F follow?"
LOGF="$(ls -1t "$HOME/.hermes/logs/"*.log 2>/dev/null | head -1)"
if [ -z "$LOGF" ]; then
    LOGF="$HOME/.hermes/logs/daemon.log"
    echo "⚠️  No log files found, would use: $LOGF"
else
    echo "✅ Would tail: $LOGF"
    echo "   Size: $(stat -c%s "$LOGF" 2>/dev/null || stat -f%z "$LOGF" 2>/dev/null) bytes"
    echo "   Modified: $(stat -c%y "$LOGF" 2>/dev/null || stat -f%Sm "$LOGF" 2>/dev/null)"
fi
echo ""

# Test 4: Show last 10 lines of the log
echo "📋 Test 4: Last 10 lines of log file..."
if [ -f "$LOGF" ]; then
    tail -10 "$LOGF"
else
    echo "❌ Log file doesn't exist yet: $LOGF"
    touch "$LOGF"
    echo "✅ Created empty log file"
fi
echo ""

# Test 5: Write a test entry
echo "✍️  Test 5: Writing test log entry..."
TEST_MSG="[$(date)] 🧪 TEST LOG ENTRY - timestamp $(date +%s)"
echo "$TEST_MSG" >> "$LOGF"
echo "✅ Wrote: $TEST_MSG"
echo ""

# Test 6: Verify the entry was written
echo "🔍 Test 6: Verifying test entry appears in log..."
if tail -5 "$LOGF" | grep -q "TEST LOG ENTRY"; then
    echo "✅ Test entry found in log file!"
    echo "   Last line: $(tail -1 "$LOGF")"
else
    echo "❌ Test entry NOT found - something is wrong"
fi
echo ""

# Test 7: Check if Hermes gateway is running
echo "🤖 Test 7: Checking if Hermes gateway is running..."
if systemctl --user is-active hermes >/dev/null 2>&1; then
    echo "✅ Hermes is running"
    systemctl --user status hermes --no-pager -n 3
elif pgrep -f "hermes.*gateway" >/dev/null; then
    echo "✅ Hermes process found (not systemd):"
    pgrep -af "hermes.*gateway"
else
    echo "❌ Hermes gateway is NOT running"
    echo "   Start it with: hermes gateway start"
fi
echo ""

# Test 8: Test tail -F command (this is what the UI uses)
echo "🔄 Test 8: Testing tail -F command (press Ctrl+C to stop)..."
echo "   This simulates what the UI does. Watch for new lines..."
echo "   In another terminal, run: echo 'LIVE TEST' >> $LOGF"
echo ""
echo "Starting in 3 seconds..."
sleep 3

tail -n 10 -F "$LOGF" 2>/dev/null

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ Test complete! Share the output above."
echo "═══════════════════════════════════════════════════════════"
