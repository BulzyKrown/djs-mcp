#!/usr/bin/env node
const { spawn } = require('child_process');
const readline = require('readline');

const server = spawn('node', ['build/index.js'], {
  cwd: __dirname,
  stdio: ['pipe', 'pipe', 'pipe']
});

let requestId = 0;
const pendingRequests = new Map();

const rl = readline.createInterface({ input: server.stdout });

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const response = JSON.parse(line);
    console.log('\n← RESPONSE:', JSON.stringify(response, null, 2));

    if (response.id && pendingRequests.has(response.id)) {
      const { resolve, reject, timeout } = pendingRequests.get(response.id);
      clearTimeout(timeout);
      pendingRequests.delete(response.id);

      if (response.error) {
        reject(new Error(response.error.message));
      } else {
        resolve(response.result);
      }
    }
  } catch (e) {
    console.log('\n← RAW:', line);
  }
});

server.stderr.on('data', (data) => {
  console.error('STDERR:', data.toString().trim());
});

function sendRequest(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Request ${method} timed out`));
    }, 15000);

    pendingRequests.set(id, { resolve, reject, timeout });

    const request = { jsonrpc: '2.0', id, method, params };
    console.log(`\n→ ${method}:`, JSON.stringify(params));
    server.stdin.write(JSON.stringify(request) + '\n');
  });
}

async function main() {
  console.log('=== MCP DiscordJS Test ===\n');

  try {
    // Initialize
    console.log('\n--- Initialize ---');
    await sendRequest('initialize', {
      protocolVersion: '2025-12-11',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    });
    await new Promise(r => setTimeout(r, 300));

    // List tools
    console.log('\n--- List Tools ---');
    await sendRequest('tools/list');
    await new Promise(r => setTimeout(r, 300));

    // Test get_mcp_version
    console.log('\n--- get_mcp_version ---');
    const version = await sendRequest('tools/call', {
      name: 'get_mcp_version',
      arguments: {}
    });
    console.log('\nVERSION RESULT:', version);

    await new Promise(r => setTimeout(r, 300));

    // Test get_enum for GatewayIntentBits
    console.log('\n--- get_enum GatewayIntentBits ---');
    const enumResult = await sendRequest('tools/call', {
      name: 'get_enum',
      arguments: { enumName: 'GatewayIntentBits' }
    });
    console.log('\nENUM RESULT:', enumResult);

    await new Promise(r => setTimeout(r, 300));

    // Test search with core package
    console.log('\n--- search_docs Client core ---');
    const searchResult = await sendRequest('tools/call', {
      name: 'search_docs',
      arguments: { query: 'Client', package: 'core' }
    });
    console.log('\nSEARCH RESULT:', searchResult);

    await new Promise(r => setTimeout(r, 300));

    // Test get_class for Client
    console.log('\n--- get_class Client ---');
    const classResult = await sendRequest('tools/call', {
      name: 'get_class',
      arguments: { className: 'Client' }
    });
    console.log('\nCLASS RESULT:', classResult);

    console.log('\n\n=== ALL TESTS COMPLETE ===');
    process.exit(0);

  } catch (error) {
    console.error('\nERROR:', error.message);
    process.exit(1);
  }
}

main();