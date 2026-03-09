sed -i '' 's/function reEncrypt/function reEncrypt___old/' src/app/api/connections/import/route.js
cat << 'INNER' >> src/app/api/connections/import/route.js

function reEncrypt(value, password, oldKey, label) {
  if (!value) return null;
  if (typeof value === "string" && !value.includes(":")) {
    console.log(`[reEncrypt] ${label} - no colons, treating as plain`);
    return encrypt(value);
  }
  
  if (password) {
    const plain = decryptWithPassword(value, password);
    if (plain !== null) {
      console.log(`[reEncrypt] ${label} - successfully decrypted with password`);
      return encrypt(plain);
    } else {
      console.log(`[reEncrypt] ${label} - failed to decrypt with password! value was: ${value}`);
    }
  }
  if (oldKey) {
    const plain = decryptWithCustomKey(value, oldKey);
    if (plain !== null) return encrypt(plain);
  }
  const meta = decryptWithMetadata(value);
  if (meta.success && meta.text !== value) {
     return encrypt(meta.text); 
  }
  console.log(`[reEncrypt] ${label} - fallback to double encrypting value: ${value}`);
  return encrypt(value);
}
INNER
