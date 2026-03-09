# Inject a debug log exactly before sshClient.connect
sed -i '' 's/sshClient.connect(sshConfig);/console.log("[SSH DEBUG] Attempting to connect to:", sshConfig.host, "with user:", sshConfig.username, "pass length:", sshConfig.password ? sshConfig.password.length : "null"); sshClient.connect(sshConfig);/g' server.js
