const { encryptWithPassword, decryptWithPassword, encrypt } = require('./src/utils/encryption.js');

const pass = 'mypassword';
const plain = 'supersecret';

// Simulate Export
const exportedEnc = encryptWithPassword(plain, pass);
console.log('Exported:', exportedEnc);

function reEncrypt(value, password) {
  if (!value) return null;
  if (typeof value === 'string' && !value.includes(':')) {
    return encrypt(value);
  }
  if (password) {
    const dec = decryptWithPassword(value, password);
    console.log('decrypted plain:', dec);
    if (dec !== null) return encrypt(dec);
  }
  return encrypt(value);
}

// Simulate Import
const importedEnc = reEncrypt(exportedEnc, pass);
console.log('Imported:', importedEnc);
