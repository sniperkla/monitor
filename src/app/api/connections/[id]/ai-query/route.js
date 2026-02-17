import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

import { checkRateLimit } from '@/lib/serverGuard';

export async function POST(req, { params }) {
  try {
    // Rate limiting for AI queries (expensive)
    const clientIP = req.headers.get('x-forwarded-for') || 'unknown';
    const rateCheck = checkRateLimit(`ai:${clientIP}`, 15); // Max 15 AI queries per minute
    if (!rateCheck.allowed) {
      return NextResponse.json({ 
        success: false, error: `AI rate limit exceeded. Please wait ${Math.ceil(rateCheck.resetIn / 1000)}s.` 
      }, { status: 429 });
    }

    const session = await getServerSession(authOptions);
    const { id } = await params;
    const { prompt, provider, schemaName, sampleData } = await req.json();

    if (!prompt) {
      return NextResponse.json({ success: false, error: 'Prompt is required' }, { status: 400 });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'AI service not configured (Missing API Key)' }, { status: 500 });
    }

    const systemPrompt = `You are a Senior Database Architect and Query Optimization Expert.
    Your task is to translate natural language into precise database queries.
    
    CONTEXT:
    - Provider: ${provider} (CRITICAL: Use exact syntax for this vendor)
    - Collection/Table: ${schemaName}
    - Sample Data Structure: ${JSON.stringify(sampleData?.[0] || {})}
    
    THINKING PROCESS (Chain of Thought):
    1. ANALYZE: Identify the user's core intent. 
       - READ: "find", "show", "search", "filter" (Mongo: return JSON filter only. SQL: return WHERE clause only.)
       - ACTION: "delete", "remove", "update", "change", "set" (Mongo: return an executable JSON action object. SQL: return a FULL SQL statement.)
       - CREATE: "add", "insert", "create", "mock", "generate" (Mongo: return an executable JSON insert action. SQL: return FULL INSERT.)
    2. MAP: Correlate user terms to the exact field names found in the Sample Data.
    3. VALIDATE: Ensure the query handles specific data types.
    4. OPTIMIZE: Use efficient operators.

    OUTPUT FORMAT:
    You must output your response in two parts:
    1. <thought> Your step-by-step reasoning </thought>
    2. <query> The final valid code/JSON string ONLY </query>
    3. <repeat> (Optional) If the user demands a large number of rows (e.g., > 5), specify the total count here and ONLY generate 1-3 sample rows in the query.

    RULES:
    1. MongoDB:
       - READ (find): return ONLY a valid JSON filter object.
       - DELETE: return an executable JSON action object:
         {"action":"deleteOne"|"deleteMany","collection":"${schemaName}","filter":{...}}
       - UPDATE: return an executable JSON action object:
         {"action":"updateOne"|"updateMany","collection":"${schemaName}","filter":{...},"update":{"$set":{...}}}
       - INSERT: return an executable JSON action object:
         {"action":"insertOne"|"insertMany","collection":"${schemaName}","data":{...} | [{...}]}
    2. SQL (Read): If the user just wants to find/see records, return ONLY the WHERE clause.
    3. SQL (Action): If the user says "DELETE", "UPDATE", or "INSERT", return the FULL SQL statement.
    4. Mock Data: If the user asks to "mock" or "generate" data (e.g., "mock 100 items"), generate a valid INSERT statement. 
       - EFFICIENCY TRICK: If the requested count is large (>5), generate ONLY 1 sample row to save tokens.
       - Use the <repeat>N</repeat> tag to tell the system to multiply this row N times.
       - Example: User "100 rows" -> <repeat>100</repeat><query>INSERT ... VALUES (one_row)</query>
       - Use "sampleData" to infer realistic values and types.
    5. Always use the provided Table/Collection name: ${schemaName}
    6. DATE/TIME FIX: For "createdAt", "updatedAt", "lastConnected" or similar date fields, use NULL or omit them in the INSERT statement unless explicitly asked. 
       - Do NOT generate strings like '2026-02-15...' for SQL DATETIME columns as they often fail. Let the DB handle defaults.
    7. JSON FIX: For columns like "tags", "settings", "metadata", "config", ALWAYS format as valid JSON string.
       - BAD: 'prod' 
       - GOOD: '["prod"]' or '{"env": "prod"}'

    Example (SQL Mock Large):
    User: "mock 100 users"
    <thought>User wants 100 rows. Too many tokens. I will generate 1 row and ask the system to repeat it 100 times. I will skip date fields to avoid errors.</thought>
    <repeat>100</repeat>
    <query>INSERT INTO ${schemaName} (name, role, tags) VALUES ('User 1', 'admin', '["user"]')</query>

    Example (SQL Delete):
    User: "delete all error logs"
    <thought>User wants to perform a destructive action. For SQL, I will return a full DELETE statement.</thought>
    <query>DELETE FROM ${schemaName} WHERE status = 'error'</query>

    Example (MongoDB Find):
    User: "find users named john"
    <thought>User wants to see data. I will return a JSON filter.</thought>
    <query>{"name": { "$regex": "john", "$options": "i" }}</query>

    Example (MongoDB Delete):
    User: "delete all users named john"
    <thought>User wants destructive delete. I will return an executable deleteMany object.</thought>
    <query>{"action":"deleteMany","collection":"${schemaName}","filter":{"name":{"$regex":"john","$options":"i"}}}</query>
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
          { role: 'user', content: prompt }
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.2, 
        max_completion_tokens: 1024,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to connect to AI service');
    }

    const resData = await response.json();
    const fullContent = resData.choices[0]?.message?.content || '';
    
    // Return the RAW content so the frontend can parse <query> and <repeat> tags itself
    // We only strip the <thought> block to save bandwidth/confusion if needed, but it's safer to send it all.
    // However, let's just send the raw content. The frontend has the regex logic to handle it.
    
    return NextResponse.json({ success: true, query: fullContent });

  } catch (error) {
    console.error('AI Query Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
