import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';

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

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'GROQ_API_KEY not configured' },
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
        model: 'llama-3.3-70b-versatile', // Using a capable model
        temperature: 0.5,
        max_completion_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Groq API Error:', errorData);
      return NextResponse.json(
        { success: false, error: 'Failed to communicate with AI service' },
        { status: response.status }
      );
    }

    const data = await response.json();
    const aiMessage = data.choices[0]?.message?.content || 'No response from AI.';

    return NextResponse.json({ success: true, message: aiMessage });

  } catch (error) {
    console.error('Wiki Chat API Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
