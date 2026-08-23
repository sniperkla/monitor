import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSshConfig, execCommand } from '@/app/api/server-backup/_ssh';
import { logger } from '@/lib/logger';

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { targetSshConnId } = await req.json();

    if (!targetSshConnId) {
      return NextResponse.json({ success: false, error: 'targetSshConnId is required' }, { status: 400 });
    }

    const sshConfig = await getSshConfig(targetSshConnId);

    const checkScript = `
# Check for required tools
check_cmd() {
  if command -v "$1" > /dev/null 2>&1; then
    echo "$1:installed:$(command -v "$1")"
  elif [ -x "$HOME/.local/bin/$1" ]; then
    echo "$1:installed:$HOME/.local/bin/$1"
  else
    echo "$1:missing"
  fi
}

check_cmd mongoexport
check_cmd mongosh
check_cmd mongo
check_cmd python3

# Check if sudo available
if command -v sudo > /dev/null 2>&1 && sudo -n true 2>/dev/null; then
  echo "sudo:available"
else
  echo "sudo:unavailable"
fi

# Check package manager
if command -v apt-get > /dev/null 2>&1; then
  echo "pkg_manager:apt-get"
elif command -v yum > /dev/null 2>&1; then
  echo "pkg_manager:yum"
elif command -v dnf > /dev/null 2>&1; then
  echo "pkg_manager:dnf"
else
  echo "pkg_manager:none"
fi

# Check architecture for fallback install
echo "arch:$(uname -m)"
`;

    const result = await execCommand(sshConfig, checkScript);
    
    if (result.code !== 0) {
      return NextResponse.json({
        success: false,
        error: `SSH check failed: ${result.stderr || result.stdout}`,
      }, { status: 500 });
    }

    const output = result.stdout;
    const lines = output.split('\n').map(l => l.trim()).filter(Boolean);

    const status = {
      mongoexport: { installed: false, path: null },
      mongosh: { installed: false, path: null },
      mongo: { installed: false, path: null },
      python3: { installed: false, path: null },
      sudo: false,
      pkgManager: null,
      arch: null,
    };

    lines.forEach(line => {
      const [key, ...rest] = line.split(':');
      if (key === 'mongoexport' || key === 'mongosh' || key === 'mongo' || key === 'python3') {
        if (rest[0] === 'installed') {
          status[key].installed = true;
          status[key].path = rest.slice(1).join(':');
        }
      } else if (key === 'sudo') {
        status.sudo = rest[0] === 'available';
      } else if (key === 'pkg_manager') {
        status.pkgManager = rest[0] === 'none' ? null : rest[0];
      } else if (key === 'arch') {
        status.arch = rest.join(':');
      }
    });

    const missingTools = [];
    if (!status.mongoexport.installed) missingTools.push('mongoexport');
    if (!status.mongosh.installed && !status.mongo.installed) missingTools.push('mongosh or mongo shell');
    if (!status.python3.installed) missingTools.push('python3 (optional, for fallback)');

    return NextResponse.json({
      success: true,
      status,
      missingTools,
      canAutoInstall: status.sudo || status.pkgManager || status.arch,
      recommendations: generateRecommendations(status),
    });

  } catch (error) {
    logger.error('[check-dependencies] error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

function generateRecommendations(status) {
  const recs = [];

  if (!status.mongoexport.installed) {
    if (status.sudo && status.pkgManager === 'apt-get') {
      recs.push('Will auto-install mongodb-database-tools via: sudo apt-get install -y mongodb-database-tools');
    } else if (status.sudo && (status.pkgManager === 'yum' || status.pkgManager === 'dnf')) {
      recs.push(`Will auto-install mongodb-database-tools via: sudo ${status.pkgManager} install -y mongodb-database-tools`);
    } else if (status.arch) {
      recs.push(`Will download and install mongodb-database-tools to ~/.local/bin/ for ${status.arch}`);
    } else {
      recs.push('⚠️ Cannot auto-install mongoexport. You must install manually before proceeding.');
    }
  }

  if (!status.mongosh.installed && !status.mongo.installed && !status.python3.installed) {
    recs.push('⚠️ No shell tool found. The script uses fallback methods but collection listing may fail.');
  }

  if (!status.python3.installed) {
    recs.push('ℹ️ python3 not installed. Will rely on mongosh/mongo for collection listing.');
  }

  return recs;
}
