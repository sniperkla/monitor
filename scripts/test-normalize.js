const mongoose = require('mongoose');

function normalizeUserId(userId, forceString = false) {
  if (!userId) return 'global';
  
  if (forceString) {
    return String(userId);
  }
  
  const userIdStr = String(userId);
  if (mongoose.Types.ObjectId.isValid(userIdStr)) {
    try {
      return new mongoose.Types.ObjectId(userIdStr);
    } catch (e) {
      return userIdStr;
    }
  }
  
  return userIdStr;
}

console.log('Testing normalizeUserId:\n');
console.log('1. Valid ObjectId string:', normalizeUserId('6a5933a8b96fc45faa69184a'));
console.log('   Type:', typeof normalizeUserId('6a5933a8b96fc45faa69184a'));
console.log('   Is ObjectId:', normalizeUserId('6a5933a8b96fc45faa69184a') instanceof mongoose.Types.ObjectId);

console.log('\n2. "global" string:', normalizeUserId('global'));
console.log('   Type:', typeof normalizeUserId('global'));

console.log('\n3. Email:', normalizeUserId('user@example.com'));
console.log('   Type:', typeof normalizeUserId('user@example.com'));

console.log('\n4. With forceString=true:', normalizeUserId('6a5933a8b96fc45faa69184a', true));
console.log('   Type:', typeof normalizeUserId('6a5933a8b96fc45faa69184a', true));
