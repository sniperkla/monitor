# Multi-Instance Isolation — Blueprint & Distro Test Matrix

Every AI agent (zeroclaw, nanobot, openclaw, hermes) supports **per-instance isolation**
so that spawned instances are fully self-contained and cannot interfere with each other
or with the default install.

---

## The Isolation Blueprint (4 layers)

### 1. Per-Instance Home & Config

Each instance gets its own directory with its own config, credentials, memories
and sessions:

```
~/.<agent>-<tag>/
├── config (config.toml / config.json / config.yaml / openclaw.json)
├── .env                    ← own credentials (bot token, API key)
├── logs/                   ← own gateway log
├── data/, workspace/       ← own memories & personality
└── (zeroclaw only) bin/zeroclaw   ← own binary copy
```

### 2. Per-Instance Ports

| Agent | Gateway/API port | WebSocket/WebUI port | How it's set |
|---|---|---|---|
| zeroclaw | `instancePort('zeroclaw', tag)` | same as gateway | `config set gateway.port` (per-instance config.toml) |
| nanobot | `--port <GW_PORT>` | `GW_PORT + 1` | injected into `config.json` `channels.websocket.port` |
| openclaw | `--port <GW_PORT>` | derived | CLI flag |
| hermes | unix socket (no TCP) | — | `HERMES_HOME` env only |

This prevents two instances from ever binding the same port.

### 3. Per-Instance Binary (zeroclaw)

zeroclaw instances get a **copy of the binary** at `~/.zeroclaw-<tag>/bin/zeroclaw`.
This means uninstalling the **default** (which may remove the shared
`~/.cargo/bin/zeroclaw`) does **not** break running/restartable instances.

Other agents share their runtime (hermes venv, nanobot venv, openclaw npm module).
For these, the **`instancesRemain` guard** prevents default-uninstall from
removing the shared runtime while any sibling instance exists.

### 4. Selective Process Kill

Default stop/uninstall must never kill instance daemons. All agents now use
**selective kill** logic:

- zeroclaw: `--config-dir` check via `/proc/<pid>/cmdline`
- nanobot: `--config ~/.nanobot-<tag>` check via `/proc/<pid>/cmdline`
- hermes: `HERMES_HOME=...\.hermes-<tag>` check via `/proc/<pid>/environ`
- openclaw: instance-scoped pidfile only

---

## Uninstall Semantics

| Action | Default | Instance |
|---|---|---|
| Uninstall instance | not applicable | stops daemon (pidfile) + `rm -rf ~/.<agent>-<tag>` (always, incl. own binary for zeroclaw) |
| Uninstall default (non-purge) | removes shared binary **only if zero instances remain**; removes `~/.<agent>/logs` | — |
| Uninstall default (purge) | removes shared binary **only if zero instances remain**; removes `~/.<agent>` entirely | — |

The `instancesRemain` guard (present in all 4 agents) means uninstalling the
default never breaks a running instance.

---

## Spawn (New Instance) Flow

1. Create isolated home `~/.<agent>-<tag>/` with skeleton (no credential seeding)
2. zeroclaw: copy shared binary → `~/.zeroclaw-<tag>/bin/zeroclaw`
3. nanobot: inject per-instance websocket port (`GW_PORT + 1`)
4. Auto-open setup wizard (Save & Start — not Reconfigure/Reinstall)
5. User fills **OWN** API key / bot token → written to the instance only
6. Gateway starts on its own port

---

## Distro Test Matrix (verified live)

Test host: 43.210.221.54 (multi-distro container fleet, one distro per SSH port)

| Distro | Port | zeroclaw | nanobot | openclaw | hermes |
|---|---|---|---|---|---|
| **Fedora 40** | 2232 | ✅ spawn+isolation | ✅ | ✅ | ✅ |
| **Ubuntu 24.04** | 2235 | ✅ spawn+isolation | ✅ spawn+guard | ✅ guard | ✅ guard |
| **Debian 12** | 2236 | ✅ spawn+isolation | ✅ spawn (independent, health OK) | ✅ homes | ✅ homes |
| **CentOS Stream 9** | 2230 | ✅ spawn+isolation | ✅ | ✅ | ✅ |
| **Rocky Linux 9** | 2223 | ✅ spawn+isolation | ✅ spawn (health OK) | ✅ default running | ✅ default running |
| **openSUSE Leap 15.6** | 2233 | ✅ spawn+isolation | — | — | — |
| **Arch Linux** | 2234 | ✅ spawn+isolation | — | — | — |

All tests verified:
- spawned instance runs its own binary (zeroclaw) / own gateway (nanobot/openclaw/hermes)
- default uninstall keeps shared runtime when instances remain (`instancesRemain`)
- selective kill spares instance daemons
- per-instance ports prevent conflicts
- no credential/token seeding from default

### Known distro-specific notes

| Distro | Note |
|---|---|
| CentOS Stream 9 / Rocky 9 | official installer skips the zeroclaw daemon binary (lean preset); extract from release tarball manually or build `--preset full` |
| Alpine (musl) | not on test host; install route auto-detects musl and installs the musl release tarball (deployed, untested live) |
| Debian 12 | SQLite 3.34 is old (hermes warns about WAL corruption); works, but upgrade recommended |

---

## Regression Tests

Unit tests: `tests/multi-instance.test.mjs` (63 pass)
- tag sanitization
- port collision avoidance (per-agent salt, 18780–18799 reserved)
- `instancesRemain` guard
- selective kill (`--config-dir` inspection)
- websocket port injection (nanobot)
- status detection (pidfile + process fallback)
- modal path display fix (uninstall shows instance home)

## Future Work

- [ ] Alpine (musl) live verification (needs a musl container on the test host)
- [ ] Per-instance binary copies for hermes/nanobot/openclaw (heavier — venv/npm based)
- [ ] RHEL/SLES/NixOS live verification (not on test host)
- [ ] Per-agent risk-profile level option in the UI (currently `config set`)
