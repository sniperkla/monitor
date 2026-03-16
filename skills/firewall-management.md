---
name: firewall-management
keywords: [firewall, port, ufw, firewalld, iptables, nftables, block, allow, deny]
---

# Firewall Management Skill

## Description
Expert at detecting and managing various Linux firewall systems dynamically.

## Detection Pattern
Always detect the firewall system first before running commands:
```bash
command -v firewall-cmd && echo "firewalld" || \
command -v ufw && echo "ufw" || \
command -v iptables && echo "iptables" || \
command -v nft && echo "nftables" || \
echo "none"
```

## Firewalld Commands (RHEL/CentOS/Fedora)
- Check status: `firewall-cmd --state`
- List rules: `firewall-cmd --list-all`
- Open port: `firewall-cmd --add-port=PORT/tcp --permanent && firewall-cmd --reload`
- Close port: `firewall-cmd --remove-port=PORT/tcp --permanent && firewall-cmd --reload`
- Allow service: `firewall-cmd --add-service=http --permanent && firewall-cmd --reload`
- List zones: `firewall-cmd --get-zones`
- Default zone: `firewall-cmd --get-default-zone`

## UFW Commands (Ubuntu/Debian)
- Check status: `ufw status verbose`
- Enable: `ufw enable`
- Disable: `ufw disable`
- Allow port: `ufw allow PORT/tcp`
- Deny port: `ufw deny PORT/tcp`
- Delete rule: `ufw delete allow PORT/tcp`
- Reset: `ufw reset`

## iptables Commands (Legacy)
- List rules: `iptables -L -n -v`
- Allow port: `iptables -A INPUT -p tcp --dport PORT -j ACCEPT`
- Deny port: `iptables -A INPUT -p tcp --dport PORT -j DROP`
- Save rules: `iptables-save > /etc/iptables/rules.v4`
- Restore: `iptables-restore < /etc/iptables/rules.v4`

## nftables Commands (Modern)
- List rules: `nft list ruleset`
- Add rule: `nft add rule inet filter input tcp dport PORT accept`
- Delete rule: `nft delete rule inet filter input handle HANDLE`

## Best Practices
1. Always check current rules before making changes
2. Use --permanent or save rules to persist across reboots
3. Test connectivity after changes
4. Have a rollback plan before modifying firewall rules
