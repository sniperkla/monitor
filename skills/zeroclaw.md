---
name: zeroclaw-deployment
description: Install and run ZeroClaw AI runtime on Linux (CentOS/Ubuntu/Debian)
---

# ZeroClaw Installation & Setup (Linux)

This skill covers installing the ZeroClaw Rust-based AI runtime on Linux systems (CentOS, RHEL, Ubuntu, Debian).

## Prerequisites
- `git`
- `curl`
- `build-essential` or `gcc` (for building from source if needed)
- `rust`/`cargo` (optional, but recommended for source builds)

## Installation Methods

### Option 1: Git Clone & Bootstrap (Recommended for Linux)
This is the most reliable method for CentOS/RHEL where `brew` might missing.
```bash
# 1. Clone the repository
git clone https://github.com/zeroclaw-labs/zeroclaw.git
cd zeroclaw

# 2. Run the bootstrap installer
# This script detects your OS and installs necessary dependencies/binaries
./bootstrap.sh

# If you have limited resources (low RAM), use prebuilt binary:
# ./bootstrap.sh --prefer-prebuilt
```

## ⚠️ GLIBC Mismatch Error (Pre-built Binary Incompatible)

**Symptom:** After running `./bootstrap.sh`, you see:
```
/usr/local/bin/zeroclaw: /lib64/libc.so.6: version `GLIBC_2.39' not found
```

**Root cause:** The pre-built binary in the release was compiled on a newer Linux distro (e.g., Ubuntu 24.04 with GLIBC 2.39), but your system (e.g., Amazon Linux 2023, CentOS Stream 9) has an older GLIBC (2.34–2.36). Pre-built binaries are **not portable** across GLIBC versions.

**Fix: Build from source**

Step 1 — Install Rust/Cargo if not present:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source $HOME/.cargo/env
```

Step 2 — Build the binary on your system:
```bash
cd zeroclaw          # or wherever you cloned the repo
cargo build --release
```
*(This compiles against YOUR system's GLIBC and produces a compatible binary.)*

Step 3 — Install the compiled binary:
```bash
sudo cp target/release/zeroclaw /usr/local/bin/
sudo chmod +x /usr/local/bin/zeroclaw
```

Step 4 — Verify:
```bash
zeroclaw --version
```

> **Note:** `--prefer-prebuilt` will reproduce the GLIBC error. Never use it on older GLIBC systems (< 2.38). Always build from source on Amazon Linux 2023, CentOS 9 Stream, RHEL 9, or any system with GLIBC < 2.38.

### Option 2: Cargo (If Rust is installed)
```bash
cargo install zeroclaw
```

### Option 3: Homebrew (Linuxbrew)
Only use this if you have Linuxbrew installed on your CentOS machine.
```bash
brew install zeroclaw
```

## Running ZeroClaw

### 1. Start the Gateway
The gateway serves the Web Dashboard and API (default port 1819).
```bash
# Start the daemon/gateway
zeroclaw gateway
```
*Note: The dashboard should be accessible at http://127.0.0.1:1819/ (or your server IP).*

### 2. Verify Installation
Test the CLI to ensure the runtime is active.
```bash
zeroclaw chat "Hello, are you running?"
```

## "Channel Start" & Configuration
If you need to configure specific channels (interfaces):
1. Check `config.toml` or `zeroclaw.toml` generated after first run.
2. Ensure you have the necessary providers configured (OpenAI, Anthropic, or Local).
