// Test cleanLogStream function with real Hermes logs

const cleanLogStream = (text) => {
  if (!text) return '';
  return text
    .replace(/\x1b\[\??[0-9;]*[a-zA-Z]/g, '') // ANSI control & bracketed paste
    .replace(/\[\?2004[hl]\]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/^Last login:.*\r?\n?/gm, '')
    .replace(/^\[root@[^\]]+\][#\$]?\s*/gm, '')
    .replace(/^\[[^\]@]+@[^\]]+\][\$#]\s*/gm, '')
    .replace(/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+:[^$#]*[\$#]\s*/gm, '')
    .replace(/^stty -echo.*\r?\n?/gm, '')
    .replace(/^sh -c '[\s\S]*?fi'\r?\n?/gm, '')
    .replace(/^.*(?:for f in|journalctl --user -u|tail -n [0-9]+|LOGF="").*\r?\n?/gm, '')
    .trimStart();
};

// Your actual Hermes logs
const testLog = `2026-08-28 07:30:39,807 WARNING hermes_plugins.telegram_platform.adapter: [Telegram] Telegram polling conflict (1/5) — previous session still held open on Telegram's servers. Waiting 20s for it to expire. Error: Conflict: terminated by other getUpdates request; make sure that only one bot instance is running
2026-08-28 07:31:06,324 WARNING hermes_plugins.telegram_platform.adapter: [Telegram] Telegram polling conflict (2/5) — previous session still held open on Telegram's servers. Waiting 30s for it to expire. Error: Conflict: terminated by other getUpdates request; make sure that only one bot instance is running
2026-08-28 07:34:21,148 WARNING hermes_plugins.telegram_platform.adapter: [Telegram] Updater made no getUpdates progress and is not running
2026-08-28 07:34:35,213 WARNING tools.registry: check_fn check_browser_back_requirements returned False; dependent tools will be unavailable this turn`;

console.log('=== ORIGINAL LOG ===');
console.log(testLog);
console.log('\n=== AFTER cleanLogStream ===');
const cleaned = cleanLogStream(testLog);
console.log(cleaned);
console.log('\n=== STATS ===');
console.log(`Original: ${testLog.length} chars`);
console.log(`Cleaned: ${cleaned.length} chars`);
console.log(`Filtered out: ${testLog.length - cleaned.length} chars`);

if (cleaned.length === 0) {
  console.log('\n❌ ERROR: All content was filtered out!');
} else if (cleaned.length < testLog.length * 0.5) {
  console.log('\n⚠️  WARNING: More than 50% of content was filtered out');
} else {
  console.log('\n✅ Cleaner looks OK');
}
