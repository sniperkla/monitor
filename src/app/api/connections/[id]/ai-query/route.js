import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import { checkRateLimit } from '@/lib/serverGuard';
import { checkAndTrackAiUsage } from '@/utils/aiLimiter';

export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { prompt, provider, schemaName, sampleData } = await req.json();

    if (!prompt) {
      return NextResponse.json({ success: false, error: 'Prompt is required' }, { status: 400 });
    }

    // Check AI token limit
    let usageInfo = null;
    try {
      await checkAndTrackAiUsage(session.user.email, prompt);
    } catch (limitErr) {
      return NextResponse.json({ success: false, error: limitErr.message }, { status: 429 });
    }

    const limitsSetting = await SystemSetting.findOne({ key: 'ai_limits' });
    const limitsValue = limitsSetting?.value && typeof limitsSetting.value === 'object' ? limitsSetting.value : {};
    const rateValue = limitsValue?.rate && typeof limitsValue.rate === 'object' ? limitsValue.rate : {};
    const dbPerMinute = Number.isFinite(Number(rateValue.dbPerMinute)) ? Math.max(1, Number(rateValue.dbPerMinute)) : 15;

    // Rate limiting for AI queries (expensive)
    const clientIP = req.headers.get('x-forwarded-for') || 'unknown';
    const rateCheck = checkRateLimit(`ai:${clientIP}`, dbPerMinute);
    if (!rateCheck.allowed) {
      return NextResponse.json({ 
        success: false, error: `AI rate limit exceeded. Please wait ${Math.ceil(rateCheck.resetIn / 1000)}s.` 
      }, { status: 429 });
    }

    const { id } = await params;

    await connectDB();

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
      // Ignore
    }

    if (apiKeys.length === 0 && process.env.GROQ_API_KEY) {
      apiKeys.push(process.env.GROQ_API_KEY);
    }

    if (apiKeys.length === 0) {
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

    CRITICAL RULES:
    1. MongoDB:
       - READ (find): return ONLY a valid JSON filter object.
       - DELETE: return an executable JSON action object:
         {"action":"deleteOne"|"deleteMany","collection":"${schemaName}","filter":{...}}
       - UPDATE: return an executable JSON action object:
         {"action":"updateOne"|"updateMany","collection":"${schemaName}","filter":{...},"update":{"$set":{...}}}
       - INSERT: return an executable JSON action object:
         {"action":"insertOne"|"insertMany","collection":"${schemaName}","data":{...} | [{...}]}
    
    2. MySQL/PostgreSQL (SQL) - READ OPERATIONS:
       - If the user just wants to find/see records, return ONLY the WHERE clause in proper SQL syntax.
       - NEVER use JSON syntax like {"field": "value"} for SQL.
       - CORRECT SQL: field = 'value' OR field LIKE '%value%'
       - BAD (JSON): {"field": "value"}
       - Use proper SQL operators: =, !=, <, >, LIKE, IN, BETWEEN, IS NULL
       - Example: name = 'production' AND status = 'active'
       - Example: age > 25 AND name LIKE '%john%'
    
    3. MySQL/PostgreSQL (SQL) - ACTION OPERATIONS:
       - If the user says "DELETE", "UPDATE", or "INSERT", return the FULL SQL statement.
       - DELETE: DELETE FROM ${schemaName} WHERE field = 'value'
       - UPDATE: UPDATE ${schemaName} SET field = 'value' WHERE condition
       - INSERT: INSERT INTO ${schemaName} (field1, field2) VALUES ('value1', 'value2')
    
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

    Example (SQL Read - CORRECT):
    User: "find users named john"
    <thought>User wants to find records with name = 'john'. For SQL, I return a WHERE clause.</thought>
    <query>name = 'john'</query>

    Example (SQL Read - BAD - NEVER DO THIS):
    <query>{"name": "john"}</query>

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

    let answer = null;
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
                        { role: 'user', content: prompt }
                    ],
                    model: aiConfig.model,
                    temperature: aiConfig.temperature,
                    max_completion_tokens: aiConfig.max_completion_tokens,
                    top_p: aiConfig.top_p,
                }),
            });

            

            if (response.ok) {
                const resData = await response.json();
                answer = resData.choices[0]?.message?.content || '';
                successfulIndex = tryIndex;
                break;
            } else if (response.status === 429) {
                console.warn(`AI Query Rate limit hit on key index ${tryIndex}. Rotating...`);
                continue;
            } else {
                const errBody = await response.text().catch(() => '');
                throw new Error(`AI service error (${response.status}): ${errBody.slice(0, 200)}`);
            }
        } catch (err) {
            lastError = err;
            if (err.message.includes('429')) continue;
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
        usageInfo = await checkAndTrackAiUsage(session.user.email, prompt, answer);
        return NextResponse.json({ success: true, query: answer, usage: usageInfo });
    }

    return NextResponse.json({ success: false, error: lastError?.message || 'AI Rate limit exceeded on all keys.' }, { status: 429 });

  } catch (error) {
    console.error('AI Query Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
