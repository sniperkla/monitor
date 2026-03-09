const { encryptWithPassword } = require('./src/utils/encryption.js');

const pass = 'hello';
const plain = null;
console.log('enc', encryptWithPassword(plain, pass));
