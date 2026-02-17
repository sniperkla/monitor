import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import SystemSetting from '@/models/SystemSetting';

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    const clientUri = req.headers.get('x-mongodb-uri');
    
    // User must either be logged in OR provide their own DB URI
    if (!session && !clientUri) {
      return NextResponse.json({ success: false, error: 'Unauthorized. Please login or configure your database.' }, { status: 401 });
    }

    // If logged in, check vault configuration in the central DB
    if (session) {
      await connectDB(process.env.MONGODB_URI, true);
      const dbUser = await User.findOne({ email: session.user.email });
      if (!dbUser || !dbUser.vault?.isConfigured) {
        return NextResponse.json({ success: false, error: 'Database connection required. Please configure your vault in Settings.' }, { status: 403 });
      }
    }

    const { message, guideContext, language = 'en' } = await req.json();

    if (!message) {
      return NextResponse.json(
        { success: false, error: 'Message is required' },
        { status: 400 }
      );
    }

    let apiKeys = [];
    let currentIndex = 0;
    let aiConfig = {
      model: 'llama-3.1-8b-instant',
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

    if (apiKeys.length === 0 && process.env.GROQ_API_KEY) {
      apiKeys.push(process.env.GROQ_API_KEY);
    }

    if (apiKeys.length === 0) {
      return NextResponse.json(
        { success: false, error: 'AI service not configured (Missing API Key)' },
        { status: 500 }
      );
    }

    // Construct the system prompt based on the guide context
    let systemPrompt = `You are an expert Linux system administrator assistant for a wiki. 
    You are currently helping a user with a specific guide.
    IMPORTANT: You must respond in the "${language}" language.
    If the language is Thai (th), respond in Thai politely (using ครับ/ค่ะ).
    If the language is Chinese (cn/zh), respond in Chinese.
    Otherwise default to English.
    
    Current Guide Information:
    Title: ${guideContext?.title || 'Unknown'}
    Description: ${guideContext?.description || 'N/A'}
    Category: ${guideContext?.category || 'General'}
    OS: ${guideContext?.os?.join(', ') || 'Any'}
    
    Navigate the user through the guide, explain commands, and provide detailed examples with input/output.
    If the user asks for examples, provide realistic terminal outputs.
    Always prioritize safety and best practices.
    
    Here are the commands listed in the guide:
    ${guideContext?.commands?.map(c => `
    - Command: ${c.code}
      Label: ${c.label}
      Explanation: ${c.explanation || ''}
      Result: ${c.result || ''}
    `).join('\n') || 'No commands listed.'}
    `;

    let aiMessage = null;
    let successfulIndex = -1;
    let lastError = null;

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
                  { role: 'user', content: message }
                ],
                model: aiConfig.model,
                temperature: aiConfig.temperature,
                max_completion_tokens: aiConfig.max_completion_tokens,
                top_p: aiConfig.top_p,
              }),
            });

            if (response.ok) {
                const data = await response.json();
                aiMessage = data.choices[0]?.message?.content || 'No response from AI.';
                successfulIndex = tryIndex;
                break;
            } else if (response.status === 429) {
                 console.warn(`Wiki Chat Rate limit on key ${tryIndex}`);
                 continue;
            } else {
                 const errorData = await response.json();
                 console.error('Groq API Error:', errorData);
                 throw new Error('Failed to communicate with AI service');
            }
        } catch (err) {
            lastError = err;
            if (err.message.includes('Rate limit')) continue;
            break;
        }
    }

    if (successfulIndex !== -1) {
         if (apiKeys.length > 1) {
             const nextIndex = (successfulIndex + 1) % apiKeys.length;
             SystemSetting.updateOne(
               { key: 'ai_api_keys' },
               { $set: { 'value.currentIndex': nextIndex } }
             ).catch(err => console.error('Failed to update key index:', err));
        }
        return NextResponse.json({ success: true, message: aiMessage });
    }

    return NextResponse.json(
        { success: false, error: lastError?.message || 'Failed to communicate with AI service' },
        { status: 500 }
    );

  } catch (error) {
    console.error('Wiki Chat API Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
