# ssh-monitor-relay

Local relay agent for [SSH Monitor](https://monitor.eaqdragon.com). It runs on
**your** machine and connects outward to your monitor server, so SSH, SFTP,
database and agent-web-UI traffic reaches you without opening a single inbound
port or configuring a router.

```bash
npm install -g ssh-monitor-relay
local-relay --pair --server https://monitor.eaqdragon.com
```

That's it. Pairing prints an 8-character code; you approve it in
**Settings → Local Relay** while signed in. No token is ever pasted into a
terminal.

---

## Why this is published on npm instead of `curl … | node`

The old installer asked you to download a script and immediately execute it.
That pattern is uncomfortable for good reasons — you cannot easily tell what
you ran, you cannot verify it later, and you cannot cleanly remove it.

Publishing as a package fixes the parts that can actually be fixed:

| | `curl … \| node` | `npm install -g` |
|---|---|---|
| Verify before running | manual `shasum -c` you have to trust | registry integrity hash checked automatically |
| Pinned version | "whatever is on the server today" | semver, `npm outdated`, reproducible |
| Inspect before running | download it, know where it went | `npm pack ssh-monitor-relay`, or `npm view ssh-monitor-relay` |
| Dependency audit | an unattended `npm install` at install time | `npm audit`, resolved at install |
| Removal | hunt down files by hand | `npm uninstall -g ssh-monitor-relay` |

**The most important property: this package ships no install lifecycle scripts.**
No `preinstall`, no `install`, no `postinstall`. An npm package with no
lifecycle scripts **cannot execute anything at install time** — installing it is
a pure file copy. Nothing runs until you type `local-relay` yourself.

You can confirm that in one command after installing:

```bash
cat "$(npm root -g)/ssh-monitor-relay/package.json" | grep -A6 '"scripts"'
# only "prepack" — and prepack runs on the publisher's machine, never yours
```

### What you will see after `npm install`

The package is copied to npm's global package directory. You can inspect it
before starting the relay:

```bash
npm root -g
ls "$(npm root -g)/ssh-monitor-relay"
ls "$(npm root -g)/ssh-monitor-relay/dist"
```

The runnable file is `dist/local-relay.js`. It is a bundled, obfuscated build —
**not the readable source code**. You can still inspect it, run your own hash,
and compare the published package before executing `local-relay`:

```bash
sha256sum "$(npm root -g)/ssh-monitor-relay/dist/local-relay.js"  # Linux
shasum -a 256 "$(npm root -g)/ssh-monitor-relay/dist/local-relay.js" # macOS
```

`npm install` only copies the package here. This package has no `preinstall`,
`install`, or `postinstall` hook; the relay does not start until you explicitly
run `local-relay --pair`.

### What npm does *not* buy you

Be clear-eyed about this: `npm install` is not a safety guarantee. A package
**can** run arbitrary code at install time via lifecycle scripts, so
`npm install somepackage` is not inherently safer than piping a URL into a
shell — it is safer here *because this package has no lifecycle scripts*, so
installing it is a pure file copy. Publishing on npm is a distribution and
integrity improvement, not a substitute for judging what you run.

### The shipped file is a build

`dist/local-relay.js` is a compressed build, not readable source. That is
deliberate: this is private, non-public software, and the licence — not the
file format — is what stops reuse. Be clear about what that does and does not
mean:

- It is **deterrence, not secrecy**. Anyone sufficiently motivated can
  deobfuscate it. It raises the cost of copying the implementation from "open
  the file" to "run a deobfuscator".
- **You are still allowed to inspect it.** The licence explicitly permits
  decompiling to satisfy yourself about what runs on your machine; it forbids
  reusing what you find.
- It is **deterministic**. The same source always produces the same bytes, so
  the file carries a `source-sha256` header and the published digest is stable
  and checkable rather than moving on every build.
- It therefore **cannot hide anything from you in a way you could not detect**:
  the bytes are checksummed, reproducible, and identical to what the server
  serves.

If you want the behaviour described rather than the code, the pre-flight
report generated from the source lists every filesystem write, network call and
service change.

---

## What exactly does this do to my machine?

Read this before installing. Nothing here is hidden, and all of it is undoable.

### Files written

| Path | Mode | Why |
|---|---|---|
| `~/.ssh-monitor-relay.json` | `0600` | your relay token and server URL — the only secret, and it is owner-only |
| `~/.ssh-monitor-relay/` | — | the copy the background service runs from |
| `~/.ssh-monitor-relay/local-relay.js` | `0755` | copy of this program |
| `~/Library/LaunchAgents/com.ssh-monitor.relay.plist` | — | macOS: launch-at-login service |
| `~/Library/Logs/ssh-monitor-relay.log` | — | macOS: stdout + stderr |
| `~/.config/systemd/user/com.ssh-monitor.relay.service` | — | Linux: systemd user unit |
| `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ssh-monitor-relay.vbs` | — | Windows: startup launcher |

### Network calls

- `POST {server}/api/relay/device/code` — request a pairing code. Sends no secret.
- `POST {server}/api/relay/device/token` — poll until you approve; receives the token.
- `WSS {server}/relay-ws?token=…` — the persistent control channel.

Plus the traffic you actually asked to relay, which flows only after you approve
a device. Nothing calls home to any third party.

### Privileges

None. It installs into your home directory and runs as you — no `sudo`, no
system-wide service, no firewall changes.

---

## Usage

```
local-relay --pair    --server <URL>     # recommended: approve a code in the browser
local-relay --install --server <URL> --token <TOKEN>
local-relay --uninstall
local-relay                              # run in the foreground (no install)
```

Options: `--server <URL>`, `--token <TOKEN>`, `--name <NAME>`, `--label <LABEL>`,
`--scope <relay|agent>`.

Logs: `tail -f ~/Library/Logs/ssh-monitor-relay.log` (macOS) or
`journalctl --user -u com.ssh-monitor.relay -f` (Linux).

---

## Uninstall

```bash
local-relay --uninstall
npm uninstall -g ssh-monitor-relay
```

The first removes the background service and the token file; the second removes
the program. Revoke server-side access any time from
**Settings → Local Relay → Revoke**.

---

## Verifying integrity yourself

```bash
npm view ssh-monitor-relay dist.integrity   # registry's hash of the tarball
npm pack ssh-monitor-relay                  # download without installing
tar -xzf ssh-monitor-relay-*.tgz            # read it at your leisure
```

The relay inside is byte-identical to the artifact the server serves at
`GET /local-relay.js`, and both carry the same `source-sha256` header. If those
two ever differ, that is a bug — report it.

---

## Requirements

Node.js 18 or newer. `ws` is required; `ssh2` (SSH/SFTP) and `node-datachannel`
(WebRTC) are optional and the relay degrades gracefully without them.

---

## License

Private, non-public source. See [LICENSE](./LICENSE).

Copyright (c) 2026. All rights reserved.

Permission is granted to install and run this package to use SSH Monitor.
Redistribution, sublicensing, and incorporation into any other product or
service are not granted. No warranty of any kind.

## Version note

- **1.0.8** — Web UI fix (same bytes as 1.0.7 with a bumped version stamp):
  the gateway now answers Chrome's Private Network Access preflight
  (`Access-Control-Allow-Private-Network: true`). Without it, any Web UI tab
  opened from the production monitor (a public https site) was silently
  blocked by Chrome and hung on "Opening Web UI…", while pasting
  `http://127.0.0.1:<port>` into the address bar worked. Existing relays must
  update to open Web UI tabs normally again.
- **1.0.7** — the same Web UI fix. Publishing was rocky: `npm publish` exited
  0 but the version took several minutes to appear on the registry, and the
  `latest` dist-tag did not move from 1.0.4 — it had to be set by hand with
  `npm dist-tag add ssh-monitor-relay@1.0.8 latest`. (Not the same failure as
  1.0.2: the version did eventually land, so no number was wasted.)
- **1.0.4** — `local-relay --pair` now always shows a pairing code. Previously
  it was skipped whenever a token was already saved, so re-pairing (after a
  revoke, after moving to another server, or after the approval window
  expired) printed no code and only the "installed as service" line. See the
  [F8 write-up](../../docs/RELAY_PAIRING_AUDIT_2026-09-06.md).
- **1.0.3** — first release shipping the built artifact described in
  [The shipped file is a build](#the-shipped-file-is-a-build). The bytes are
  identical to what the server serves at `GET /local-relay.js`
  (`ae6c768f…4fd6`, 196,100 bytes, built from source `8db23741…d26b`).
  1.0.0 and 1.0.1 shipped readable source.
- **1.0.2** — **skipped, does not exist.** It was published successfully
  (`+ ssh-monitor-relay@1.0.2`, exit 0) and then never appeared on the
  registry. Retrying fails with `E409 Cannot publish over previously staged
  version`, while `npm stage list` shows nothing to clear. Known npm bug
  ([npm/cli#9889](https://github.com/npm/cli/issues/9889)). The number is
  permanently unusable; 1.0.3 carries identical bytes.
- **1.0.1** — `local-relay --help` was not handled in 1.0.0 and would start the
  relay instead of printing usage. Fixed: `--help` exits 0, an unknown flag
  exits 1 and names the bad flag.
