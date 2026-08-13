const fs = require('fs');
const s = fs.readFileSync('backend/src/server.js', 'utf8');
let open = 0, close = 0;
for (const c of s) {
  if (c === '{') open++;
  if (c === '}') close++;
}
console.log('open:', open, 'close:', close, 'diff:', open - close);
