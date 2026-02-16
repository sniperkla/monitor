const mongoose = require('mongoose');

const WikiSchema = new mongoose.Schema({
  title: { type: String, required: true, unique: true },
  category: { type: String, required: true },
  os: { type: [String], default: ['All Linux'] },
  description: { type: String, required: true },
  commands: [{ label: String, code: String, explanation: String, result: String }],
  tags: [String],
  author: String,
  updatedAt: { type: Date, default: Date.now }
});

const Wiki = mongoose.models.Wiki || mongoose.model('Wiki', WikiSchema);

// Load guides from separate files
const part1 = require('./wikiPart1');
const part2 = require('./wikiPart2');
const part3 = require('./wikiPart3');
const part4 = require('./wikiPart4');
const part5 = require('./wikiPart5');
const guides = [...part1, ...part2, ...part3, ...part4, ...part5];

async function seed() {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ssh-monitor';
  
  console.log('🚀 Connecting to MongoDB...');
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected.\n');

    console.log('🧹 Cleaning existing wiki data...');
    await Wiki.deleteMany({});
    
    console.log(`🌱 Seeding ${guides.length} guides...\n`);
    
    const byOs = {};
    for (const guide of guides) {
      await Wiki.create(guide);
      const osTag = (guide.os || ['All Linux']).join(', ');
      console.log(`   ✅ [${osTag}]  ${guide.category} → ${guide.title}`);
      (guide.os || ['All Linux']).forEach(o => { byOs[o] = (byOs[o] || 0) + 1; });
    }

    console.log(`\n✨ Seeding successful! ${guides.length} guides total.`);
    console.log('\n📊 Guides per OS:');
    Object.entries(byOs).sort((a,b) => b[1]-a[1]).forEach(([os, count]) => {
      console.log(`   ${os}: ${count}`);
    });
  } catch (err) {
    console.error('❌ Error seeding data:', err);
  } finally {
    mongoose.connection.close();
  }
}

seed();
