#!/usr/bin/env node

/**
 * Test GitHub Deploy Function
 * Usage: node test-deploy.js [command] [options]
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3030';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'test-secret';

// Parse command
const [, , command = 'help', ...args] = process.argv;

// Helper to make HTTP requests
function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const client = url.protocol === 'https:' ? https : http;
    
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = client.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null,
            text: data,
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: data,
          });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Commands
const commands = {
  async setup() {
    console.log('🔧 Setting up test deployment config...\n');
    
    const config = {
      projectId: 'default',
      name: 'Test Deploy Project',
      enabled: true,
      branch: 'main',
      secret: WEBHOOK_SECRET,
      targetType: 'local',
      deployCommand: 'echo "✅ Deployment started" && sleep 1 && echo "✅ Deployment completed successfully"',
      projectPath: '.',
    };

    try {
      const res = await request('POST', '/api/deploy/config', config);
      if (res.status === 200 || res.status === 201) {
        console.log('✅ Config saved successfully!');
        console.log(JSON.stringify(res.body, null, 2));
      } else {
        console.log(`❌ Failed (${res.status}):`, res.text);
      }
    } catch (err) {
      console.error('❌ Error:', err.message);
    }
  },

  async webhook() {
    console.log('🚀 Simulating GitHub webhook...\n');
    
    // Simulate GitHub push payload
    const payload = {
      ref: 'refs/heads/main',
      repository: {
        full_name: 'user/repo',
        name: 'repo',
      },
      pusher: {
        name: 'testuser',
        email: 'test@example.com',
      },
      commits: [
        {
          id: 'abc123',
          message: 'Test commit for deployment',
          author: {
            name: 'Test User',
            email: 'test@example.com',
          },
        },
      ],
    };

    const bodyText = JSON.stringify(payload);
    
    // Sign the payload like GitHub does
    const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
    const signature = 'sha256=' + hmac.update(bodyText).digest('hex');

    console.log(`📨 Sending webhook to /api/deploy/webhook?project=default`);
    console.log(`📌 Signature: ${signature}\n`);

    try {
      const res = await request('POST', '/api/deploy/webhook?project=default', payload, {
        'x-hub-signature-256': signature,
        'x-github-event': 'push',
      });

      console.log(`Response (${res.status}):`);
      console.log(JSON.stringify(res.body || res.text, null, 2));
    } catch (err) {
      console.error('❌ Error:', err.message);
    }
  },

  async status() {
    console.log('📊 Checking deployment status...\n');
    
    try {
      const res = await request('GET', '/api/deploy/config?project=default');
      
      if (res.status === 200) {
        const config = res.body?.config;
        if (config) {
          console.log(`📋 Project: ${config.name || 'N/A'}`);
          console.log(`🔄 Status: ${config.status || 'idle'}`);
          console.log(`⏰ Last Deploy: ${config.lastDeployAt || 'Never'}`);
          console.log(`🎯 Branch: ${config.branch}`);
          console.log(`📍 Target: ${config.targetType}`);
          console.log(`\n📝 Last Deploy Log:`);
          console.log('---');
          console.log(config.lastDeployLog || '(No logs yet)');
          console.log('---');
        }
      } else if (res.status === 401) {
        console.log('⚠️  Requires authentication. This endpoint needs a session cookie.');
        console.log('\nTo get your session cookie:');
        console.log('1. Visit: http://localhost:3030');
        console.log('2. Open DevTools (F12) → Application → Cookies');
        console.log('3. Copy "next-auth.session-token"');
        console.log('4. Run: curl http://localhost:3030/api/deploy/config?project=default -H "Cookie: next-auth.session-token=YOUR_TOKEN"');
      } else {
        console.log(`Error (${res.status}):`, res.text);
      }
    } catch (err) {
      console.error('❌ Error:', err.message);
    }
  },

  help() {
    console.log(`
📚 GitHub Deploy Test Helper

Commands:
  setup      - Save test deployment config
  webhook    - Send simulated GitHub webhook
  status     - Check deployment status (requires auth)
  help       - Show this help

Environment Variables:
  BASE_URL         - App URL (default: http://localhost:3030)
  WEBHOOK_SECRET   - GitHub webhook secret (default: test-secret)

Examples:
  node test-deploy.js setup
  node test-deploy.js webhook
  node test-deploy.js status
  
  # With custom settings:
  BASE_URL=http://myapp.com node test-deploy.js webhook
    `);
  },
};

// Run command
const cmd = commands[command];
if (cmd) {
  cmd().catch(err => {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
  });
} else {
  console.error(`❌ Unknown command: ${command}\n`);
  commands.help();
  process.exit(1);
}
