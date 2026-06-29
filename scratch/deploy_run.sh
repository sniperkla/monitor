#!/bin/bash
echo "[deploy] Starting deployment on $(hostname) at $(date)"
echo "[deploy] Working directory: ./expense-bot-frontend/"
if [ ! -d "./expense-bot-frontend/" ]; then echo "[deploy] ERROR: Directory './expense-bot-frontend/' does not exist"; exit 1; fi
cd "./expense-bot-frontend/" || { echo "[deploy] ERROR: Cannot cd to ./expense-bot-frontend/"; exit 1; }
echo "[deploy] Now in: $(pwd)"
set -e
set -o pipefail
if git remote get-url origin >/dev/null 2>&1; then
  CURRENT_URL=$(git remote get-url origin)
  if [[ "$CURRENT_URL" =~ ^https?://[^/]*@ ]]; then
    CLEAN_URL=""
    if [[ "$CURRENT_URL" == *github.com* ]]; then
      CLEAN_URL="https://github.com/$(echo "$CURRENT_URL" | sed -E 's|.*github\.com/||')"
    elif [[ "$CURRENT_URL" == *bitbucket.org* ]]; then
      CLEAN_URL="https://bitbucket.org/$(echo "$CURRENT_URL" | sed -E 's|.*bitbucket\.org/||')"
    fi
    if [ -n "$CLEAN_URL" ]; then
      echo "[deploy] Cleaned stale credentials from remote URL"
      git remote set-url origin "$CLEAN_URL"
    fi
  fi
fi
echo "[deploy] Configuring Bitbucket credentials..."
BB_URL=$(git remote get-url origin 2>/dev/null || echo "")
if [ -n "$BB_URL" ]; then
  BB_HOST=$(echo "$BB_URL" | sed -E 's|^[^:]+://||' | sed -E 's|/.*||')
  BB_PATH=$(echo "$BB_URL" | sed -E 's|^[^:]+://[^/]+||')
  git remote set-url origin "https://${encUser}:${encPass}@${BB_HOST}${BB_PATH}"
  echo "[deploy] Bitbucket auth configured"
else
  echo "[deploy] Warning: Could not get remote URL"
fi
git fetch origin
echo "[deploy] Checking out branch: main"
git checkout -B main origin/main
echo "[deploy] Running deploy command..."
npm run build
echo "[deploy] Deploy command finished successfully"
git remote get-url origin >/dev/null 2>&1 && git remote set-url origin "$(git remote get-url origin | sed -E 's|https://[^@]*@|https://|')" 2>/dev/null || true
