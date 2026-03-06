import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import AiHistory from '@/models/AiHistory';
import { checkRateLimit } from '@/lib/serverGuard';
import { checkAndTrackAiUsage } from '@/utils/aiLimiter';

export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { prompt, schemaName, sampleData, history, provider, model, prefs } = await request.json();

    if (!prompt) {
      return NextResponse.json({ success: false, error: 'Prompt is required' }, { status: 400 });
    }

    // Check AI token limit (include schema context for accurate estimate)
    try {
      const contextStr = `${schemaName || ''} ${JSON.stringify(sampleData || {}).slice(0, 500)}`;
      await checkAndTrackAiUsage(session.user.email, prompt, '', contextStr);
    } catch (limitErr) {
      return NextResponse.json({ success: false, error: limitErr.message }, { status: 429 });
    }

    const limitsSetting = await SystemSetting.findOne({ key: 'ai_limits' });
    const limitsValue = limitsSetting?.value && typeof limitsSetting.value === 'object' ? limitsSetting.value : {};
    const rateValue = limitsValue?.rate && typeof limitsValue.rate === 'object' ? limitsValue.rate : {};
    const dbPerMinute = Number.isFinite(Number(rateValue.dbPerMinute)) ? Math.max(1, Number(rateValue.dbPerMinute)) : 15;

    // Rate limiting for AI queries (expensive)
    const clientIP = request.headers.get('x-forwarded-for') || 'unknown';
    const rateCheck = checkRateLimit(`ai:${clientIP}`, dbPerMinute);
    if (!rateCheck.allowed) {
      return NextResponse.json({ 
        success: false, error: `AI rate limit exceeded. Please wait ${Math.ceil(rateCheck.resetIn / 1000)}s.` 
      }, { status: 429 });
    }

    await connectDB();

    let apiKeys = [];
    let currentIndex = 0;
    let aiConfig = {
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_completion_tokens: 4096,
      top_p: 0.9,
    };

    try {
      const keysSetting = await SystemSetting.findOne({ key: 'ai_api_keys' });
      if (keysSetting && keysSetting.value && Array.isArray(keysSetting.value.keys) && keysSetting.value.keys.length > 0) {
        apiKeys = keysSetting.value.keys;
        currentIndex = keysSetting.value.currentIndex || 0;
      }

      const configSetting = await SystemSetting.findOne({ key: 'ai_config' });
      if (configSetting && configSetting.value) {
        aiConfig = { ...aiConfig, ...configSetting.value };
      }
    } catch (e) {
      // Ignore
    }

    if (model && typeof model === 'string') {
        aiConfig.model = model;
    }

    if (apiKeys.length === 0 && process.env.GROQ_API_KEY) {
      apiKeys.push(process.env.GROQ_API_KEY);
    }

    if (apiKeys.length === 0 && model !== 'manual') { // Only check if not manual
      return NextResponse.json({ success: false, error: 'AI service not configured (Missing API Key)' }, { status: 500 });
    }

    const systemPrompt = `You are a Database Expert translating natural language to queries.
CTX: Vendor: ${provider}, Schema: ${schemaName}
Sample Data: ${JSON.stringify(sampleData?.[0] || {}).slice(0, 1000)}

STEPS:
1. Identify intent: READ, ACTION (delete/update), MOCK.
2. Formulate query using precise fields from sample data.
3. OUTPUT: <thought>Short reasoning</thought> <query>Final Valid Code/JSON ONLY</query> <repeat>N</repeat> (optional, for mock data multiplier)

RULES:
1. MongoDB:
 - READ (find): Return JSON filter object: {"name": "x"}
 - ACTION: Return executable action obj: {"action":"updateOne","collection":"${schemaName}","filter":{},"update":{"$set":{}}}
2. SQL (MySQL/PostgreSQL):
 - READ: Return WHERE clause ONLY (e.g. name = 'x' AND status = 1). DO NOT output JSON {"name":"x"}!
 - ACTION: Return FULL SQL statement (DELETE FROM..., UPDATE..., INSERT...).
3. MOCK DATA: For N>5 rows, output 1 sample row & use <repeat>N</repeat> tag!
 - SQL Dates (createdAt, etc): Use NULL or omit. Don't mock datetime strings.
 - SQL JSON columns: Use valid stringified JSON (e.g. '["tag1"]').`;

    let answer = null;
    let successfulIndex = -1;
    let lastError = null;

    const safeHistory = Array.isArray(history) ? history.slice(-4) : [];
    const historyMessages = safeHistory.flatMap(h => {
      const msgs = [];
      if (h.role === 'user' && h.content) msgs.push({ role: 'user', content: String(h.content).slice(0, 400) });
      if (h.role === 'assistant' && h.content) {
         const qMatch = String(h.content).match(/<query>([\s\S]*?)<\/query>/i);
         msgs.push({ role: 'assistant', content: qMatch ? `<query>${qMatch[1].trim()}</query>` : String(h.content).slice(0, 200) });
      }
      return msgs;
    });

    const determineBestModel = () => {
        if (model === 'manual') return 'manual';
        if (model && model !== 'auto') return model;
        
        const text = prompt.toLowerCase();
        const isComplex = /(mock|generate|aggregate|group|join|optimize|analyze|pivot|complex)/.test(text);
        
        if (isComplex && text.length > 300) {
            return 'llama-3.3-70b-versatile';
        }
        if (isComplex || text.length > 200) {
            return 'meta-llama/llama-4-scout-17b-16e-instruct';
        }
        return 'llama-3.1-8b-instant';
    };

    const mainModel = determineBestModel();
    let fallbackModel = mainModel;
    if (mainModel !== 'manual') {
        fallbackModel = mainModel === 'llama-3.1-8b-instant' 
            ? 'meta-llama/llama-4-scout-17b-16e-instruct' 
            : 'llama-3.3-70b-versatile';
    }
        
    const modelsToTry = [mainModel];
    if (mainModel !== 'manual' && mainModel !== fallbackModel) modelsToTry.push(fallbackModel);
    
    // Final fallback
    if (mainModel !== 'manual' && !modelsToTry.includes('llama-3.3-70b-versatile')) {
        modelsToTry.push('llama-3.3-70b-versatile');
    }

    let actualUsedModel = mainModel;

    for (const currentModel of modelsToTry) {
        if (currentModel === 'manual') {
            const manualEndpoint = prefs?.aiEndpoint || 'https://api.openai.com/v1/chat/completions';
            const manualApiKey = prefs?.aiApiKey;
            const customModel = prefs?.aiCustomModel || 'gpt-3.5-turbo';

            if (!manualApiKey) {
                lastError = new Error('Manual AI service: Missing API Key in settings');
                break;
            }

            try {
                const response = await fetch(manualEndpoint, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${manualApiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://zeroclaw.local',
                        'X-Title': 'ZeroClaw Monitor'
                    },
                    body: JSON.stringify({
                        messages: [
                            { role: 'system', content: systemPrompt },
                            ...historyMessages,
                            { role: 'user', content: prompt }
                        ],
                        model: customModel,
                        temperature: aiConfig.temperature || 0,
                        max_completion_tokens: aiConfig.max_completion_tokens || 8000,
                        top_p: aiConfig.top_p || 1
                    }),
                });

                if (response.ok) {
                    const resData = await response.json();
                    answer = resData.choices[0]?.message?.content || '';
                    successfulIndex = 999;
                    actualUsedModel = customModel;
                    break;
                } else if (response.status === 429) {
                    lastError = new Error('Manual AI service: Rate limit hit.');
                } else {
                    const errBody = await response.text().catch(() => '');
                    lastError = new Error(`Manual AI service error (${response.status}): ${errBody.slice(0, 200)}`);
                }
            } catch (err) {
                lastError = err;
            }
            break;
        }

        for (let i = 0; i < apiKeys.length; i++) {
            const tryIndex = (currentIndex + i) % apiKeys.length;
            const apiKey = apiKeys[tryIndex];

            try {
                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        messages: [
                            { role: 'system', content: systemPrompt },
                            ...historyMessages,
                            { role: 'user', content: prompt }
                        ],
                        model: currentModel,
                        temperature: aiConfig.temperature || 0,
                        max_completion_tokens: Math.min(aiConfig.max_completion_tokens || 8000, 8000), // Some groq models strict on this
                        top_p: aiConfig.top_p || 1
                    }),
                });

                if (response.ok) {
                    const resData = await response.json();
                    answer = resData.choices[0]?.message?.content || '';
                    successfulIndex = tryIndex;
                    actualUsedModel = currentModel;
                    break;
                } else if (response.status === 429) {
                    console.warn(`Query: Rate limit hit on key index ${tryIndex}. Rotating...`);
                } else {
                    const errBody = await response.text().catch(() => '');
                     throw new Error(`AI service error (${response.status}): ${errBody.slice(0, 200)}`);
                }
            } catch (err) {
                lastError = err;
                continue;
            }
        }
        if (successfulIndex !== -1) break;
    }

    if (successfulIndex !== -1) {
        if (apiKeys.length > 1 && successfulIndex !== 999) {
             const nextIndex = (successfulIndex + 1) % apiKeys.length;
             SystemSetting.updateOne(
               { key: 'ai_api_keys' },
               { $set: { 'value.currentIndex': nextIndex } }
             ).catch(err => console.error('Failed to update query key index:', err));
        }
        
        let usageInfo = null;
        if (session) {
          usageInfo = await checkAndTrackAiUsage(session.user.email, prompt, answer);

          // PERSIST HISTORY
          try {
            const queryTitle = prompt.slice(0, 70);
            
            await AiHistory.create({
              userId: session.user.email,
              type: 'database',
              title: queryTitle,
              context: { connectionId: id, provider, schemaName },
              messages: [
                { role: 'user', content: prompt || '(no prompt)', timestamp: new Date() },
                { role: 'assistant', content: answer || '(no response)', metadata: { usedModel: actualUsedModel }, timestamp: new Date() }
              ]
            });
          } catch (dbErr) {
            console.error('Failed to save DB AI history:', dbErr);
          }
        }
        return NextResponse.json({ success: true, query: answer, usage: usageInfo, usedModel: actualUsedModel });
    }

    return NextResponse.json({ success: false, error: lastError?.message || 'AI Rate limit exceeded on all keys.' }, { status: 429 });

  } catch (error) {
    console.error('AI Query Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
