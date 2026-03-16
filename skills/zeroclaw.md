---
name: zeroclaw
description: Fixes GLIBC mismatch errors by building the application from source. Required when pre-built binaries fail on Amazon Linux.
keywords: [zeroclaw, glibc, libc.so, glibc_2, bootstrap.sh, cargo build, rustup, rust runtime, zero claw, gateway]
---
# Zeroclaw / Rust App Build from Source

## Problem Detection
When attempting to run an application like `zeroclaw` and encountering the following error:
```
zeroclaw: /lib64/libc.so.6: version `GLIBC_2.39' not found (required by zeroclaw)
```
This means the binary was compiled against a newer version of the GNU C Library (GLIBC) than is available on the current OS (e.g., Amazon Linux 2023).

**🚨 CRITICAL WARNING TO AI AGENT:**
- **NEVER** attempt to upgrade GLIBC on the system via package managers (like `dnf update glibc` or compiling GLIBC). Doing so will likely BRICK the operating system permanently and cause the system to fail to boot.
- The ONLY correct solution is to build the application from source code on the target machine.
- If configuring Zeroclaw, **NEVER** use the `--prefer-prebuilt` flag if it is failing with a GLIBC error.

## Resolution Workflow

### 1. Verify Memory and Enable Swap
Building Rust applications consumes significant memory, which will cause OOM (Out of Memory) kills on small instances (like t2.micro or instances with <2GB RAM). You MUST use the `MEMORY SAFEGUARD` command provided in your system prompt before running `cargo build --release`. 

### 2. Install Build Dependencies
If `cargo` or `rustc` is not installed, install it:
```bash
sudo dnf install -y gcc gcc-c++ make openssl-devel
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

### 3. Build from Source
Navigate to the application source directory and build it for release:
```bash
cargo build --release
```

### 4. Deploy the Binary
After a successful build, copy the binary to `/usr/local/bin/` so it is in the system PATH:
```bash
sudo cp target/release/zeroclaw /usr/local/bin/
sudo chmod +x /usr/local/bin/zeroclaw
```

### 5. Verify the Fix
Run the binary to ensure it executes without the GLIBC error:
```bash
zeroclaw --version
```
If it prints the version or help text without GLIBC errors, the problem is permanently resolved.

**⚠️ IMPORTANT**: If zeroclaw produces a GLIBC error when run, do NOT copy-paste the error output as a command. It will break the terminal.

## Docker Deployment
If the goal mentions "Docker" (e.g. "install zeroclaw on Docker"):
1. Do NOT build or verify zeroclaw on the HOST if it has GLIBC issues
2. Instead, use a Docker image with a compatible GLIBC version (e.g. ubuntu:24.04)
3. Copy the pre-built binary INTO the Docker container, or build from source INSIDE the container

### Option A: Copy existing binary into Docker
```bash
# Create a Dockerfile or run directly:
docker run -d --name zeroclaw-app -v /home/ec2-user/zeroclaw/target/release/zeroclaw:/usr/local/bin/zeroclaw ubuntu:24.04 /usr/local/bin/zeroclaw
```

### Option B: Build from source inside Docker
```bash
docker run -it --name zeroclaw-build ubuntu:24.04 bash
# Inside the container:
apt update && apt install -y curl gcc make pkg-config libssl-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
cd /opt && git clone <repo-url> zeroclaw && cd zeroclaw
cargo build --release
cp target/release/zeroclaw /usr/local/bin/
zeroclaw --version
```

### Verification (Docker)
Verify INSIDE the Docker container, not on the host:
```bash
docker exec zeroclaw-app zeroclaw --version
```
