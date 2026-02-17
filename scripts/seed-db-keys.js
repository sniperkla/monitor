const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Load env
try {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
      const firstEqual = line.indexOf('=');
      if (firstEqual > 0) {
        const key = line.substring(0, firstEqual).trim();
        let value = line.substring(firstEqual + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.substring(1, value.length - 1);
        }
        if (key && !process.env[key]) process.env[key] = value;
      }
    });
  }
} catch (e) { console.error('Error loading .env', e); }

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in environment.');
  process.exit(1);
}

// Define model inline to avoid module issues
const SystemSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: mongoose.Schema.Types.Mixed,
}, { timestamps: true });

const SystemSetting = mongoose.models.SystemSetting || mongoose.model('SystemSetting', SystemSettingSchema);

async function seed() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected.');

    const scriptPath = path.join(__dirname, 'grok.txt');
    if (!fs.existsSync(scriptPath)) {
      console.error('❌ scripts/grok.txt not found.');
      process.exit(1);
    }

    const content = fs.readFileSync(scriptPath, 'utf-8');
    const existingKeys = content.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 10 && !line.startsWith('#'));

    if (existingKeys.length === 0) {
      console.error('❌ No valid keys found in grok.txt');
      process.exit(1);
    }

    console.log(`Found ${existingKeys.length} keys.`);

    let setting = await SystemSetting.findOne({ key: 'ai_api_keys' });
    if (!setting) {
      setting = new SystemSetting({
        key: 'ai_api_keys',
        value: { keys: existingKeys, currentIndex: 0, provider: 'groq' }
      });
      console.log('Created new ai_api_keys setting.');
    } else {
      setting.value.keys = existingKeys;
      if (setting.value.currentIndex >= existingKeys.length) setting.value.currentIndex = 0;
      setting.markModified('value');
      console.log('Updated existing ai_api_keys setting.');
    }

    await setting.save();
    console.log('✅ Successfully seeded AI API keys.');

    // Seed Config
    let config = await SystemSetting.findOne({ key: 'ai_config' });
    const defaultConfig = {
      model: 'llama-3.1-8b-instant',
      temperature: 0.1,
      max_completion_tokens: 600,
      top_p: 0.9,
    };

    if (!config) {
      config = new SystemSetting({
        key: 'ai_config',
        value: defaultConfig
      });
      console.log('Created new ai_config setting.');
    } else {
      // For safety, let's not overwrite if already exists, 
      // but the user asked for this specific config now.
      // I'll update it to match requested state.
      config.value = { ...config.value, ...defaultConfig };
      config.markModified('value');
      console.log('Updated existing ai_config setting.');
    }

    await config.save();
    console.log('✅ Successfully seeded AI configuration.');

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

seed();
