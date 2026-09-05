/**
 * Helper to fetch latest upstream release versions for supported AI agents
 * (Hermes, Nanobot, OpenClaw, ZeroClaw) and compare them with installed versions.
 */

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes in-memory cache
const versionCache = new Map();

/**
 * Clean version string into [major, minor, patch] or null
 */
export function parseSemver(verStr) {
  if (!verStr || typeof verStr !== 'string') return null;
  const m = verStr.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), m[3] ? parseInt(m[3], 10) : 0];
}

/**
 * Returns true if latest > current
 */
export function isNewerVersion(currentVer, latestVer) {
  const cur = parseSemver(currentVer);
  const lat = parseSemver(latestVer);
  if (!cur || !lat) return false;
  for (let i = 0; i < 3; i++) {
    if (lat[i] > cur[i]) return true;
    if (lat[i] < cur[i]) return false;
  }
  return false;
}

/**
 * Fetch latest upstream version for a given agent
 * @param {'hermes'|'nanobot'|'openclaw'|'zeroclaw'} agentId
 * @returns {Promise<string|null>}
 */
export async function getLatestAgentVersion(agentId) {
  const cached = versionCache.get(agentId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.version;
  }

  let latest = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);

  try {
    if (agentId === 'hermes') {
      // Nous Research Hermes Agent (PyPI or GitHub)
      try {
        const res = await fetch('https://pypi.org/pypi/hermes-agent/json', {
          signal: controller.signal,
          headers: { 'User-Agent': 'Monitor-Dashboard' }
        });
        if (res.ok) {
          const data = await res.json();
          latest = data?.info?.version || null;
        }
      } catch (_) {}
      if (!latest) {
        const ghRes = await fetch('https://api.github.com/repos/NousResearch/hermes-agent/releases/latest', {
          headers: { 'User-Agent': 'Monitor-Dashboard' },
          signal: controller.signal,
        });
        if (ghRes.ok) {
          const ghData = await ghRes.json();
          latest = (ghData?.tag_name || ghData?.name || '').replace(/^v/i, '');
        }
      }
    } else if (agentId === 'nanobot') {
      // HKUDS Nanobot — published on PyPI as `nanobot-ai` (NOT `nanobot`)
      try {
        const res = await fetch('https://pypi.org/pypi/nanobot-ai/json', {
          signal: controller.signal,
          headers: { 'User-Agent': 'Monitor-Dashboard' }
        });
        if (res.ok) {
          const data = await res.json();
          latest = data?.info?.version || null;
        }
      } catch (_) {}
      if (!latest) {
        const ghRes = await fetch('https://api.github.com/repos/HKUDS/nanobot/releases/latest', {
          headers: { 'User-Agent': 'Monitor-Dashboard' },
          signal: controller.signal,
        });
        if (ghRes.ok) {
          const ghData = await ghRes.json();
          latest = (ghData?.tag_name || ghData?.name || '').replace(/^v/i, '');
        }
      }
    } else if (agentId === 'openclaw') {
      // OpenClaw (NPM or GitHub)
      try {
        const res = await fetch('https://registry.npmjs.org/openclaw/latest', {
          signal: controller.signal,
          headers: { 'User-Agent': 'Monitor-Dashboard' }
        });
        if (res.ok) {
          const data = await res.json();
          latest = data?.version || null;
        }
      } catch (_) {}
    } else if (agentId === 'zeroclaw') {
      // ZeroClaw (GitHub releases)
      try {
        const ghRes = await fetch('https://api.github.com/repos/zeroclaw-labs/zeroclaw/releases/latest', {
          headers: { 'User-Agent': 'Monitor-Dashboard' },
          signal: controller.signal,
        });
        if (ghRes.ok) {
          const ghData = await ghRes.json();
          latest = (ghData?.tag_name || ghData?.name || '').replace(/^v/i, '');
        }
      } catch (_) {}
    }
  } catch (_) {
    // Network / abort error
  } finally {
    clearTimeout(timer);
  }

  if (latest) {
    versionCache.set(agentId, { version: latest, ts: Date.now() });
  }
  return latest || cached?.version || null;
}
