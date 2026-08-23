import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { logger } from '@/lib/logger';

const WINDOW_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 31 * 24 * 60 * 60 * 1000;

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { connectionId, timestamp } = await request.json();
    const selectedAt = new Date(timestamp);
    const now = Date.now();

    if (!connectionId || Number.isNaN(selectedAt.getTime())) {
      return NextResponse.json({ success: false, error: 'A connection and valid timestamp are required' }, { status: 400 });
    }
    if (selectedAt.getTime() > now + 60_000 || selectedAt.getTime() < now - MAX_AGE_MS) {
      return NextResponse.json({ success: false, error: 'The selected timestamp is outside the available history window' }, { status: 400 });
    }

    const fromSeconds = Math.floor((selectedAt.getTime() - WINDOW_MS) / 1000);
    const untilSeconds = Math.floor((selectedAt.getTime() + WINDOW_MS) / 1000);
    const sshConfig = await getSshConfig(connectionId);
    const result = await execCommand(sshConfig, buildLogScript(fromSeconds, untilSeconds));
    const output = result.stdout || '';

    return NextResponse.json({
      success: result.code === 0 || Boolean(output.trim()),
      selectedAt: selectedAt.toISOString(),
      from: new Date(fromSeconds * 1000).toISOString(),
      until: new Date(untilSeconds * 1000).toISOString(),
      system: extractSection(output, 'SYSTEM'),
      docker: extractSection(output, 'DOCKER'),
      error: result.code !== 0 && !output.trim() ? (result.stderr || 'Unable to read server logs') : null,
    });
  } catch (error) {
    logger.error('[server-monitor/logs] POST error:', error);
    return NextResponse.json({ success: false, error: error.message || 'Unable to read server logs' }, { status: 500 });
  }
}

function buildLogScript(fromSeconds, untilSeconds) {
  return `
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
FROM="@${fromSeconds}"
UNTIL="@${untilSeconds}"
echo '__MONITOR_SYSTEM__'
if command -v journalctl >/dev/null 2>&1; then
  journalctl --since "$FROM" --until "$UNTIL" --no-pager -n 300 2>&1 | tail -c 90000
else
  echo 'journalctl is not available on this host.'
fi
echo '__MONITOR_DOCKER__'
if command -v docker >/dev/null 2>&1 && docker ps -q >/dev/null 2>&1; then
  docker ps --format '{{.ID}} {{.Names}}' | while read -r id name; do
    [ -z "$id" ] && continue
    echo "--- $name ---"
    docker logs --since "$FROM" --until "$UNTIL" --tail 120 "$id" 2>&1
  done | tail -c 90000
else
  echo 'Docker is not installed, unavailable, or has no running containers.'
fi
`;
}

function extractSection(output, section) {
  const start = `__MONITOR_${section}__`;
  const next = section === 'SYSTEM' ? '__MONITOR_DOCKER__' : null;
  const afterStart = output.split(start)[1] || '';
  return (next ? afterStart.split(next)[0] : afterStart).trim();
}
