import { Client } from 'ssh2';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig } from '@/app/api/server-backup/_ssh';

export const runtime = 'nodejs';

const DOCKER_FOLLOW_SCRIPT = `
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
if ! command -v docker >/dev/null 2>&1; then
  echo '__MONITOR_ERROR__: Docker is not installed on this host.'
  exit 0
fi
CONTAINERS="$(docker ps --format '{{.ID}} {{.Names}}' 2>&1)"
if [ -z "$CONTAINERS" ]; then
  echo '__MONITOR_STATUS__: No running Docker containers.'
  exit 0
fi
PIDS=""
cleanup() { kill $PIDS 2>/dev/null || true; }
trap cleanup EXIT INT TERM
while read -r id name; do
  [ -z "$id" ] && continue
  (
    docker logs --follow --tail 100 --timestamps "$id" 2>&1 | sed -u "s/^/[$name] /"
  ) &
  PIDS="$PIDS $!"
done <<EOF
$CONTAINERS
EOF
wait
`;

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const connectionId = new URL(request.url).searchParams.get('connectionId');
  if (!connectionId) return new Response('Missing connectionId', { status: 400 });

  let sshConfig;
  try {
    sshConfig = await getSshConfig(connectionId);
  } catch (error) {
    return new Response(error.message || 'Unable to open SSH connection', { status: 400 });
  }

  const encoder = new TextEncoder();
  let client;
  let stream;
  let heartbeat;
  let closed = false;

  const close = (controller) => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    try { stream?.close(); } catch {}
    try { client?.end(); } catch {}
    try { controller.close(); } catch {}
  };

  const body = new ReadableStream({
    start(controller) {
      const send = (message) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ message })}\n\n`));
      };
      const sendError = (message) => send(`__MONITOR_ERROR__: ${message}`);

      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(': keepalive\n\n'));
      }, 15_000);

      request.signal.addEventListener('abort', () => close(controller), { once: true });

      client = new Client();
      client.on('ready', () => {
        client.exec(DOCKER_FOLLOW_SCRIPT, (error, sshStream) => {
          if (error) {
            sendError(error.message || 'Unable to start Docker log stream.');
            close(controller);
            return;
          }
          stream = sshStream;
          send('Connected. Following Docker logs from all running containers.');
          stream.on('data', data => send(data.toString()));
          stream.stderr.on('data', data => send(data.toString()));
          stream.on('close', () => close(controller));
        });
      });
      client.on('error', error => {
        sendError(error.message || 'SSH connection closed.');
        close(controller);
      });
      client.connect(sshConfig);
    },
    cancel() {
      close({ close() {} });
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
