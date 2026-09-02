#!/usr/bin/env node

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/monitor';

const SystemSettingSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  key: { type: String, required: true, index: true },
  value: mongoose.Schema.Types.Mixed
}, { collection: 'systemsettings', timestamps: true });

const SystemSetting = mongoose.model('SystemSetting', SystemSettingSchema);

function resolveUserIdQuery(userId, includeGlobal = false) {
  const candidates = [];

  if (userId && userId !== 'global') {
    candidates.push(String(userId));
    
    if (mongoose.Types.ObjectId.isValid(userId)) {
      try {
        candidates.push(new mongoose.Types.ObjectId(String(userId)));
      } catch (e) {}
    }
  }

  if (includeGlobal) {
    candidates.push('global');
  }

  if (candidates.length === 0) {
    return { userId: 'global' };
  }

  if (candidates.length === 1) {
    return { userId: candidates[0] };
  }

  return { userId: { $in: candidates } };
}

async function test() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);

    const userId = '6a5933a8b96fc45faa69184a';
    
    const query = {
      ...resolveUserIdQuery(userId, true),
      key: { $regex: '^auto_deploy_config' }
    };
    
    console.log('\nQuery:', JSON.stringify(query, null, 2));
    console.log('\nUsing Mongoose Model.find()...');
    
    const docs = await SystemSetting.find(query).lean();
    
    console.log(`\nFound ${docs.length} documents:`);
    docs.forEach(d => {
      const type = d.userId instanceof mongoose.Types.ObjectId ? 'ObjectId' : typeof d.userId;
      console.log(`  - ${d.key} (userId: ${d.userId}, type: ${type})`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

test();
