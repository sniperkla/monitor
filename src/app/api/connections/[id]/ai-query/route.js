import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import SystemSetting from '@/models/SystemSetting';
import AiHistory from '@/models/AiHistory';
import { checkRateLimit } from '@/lib/serverGuard';
import { checkAndTrackAiUsage } from '@/utils/aiLimiter';
import { canUseServerAi, aiSupporterRequiredResponse } from '@/utils/supporter';
import { logger } from '@/lib/logger';
import { getClientIp } from '@/lib/clientIp';
import { assertSafeHttpUrl } from '@/lib/ssrfGuard';


const stripAiQueryEnvelope = (text = '') => {
  const raw = String(text || '');
  const tagMatch = raw.match(/<query>([\s\S]*?)<\/query>/i);
  const content = tagMatch ? tagMatch[1] : raw;
  return content
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
    .replace(/<repeat>[\s\S]*?<\/repeat>/gi, '')
    .replace(/```(?:json|sql)?/gi, '')
    .replace(/```/g, '')
    .trim();
};

const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeSqlString = (value = '') => String(value).replace(/'/g, "''");

const sqlQueryLooksUsable = (query = '') => {
  const trimmed = String(query || '').trim();
  if (!trimmed) return false;
  return /^(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN|WITH|DELETE|UPDATE|INSERT|DROP|ALTER|TRUNCATE|CREATE)\b/i.test(trimmed)
    || /^WHERE\b/i.test(trimmed)
    || /^[A-Za-z_`\"][A-Za-z0-9_`\".]*\s*(=|<>|!=|>=|<=|>|<|LIKE|IN|IS)\b/i.test(trimmed);
};

const buildSqlHeuristicQuery = ({ prompt, sampleData, schemaName }) => {
  const sourcePrompt = String(prompt || '').trim();
  if (!sourcePrompt) return '';
  const firstRow = sampleData?.[0] && typeof sampleData[0] === 'object' ? sampleData[0] : {};
  const columns = Object.keys(firstRow).sort((a, b) => b.length - a.length);
  if (!columns.length) return '';

  for (const column of columns) {
    const escapedColumn = escapeRegExp(column);
    const containsPattern = "\\b" + escapedColumn + "\\b[\\s\\w]*?(?:contains?|contain|like|includes?|include)\\s+[\"']?([^\"'.,!?\\n]+)[\"']?";
    const containsMatch = sourcePrompt.match(new RegExp(containsPattern, 'i'));
    if (containsMatch?.[1]) {
      return `${column} LIKE '%${escapeSqlString(containsMatch[1].trim())}%'`;
    }

    const equalsPattern = "\\b" + escapedColumn + "\\b[\\s\\w]*?(?:=|is|equals?)\\s+[\"']?([^\"'.,!?\\n]+)[\"']?";
    const equalsMatch = sourcePrompt.match(new RegExp(equalsPattern, 'i'));
    if (equalsMatch?.[1]) {
      const rawValue = equalsMatch[1].trim();
      const sampleValue = firstRow[column];
      if (typeof sampleValue === 'number' && /^-?\d+(?:\.\d+)?$/.test(rawValue)) {
        return `${column} = ${rawValue}`;
      }
      return `${column} = '${escapeSqlString(rawValue)}'`;
    }
  }

  const textColumn = columns.find((column) => typeof firstRow[column] === 'string');
  const genericContainsMatch = sourcePrompt.match(/(?:contains?|contain|like|includes?|include)\s+["'\`]?(.*?)["'\`]?(?:$|\?|!|\.)/i);
  if (textColumn && genericContainsMatch?.[1]?.trim()) {
    return `${textColumn} LIKE '%${escapeSqlString(genericContainsMatch[1].trim())}%'`;
  }

  return '';
};

const buildSchemaContext = (schemaName, sampleData) => {
  const firstRow = sampleData?.[0] && typeof sampleData[0] === 'object' ? sampleData[0] : {};
  const columns = Object.keys(firstRow);
  return {
    columns,
    summary: `Table: ${schemaName || 'unknown'}\nColumns: ${columns.join(', ') || '(none)'}\nSample Row: ${JSON.stringify(firstRow).slice(0, 1200)}`
  };
};

const buildSqlRepairPrompt = ({ prompt, schemaName, sampleData, previousAnswer }) => {
  const schemaContext = buildSchemaContext(schemaName, sampleData);
  return `The previous SQL generation was empty or unusable, or interpreted semantic concepts too literally.

Original user request: ${prompt}
${schemaContext.summary}
Previous AI answer: ${previousAnswer || '(empty)'}

Return ONLY one of the following inside <query>:</query>
- a FULL SQL SELECT/SHOW/DESCRIBE/EXPLAIN statement when the user asks for a report, semantic inference, aggregation, another table, or specific output columns
- a WHERE clause only when the request is a simple current-table filter
- a FULL SQL action statement for delete/update/insert/create/alter/drop

You must infer semantic intent. Example: "weak passwords" DOES NOT mean text LIKE '%weak%'. It means password length < 8, password IN ('123456', '0101', 'password', 'aabb1234'), or password equals username.`;
};

const requestChatCompletion = async ({ modelName, messages, aiConfig, apiKey, prefs }) => {
  if (modelName === 'manual') {
    const manualEndpoint = prefs?.aiEndpoint || 'https://api.openai.com/v1/chat/completions';
    const manualApiKey = prefs?.aiApiKey;
    const customModel = prefs?.aiCustomModel || 'gpt-3.5-turbo';
    if (!manualApiKey) throw new Error('Manual AI service: Missing API Key in settings');

    const ssrfCheck = await assertSafeHttpUrl(manualEndpoint);
    if (!ssrfCheck.safe) {
      throw new Error(`Invalid or blocked AI endpoint URL: ${ssrfCheck.reason}`);
    }

    const response = await fetch(manualEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${manualApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://zeroclaw.local',
        'X-Title': 'ZeroClaw Monitor'
      },
      body: JSON.stringify({
        messages,
        model: customModel,
        temperature: aiConfig.temperature !== undefined ? aiConfig.temperature : 0.1,
        // Provider compatibility: send max_tokens by default; only include
        // max_completion_tokens when explicitly configured, since some
        // OpenAI-compatible providers reject unknown body parameters.
        max_tokens: aiConfig.max_completion_tokens || 8000,
        ...(aiConfig.max_completion_tokens ? { max_completion_tokens: aiConfig.max_completion_tokens } : {}),
        top_p: aiConfig.top_p || 1
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Manual AI service error (${response.status}): ${errBody.slice(0, 200)}`);
    }

    const resData = await response.json();
    logger.info('[OpenRouter] Response status:', resData.error ? 'error' : 'success');
    
    if (resData.error) {
       throw new Error(resData.error.message || JSON.stringify(resData.error));
    }
    
    return {
      content: resData.choices?.[0]?.message?.content || '',
      usedModel: customModel
    };
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages,
      model: modelName,
      temperature: aiConfig.temperature !== undefined ? aiConfig.temperature : 0.1,
      max_tokens: Math.min(aiConfig.max_completion_tokens || 8000, 8000),
      max_completion_tokens: Math.min(aiConfig.max_completion_tokens || 8000, 8000),
      top_p: aiConfig.top_p || 1
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`AI service error (${response.status}): ${errBody.slice(0, 200)}`);
  }

  const resData = await response.json();
  if (resData.error) {
     throw new Error(resData.error.message || JSON.stringify(resData.error));
  }
  return {
    content: resData.choices?.[0]?.message?.content || '',
    usedModel: modelName
  };
};

export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { prompt, schemaName, sampleData, history, provider, model, prefs } = await request.json();

    // AI is a supporter feature - server-funded AI requires membership.
    // Users bringing their own API key (manual mode) are always allowed.
    const usingOwnKey = model === 'manual' && !!prefs?.aiApiKey;
    if (!(await canUseServerAi(session.user.email, usingOwnKey))) {
      return aiSupporterRequiredResponse();
    }

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
    const clientIP = getClientIp(request);
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

    if (prefs?.groqApiKey && model !== 'manual') {
      // Prioritize the user's custom GROQ API key from their preferences if provided
      apiKeys = [prefs.groqApiKey, ...apiKeys.filter(k => k !== prefs.groqApiKey)];
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
 - READ simple filtering on the current table: Return WHERE clause ONLY (e.g. name = 'x' AND status = 1). DO NOT output JSON {"name":"x"}!
 - READ full-query intents: If the user asks for SHOW, DESCRIBE, DESC, EXPLAIN, joins, aggregates, grouping, ordering, limits, other tables, or explicitly asks for a full SELECT, return the FULL SQL statement.
 - For semantic requests, infer logic from the schema and sample data. Example: if the user asks for weak passwords, DO NOT just search for the literal string "weak". Instead, write logic checking password length (< 8), common bad passwords (IN ('123456', 'password')), or where password = username.
 - ACTION: Return FULL SQL statement (DELETE FROM..., UPDATE..., INSERT..., CREATE..., ALTER..., DROP...).
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
    let successfulApiKey = null;

    for (const currentModel of modelsToTry) {
        if (currentModel === 'manual') {
            try {
              const result = await requestChatCompletion({
                modelName: 'manual',
                messages: [
                { role: 'system', content: systemPrompt },
                ...historyMessages,
                { role: 'user', content: prompt }
                ],
                aiConfig,
                prefs
              });
              answer = result.content;
              successfulIndex = 999;
              actualUsedModel = result.usedModel;
              successfulApiKey = null;
              break;
            } catch (err) {
                lastError = err;
            }
            break;
        }

        for (let i = 0; i < apiKeys.length; i++) {
            const tryIndex = (currentIndex + i) % apiKeys.length;
            const apiKey = apiKeys[tryIndex];

            try {
              const result = await requestChatCompletion({
                modelName: currentModel,
                messages: [
                { role: 'system', content: systemPrompt },
                ...historyMessages,
                { role: 'user', content: prompt }
                ],
                aiConfig,
                apiKey,
                prefs
              });
              answer = result.content;
              successfulIndex = tryIndex;
              actualUsedModel = result.usedModel;
              successfulApiKey = apiKey;
              break;
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
             ).catch(err => logger.error('Failed to update query key index:', err));
        }
        
        let finalAnswer = answer || '';
        if (provider !== 'mongodb') {
          let cleanedQuery = stripAiQueryEnvelope(finalAnswer);
          if (!sqlQueryLooksUsable(cleanedQuery)) {
            try {
              const repairResult = await requestChatCompletion({
                modelName: mainModel === 'manual' ? 'manual' : actualUsedModel,
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: buildSqlRepairPrompt({ prompt, schemaName, sampleData, previousAnswer: finalAnswer }) }
                ],
                aiConfig,
                apiKey: successfulApiKey,
                prefs
              });
              if (repairResult?.content) {
                finalAnswer = repairResult.content;
                cleanedQuery = stripAiQueryEnvelope(finalAnswer);
              }
            } catch (repairError) {
              logger.warn('AI SQL repair pass failed:', repairError.message);
            }

            if (!sqlQueryLooksUsable(cleanedQuery)) {
              const heuristicQuery = buildSqlHeuristicQuery({ prompt, sampleData, schemaName });
              if (heuristicQuery) {
                finalAnswer = `<thought>Heuristic SQL fallback from user intent.</thought><query>${heuristicQuery}</query>`;
              }
            }
          }
        }

        // Force an error if AI completely failed to generate any SQL (returns empty string)
        if (!finalAnswer || finalAnswer.trim() === '') {
           return NextResponse.json({ success: false, error: 'The AI model generated an empty response. Please check your prompt or API token.' }, { status: 400 });
        }

        let usageInfo = null;
        if (session) {
          usageInfo = await checkAndTrackAiUsage(session.user.email, prompt, finalAnswer);

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
                { role: 'assistant', content: finalAnswer || '(no response)', metadata: { usedModel: actualUsedModel }, timestamp: new Date() }
              ]
            });
          } catch (dbErr) {
            logger.error('Failed to save DB AI history:', dbErr);
          }
        }
        return NextResponse.json({ success: true, query: finalAnswer, usage: usageInfo, usedModel: actualUsedModel });
    }

    return NextResponse.json({ success: false, error: lastError?.message || 'AI Rate limit exceeded on all keys.' }, { status: 429 });

  } catch (error) {
    logger.error('AI Query Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
