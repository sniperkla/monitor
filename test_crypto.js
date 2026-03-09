const { encryptWithPassword, decryptWithPassword } = require('./src/utils/encryption.js');

const pass = 'hello';
const orig = 'my_secret_password';
const enc = encryptWithPassword(orig, pass);
console.log('Encrypted:', enc);

const dec = decryptWithPassword(enc, pass);
console.log('Decrypted:', dec);
