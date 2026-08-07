// Test the for loop generation
const V = (name) => '$' + name;

const lines = [
  '  echo "$(date): Collections found: $(echo "' + V('COLLS') + '" | tr \'\\n\' \' \')" >> "' + V('LOG') + '"',
  '  for COLL in ' + V('COLLS') + '; do',
  '    DUMP_FILE="' + V('TMP_DIR') + '/' + V('COLL') + '_' + V('TIMESTAMP') + '.json"',
  '    echo "$(date): Exporting collection: ' + V('COLL') + ' ..." >> "' + V('LOG') + '"',
  '  done',
];

console.log('Generated bash lines:');
lines.forEach(l => console.log(l));
