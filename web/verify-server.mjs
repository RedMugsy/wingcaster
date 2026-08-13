import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

// Start the Vite dev server
const child = spawn(
  'C:/Users/AliAchkar/AppData/Local/Programs/kimi-desktop/resources/resources/runtime/npm.cmd',
  ['run', 'dev', '--', '--host'],
  {
    cwd: 'C:/Users/AliAchkar/Documents/kimi/workspace/souq-ajjar-realestate',
    shell: true,
    stdio: 'pipe'
  }
);

let output = '';
child.stdout.on('data', (data) => {
  output += data.toString();
  console.log(data.toString());
});

child.stderr.on('data', (data) => {
  output += data.toString();
  console.error(data.toString());
});

// Wait for server to start
await setTimeout(8000);

// Check frontend
try {
  const frontendRes = await fetch('http://localhost:7100/');
  console.log('\n=== FRONTEND STATUS ===');
  console.log('Status:', frontendRes.status);
  const text = await frontendRes.text();
  console.log('Length:', text.length);
  console.log('Preview:', text.substring(0, 500));
} catch (e) {
  console.log('\n=== FRONTEND ERROR ===');
  console.log(e.message);
}

// Check backend
try {
  const backendRes = await fetch('http://localhost:3001/api/agents');
  console.log('\n=== BACKEND STATUS ===');
  console.log('Status:', backendRes.status);
  const text = await backendRes.text();
  console.log('Response:', text.substring(0, 500));
} catch (e) {
  console.log('\n=== BACKEND ERROR ===');
  console.log(e.message);
}

// Get PIDs
console.log('\n=== PROCESS INFO ===');
console.log('Vite server PID:', child.pid);

child.kill();
process.exit(0);
