const resolvedPath = './expense-bot-frontend/';
const targetBranch = 'main';
const commitSha = null;

const scriptLines = [
  '#!/bin/bash',
  'echo "[deploy] Starting deployment on $(hostname) at $(date)"',
  'echo "[deploy] Working directory: ' + resolvedPath + '"',
  `if [ ! -d "${resolvedPath}" ]; then echo "[deploy] ERROR: Directory '${resolvedPath}' does not exist"; exit 1; fi`,
  `cd "${resolvedPath}" || { echo "[deploy] ERROR: Cannot cd to ${resolvedPath}"; exit 1; }`,
  'echo "[deploy] Now in: $(pwd)"',
  'set -e',
  'set -o pipefail',
];

// Step 1: Strip any stale embedded credentials from remote URL
scriptLines.push('if git remote get-url origin >/dev/null 2>&1; then');
scriptLines.push('  CURRENT_URL=$(git remote get-url origin)');
scriptLines.push('  if [[ "$CURRENT_URL" =~ ^https?://[^/]*@ ]]; then');
scriptLines.push('    CLEAN_URL=""');
scriptLines.push('    if [[ "$CURRENT_URL" == *github.com* ]]; then');
scriptLines.push('      CLEAN_URL="https://github.com/$(echo "$CURRENT_URL" | sed -E \'s|.*github\\.com/||\')"');
scriptLines.push('    elif [[ "$CURRENT_URL" == *bitbucket.org* ]]; then');
scriptLines.push('      CLEAN_URL="https://bitbucket.org/$(echo "$CURRENT_URL" | sed -E \'s|.*bitbucket\\.org/||\')"');
scriptLines.push('    fi');
scriptLines.push('    if [ -n "$CLEAN_URL" ]; then');
scriptLines.push('      echo "[deploy] Cleaned stale credentials from remote URL"');
scriptLines.push('      git remote set-url origin "$CLEAN_URL"');
scriptLines.push('    fi');
scriptLines.push('  fi');
scriptLines.push('fi');

// Step 2: Embed fresh credentials in git remote URL
// Pre-encode credentials with URL-safe encoding in JavaScript (avoids python3 dependency)
const bbUser = 'sniperkla@gmail.com';
const bbPass = 'ATATT3x...';
if (bbUser && bbPass) {
  // URL-encode in JS: @ → %40, = → %3D, : → %3A, etc.
  const encUser = encodeURIComponent(bbUser);
  const encPass = encodeURIComponent(bbPass);
  scriptLines.push(`echo "[deploy] Configuring Bitbucket credentials..."`);
  scriptLines.push(`BB_URL=$(git remote get-url origin 2>/dev/null || echo "")`);
  scriptLines.push(`if [ -n "$BB_URL" ]; then`);
  scriptLines.push(`  BB_HOST=$(echo "$BB_URL" | sed -E 's|^[^:]+://||' | sed -E 's|/.*||')`);
  scriptLines.push(`  BB_PATH=$(echo "$BB_URL" | sed -E 's|^[^:]+://[^/]+||')`);
  scriptLines.push(`  git remote set-url origin "https://${encUser}:${encPass}@${BB_HOST}${BB_PATH}"`);
  scriptLines.push(`  echo "[deploy] Bitbucket auth configured"`);
  scriptLines.push(`else`);
  scriptLines.push(`  echo "[deploy] Warning: Could not get remote URL"`);
  scriptLines.push(`fi`);
}

scriptLines.push(`git fetch origin`);
scriptLines.push(`echo "[deploy] Checking out branch: ${targetBranch}"`);
scriptLines.push(`git checkout -B ${targetBranch} origin/${targetBranch}`);

scriptLines.push('echo "[deploy] Running deploy command..."');
scriptLines.push('npm run build');
scriptLines.push('echo "[deploy] Deploy command finished successfully"');
scriptLines.push(`git remote get-url origin >/dev/null 2>&1 && git remote set-url origin "$(git remote get-url origin | sed -E 's|https://[^@]*@|https://|')" 2>/dev/null || true`);

const deployScript = scriptLines.join('\n') + '\n';
console.log('--- GENERATED SCRIPT ---');
console.log(deployScript);
console.log('------------------------');
