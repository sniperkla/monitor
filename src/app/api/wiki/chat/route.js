import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import SystemSetting from '@/models/SystemSetting';
import AiHistory from '@/models/AiHistory';
import { checkAndTrackAiUsage } from '@/utils/aiLimiter';
import { checkRateLimit } from '@/lib/serverGuard';
import { canUseServerAi, aiSupporterRequiredResponse } from '@/utils/supporter';
import { logger } from '@/lib/logger';


export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    
    // All AI routes require login — no anonymous or clientUri bypass
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized. Please login to use AI.' }, { status: 401 });
    }

    const { message, guideContext, language = 'en', model, prefs } = await req.json();

    // AI is a supporter feature - server-funded AI requires membership.
    // Users bringing their own API key (manual mode) are always allowed.
    const usingOwnKey = model === 'manual' && !!prefs?.aiApiKey;
    if (!(await canUseServerAi(session.user.email, usingOwnKey))) {
      return aiSupporterRequiredResponse();
    }

    // Rate limiting (per-IP)
    const clientIP = req.headers.get('x-forwarded-for') || 'unknown';
    const limitsSetting = await SystemSetting.findOne({ key: 'ai_limits' });
    const limitsValue = limitsSetting?.value && typeof limitsSetting.value === 'object' ? limitsSetting.value : {};
    const rateValue = limitsValue?.rate && typeof limitsValue.rate === 'object' ? limitsValue.rate : {};
    const wikiPerMinute = Number.isFinite(Number(rateValue.wikiPerMinute)) ? Math.max(1, Number(rateValue.wikiPerMinute)) : 20;
    const rateCheck = checkRateLimit(`ai:wiki:${clientIP}`, wikiPerMinute);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: `AI rate limit exceeded. Please wait ${Math.ceil(rateCheck.resetIn / 1000)}s.` },
        { status: 429 }
      );
    }

    // Check & track AI token limit for this user
    try {
      const guideContextStr = guideContext ? `${guideContext.title || ''} ${(guideContext.commands || []).map(c => c.code).join(' ')}` : '';
      await checkAndTrackAiUsage(session.user.email, message, '', guideContextStr);
    } catch (limitErr) {
      return NextResponse.json({ success: false, error: limitErr.message }, { status: 429 });
    }

    if (!message) {
      return NextResponse.json(
        { success: false, error: 'Message is required' },
        { status: 400 }
      );
    }

    let apiKeys = [];
    let currentIndex = 0;
    let aiConfig = {
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_completion_tokens: 600,
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
      // Ignore db error
    }

    if (model && typeof model === 'string') {
        aiConfig.model = model;
    }

    if (apiKeys.length === 0 && process.env.GROQ_API_KEY) {
      apiKeys.push(process.env.GROQ_API_KEY);
    }

    if (apiKeys.length === 0 && model !== 'manual') {
      return NextResponse.json(
        { success: false, error: 'AI service not configured (Missing API Key)' },
        { status: 500 }
      );
    }

    // Construct the system prompt based on the guide context
    let systemPrompt = `Expert Linux SysAdmin AI for a wiki guide. Language: "${language}" (If 'th' use polite Thai, if 'zh/cn' use Chinese, else English).
Guide: ${guideContext?.title || 'Unknown'} - ${guideContext?.category || 'General'}
OS: ${guideContext?.os?.join(', ') || 'Any'}

Task: Navigate user through guide, explain commands concisely, provide terminal input/output examples if asked. Prioritize safety.
Commands:
${guideContext?.commands?.map(c => `- ${c.code} (${c.label})`).join('\n') || 'None'}
`;

    let aiMessage = null;
    let successfulIndex = -1;
    let lastError = null;

    // Models to try
    const determineBestModel = () => {
        if (model === 'manual') return 'manual';
        if (model && model !== 'auto') return model;
        const text = String(message).toLowerCase();
        const isComplex = /(explain|how|why|error|fail|help|detail)/.test(text);
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
                      { role: 'user', content: String(message).slice(0, 1000) }
                    ],
                    model: customModel,
                    temperature: aiConfig.temperature,
                    max_completion_tokens: aiConfig.max_completion_tokens,
                    top_p: aiConfig.top_p,
                  }),
                });

                if (response.ok) {
                    const data = await response.json();
                    aiMessage = data.choices[0]?.message?.content || 'No response from AI.';
                    successfulIndex = 999;
                    actualUsedModel = customModel;
                    break;
                } else if (response.status === 429) {
                     lastError = new Error('Manual AI service Rate limit hit.');
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
                      { role: 'user', content: String(message).slice(0, 1000) }
                    ],
                    model: currentModel,
                    temperature: aiConfig.temperature,
                    max_completion_tokens: aiConfig.max_completion_tokens,
                    top_p: aiConfig.top_p,
                  }),
                });

                if (response.ok) {
                    const data = await response.json();
                    aiMessage = data.choices[0]?.message?.content || 'No response from AI.';
                    successfulIndex = tryIndex;
                    actualUsedModel = currentModel;
                    break;
                } else if (response.status === 429) {
                     logger.warn(`Wiki Chat Rate limit hit on key index ${tryIndex} for model ${currentModel}. Rotating...`);
                     continue;
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
             ).catch(err => logger.error('Failed to update key index:', err));
        }
        let usageInfo = null;
        if (session) {
          usageInfo = await checkAndTrackAiUsage(session.user.email, message, aiMessage);

          // PERSIST HISTORY (Centralized)
          try {
            const chatTitle = guideContext?.title || message.slice(0, 50);
            
            await AiHistory.create({
              userId: session.user.email,
              type: 'wiki',
              title: chatTitle,
              context: { guideId: guideContext?.id, category: guideContext?.category },
              messages: [
                { role: 'user', content: String(message || '(no prompt)').slice(0, 1000), timestamp: new Date() },
                { role: 'assistant', content: aiMessage || '(no response)', metadata: { model: actualUsedModel }, timestamp: new Date() }
              ]
            });
          } catch (dbErr) {
            logger.error('Failed to save Wiki AI history:', dbErr);
          }
        }
        return NextResponse.json({ success: true, message: aiMessage, usage: usageInfo });
    }

    return NextResponse.json(
        { success: false, error: lastError?.message || 'Failed to communicate with AI service' },
        { status: 500 }
    );

  } catch (error) {
    logger.error('Wiki Chat API Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
