process.env.ENCRYPTION_KEY = '66f462177aa9fa4f38cf4263c6079f4ddd8f21331614b4f14de1b693cd0bcccc';

const fs = require('fs');
const { decrypt } = require('../src/utils/encryption');

const config = {
  bitbucketConnected: true,
  bitbucketUsername: '9141156de95f013584482731c04a28e9:197d94c9f7fc69081ae0907a58d168b7d3cdefc75d629d7e240af157581c23a0',
  bitbucketAppPassword: '6a9fa4f874940c26bc3d503d40752ddb:e37a881737aa2873170c91482141e58548c39104ddde7856a09072b2af6a2d40e7336ef0246641ed76ad64596f07ef94eaebf5fa056b7f77369272b01077013a1415aca65213860ac0d95778d1d16ff93b38980a0c43140ce4130a0f66dd4ebe44fff442be27804d49e372fc867b811bd3a094225758e6214ebf2600685577ce24e1bf1a7f993e3b7b5266da4cc1289e7626129304b862376d070e9936081ce50aa18da6a524f29705999b916b14ab07dd40663bcc2606c325b62373f0a654a6ea430b2848ccd65fe5f70ae4d8c1ca98',
  branch: 'main',
  deployCommand: 'npm run build'
};
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
try {
  let bbUser = decrypt(config.bitbucketUsername);
  let bbPass = decrypt(config.bitbucketAppPassword);
  if (!bbUser || bbUser.startsWith('DECRYPT_FAIL')) {
    bbUser = 'mock-user@gmail.com';
    bbPass = 'mock-pass';
  }
  const encUser = encodeURIComponent(bbUser);
  const encPass = encodeURIComponent(bbPass);
  scriptLines.push(`echo "[deploy] Configuring Bitbucket credentials..."`);
  scriptLines.push(`BB_URL=$(git remote get-url origin 2>/dev/null || echo "")`);
  scriptLines.push(`if [ -n "$BB_URL" ]; then`);
  scriptLines.push(`  BB_HOST=$(echo "$BB_URL" | sed -E 's|^[^:]+://||' | sed -E 's|/.*||')`);
  scriptLines.push(`  BB_PATH=$(echo "$BB_URL" | sed -E 's|^[^:]+://[^/]+||')`);
  scriptLines.push(`  git remote set-url origin "https://\${encUser}:\${encPass}@\${BB_HOST}\${BB_PATH}"`);
  scriptLines.push(`  echo "[deploy] Bitbucket auth configured"`);
  scriptLines.push(`else`);
  scriptLines.push(`  echo "[deploy] Warning: Could not get remote URL"`);
  scriptLines.push(`fi`);
} catch (e) {
  console.warn('[deploy] Failed to decrypt Bitbucket credentials:', e.message);
}

scriptLines.push(`git fetch origin`);
scriptLines.push(`echo "[deploy] Checking out branch: ${targetBranch}"`);
scriptLines.push(`git checkout -B ${targetBranch} origin/${targetBranch}`);

scriptLines.push('echo "[deploy] Running deploy command..."');
scriptLines.push('npm run build');
scriptLines.push('echo "[deploy] Deploy command finished successfully"');
scriptLines.push(`git remote get-url origin >/dev/null 2>&1 && git remote set-url origin "$(git remote get-url origin | sed -E 's|https://[^@]*@|https://|')" 2>/dev/null || true`);

const deployScript = scriptLines.join('\n') + '\n';
fs.writeFileSync('scratch/deploy_run.sh', deployScript);
console.log('Written to scratch/deploy_run.sh');
