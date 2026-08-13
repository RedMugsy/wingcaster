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

// Check frontend HTML
try {
  const frontendRes = await fetch('http://localhost:7100/');
  console.log('\n=== FRONTEND HTML STATUS ===');
  console.log('Status:', frontendRes.status);
  const text = await frontendRes.text();
  console.log('Length:', text.length);
} catch (e) {
  console.log('\n=== FRONTEND HTML ERROR ===');
  console.log(e.message);
}

// Check main.tsx compilation
try {
  const mainRes = await fetch('http://localhost:7100/src/main.tsx');
  console.log('\n=== MAIN.TSX STATUS ===');
  console.log('Status:', mainRes.status);
  const text = await mainRes.text();
  if (text.includes('error') || text.includes('Error')) {
    console.log('Contains errors!');
    console.log(text.substring(0, 2000));
  } else {
    console.log('Length:', text.length);
    console.log('First 500 chars:', text.substring(0, 500));
  }
} catch (e) {
  console.log('\n=== MAIN.TSX ERROR ===');
  console.log(e.message);
}

// Check App.tsx compilation
try {
  const appRes = await fetch('http://localhost:7100/src/App.tsx');
  console.log('\n=== APP.TSX STATUS ===');
  console.log('Status:', appRes.status);
  const text = await appRes.text();
  if (text.includes('error') || text.includes('Error')) {
    console.log('Contains errors!');
    console.log(text.substring(0, 2000));
  } else {
    console.log('Length:', text.length);
  }
} catch (e) {
  console.log('\n=== APP.TSX ERROR ===');
  console.log(e.message);
}

// Check backend
try {
  const backendRes = await fetch('http://localhost:3001/api/agents');
  console.log('\n=== BACKEND STATUS ===');
  console.log('Status:', backendRes.status);
} catch (e) {
  console.log('\n=== BACKEND ERROR ===');
  console.log(e.message);
}

// Get PIDs
console.log('\n=== PROCESS INFO ===');
console.log('Vite server PID:', child.pid);

child.kill();
process.exit(0);
