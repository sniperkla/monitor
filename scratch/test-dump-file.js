// Test DUMP_FILE generation
const V = (name) => '$' + name;

const before = 'DUMP_FILE="' + V('TMP_DIR') + '/' + V('COLL') + '_' + V('TIMESTAMP') + '.json"';
const after = 'DUMP_FILE="' + V('TMP_DIR') + '/${COLL}_' + V('TIMESTAMP') + '.json"';

console.log('BEFORE (buggy):');
console.log(before);
console.log('\nAFTER (fixed):');
console.log(after);
console.log('\nExpected result with COLL=sessions, TIMESTAMP=20260806:');
console.log('DUMP_FILE="/tmp/sessions_20260806.json"');
