// Test that the mongosh eval line generates with correct quote escaping
const V = (name) => '$' + name;

const line = '    _MONGOSH_OUT=$("' + V('SHELL_BIN') + '" "' + V('MONGO_URI') + '" --eval "db.getSiblingDB(\\"' + V('DB_NAME') + '\\").getCollectionNames().forEach(function(n){print(n)})" --quiet --norc 2>&1 || true)';

console.log('Generated bash line:');
console.log(line);
console.log('');

// Simulate with real values
const DB_NAME = 'jeawweaw';
const SHELL_BIN = '/usr/bin/mongosh';
const MONGO_URI = 'mongodb://localhost:27017/jeawweaw';

const testLine = line.replace(/\$SHELL_BIN/g, SHELL_BIN)
  .replace(/\$MONGO_URI/g, MONGO_URI)
  .replace(/\$DB_NAME/g, DB_NAME);

console.log('With example values:');
console.log(testLine);
console.log('');

// Extract just the eval argument
const evalMatch = testLine.match(/--eval "(.*?)"/);
if (evalMatch) {
  console.log('Eval argument that mongosh will see:');
  console.log(evalMatch[1]);
  console.log('');
  console.log('Expected: db.getSiblingDB("jeawweaw").getCollectionNames().forEach(function(n){print(n)})');
}
