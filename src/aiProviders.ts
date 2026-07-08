/**
 * Multi-provider AI support: OpenAI, Anthropic, and Google Gemini.
 *
 * All providers are called through plain fetch (no SDK dependencies) and
 * exposed through two functions:
 *   - fetchAvailableModels(): pulls the current model list from the provider
 *   - chatCompletion(): unified single-turn completion with optional JSON schema output
 */

export type AIProvider = 'openai' | 'anthropic' | 'gemini';

export interface ProviderMeta {
    label: string;
    keySecret: string;      // key name in VS Code secret storage
    modelStateKey: string;  // key name in globalState for the selected model
    defaultModel: string;
    fallbackModels: string[]; // shown before a live model list has been fetched
    keyPlaceholder: string;
}

export const AI_PROVIDERS: Record<AIProvider, ProviderMeta> = {
    openai: {
        label: 'OpenAI',
        keySecret: 'openaiApiKey',
        modelStateKey: 'openaiModel',
        defaultModel: 'gpt-5.4-mini',
        fallbackModels: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'],
        keyPlaceholder: 'sk-...'
    },
    anthropic: {
        label: 'Anthropic',
        keySecret: 'anthropicApiKey',
        modelStateKey: 'anthropicModel',
        defaultModel: 'claude-opus-4-8',
        fallbackModels: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
        keyPlaceholder: 'sk-ant-...'
    },
    gemini: {
        label: 'Google Gemini',
        keySecret: 'geminiApiKey',
        modelStateKey: 'geminiModel',
        defaultModel: 'gemini-2.5-flash',
        fallbackModels: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
        keyPlaceholder: 'AIza...'
    }
};

export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AIProvider[];

export function isAIProvider(value: any): value is AIProvider {
    return typeof value === 'string' && value in AI_PROVIDERS;
}

export interface ChatRequest {
    system?: string;
    prompt: string;
    /** JSON Schema the response must conform to. When set, the returned string is JSON. */
    schema?: any;
    /** Name for the schema (used by OpenAI's response_format). */
    schemaName?: string;
    /** Sampling temperature; applied only where the provider supports it. */
    temperature?: number;
}

/**
 * Fetch the list of currently available chat-capable models from a provider,
 * newest first where the API exposes ordering.
 */
export async function fetchAvailableModels(provider: AIProvider, apiKey: string): Promise<string[]> {
    const key = apiKey.trim();
    switch (provider) {
        case 'openai':
            return fetchOpenAIModels(key);
        case 'anthropic':
            return fetchAnthropicModels(key);
        case 'gemini':
            return fetchGeminiModels(key);
    }
}

/**
 * Run a single-turn chat completion and return the text content of the response.
 */
export async function chatCompletion(provider: AIProvider, apiKey: string, model: string, request: ChatRequest): Promise<string> {
    const key = apiKey.trim();
    switch (provider) {
        case 'openai':
            return openaiChatCompletion(key, model, request);
        case 'anthropic':
            return anthropicChatCompletion(key, model, request);
        case 'gemini':
            return geminiChatCompletion(key, model, request);
    }
}

async function throwApiError(providerLabel: string, response: Response): Promise<never> {
    const errorText = await response.text();
    throw new Error(`${providerLabel} API error: ${response.status} - ${errorText.substring(0, 500)}`);
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

// Model families that are not usable for chat completions
const OPENAI_EXCLUDE = /embedding|tts|whisper|dall-e|audio|realtime|image|moderation|transcribe|search|instruct|davinci|babbage|computer-use/;

async function fetchOpenAIModels(apiKey: string): Promise<string[]> {
    const response = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (!response.ok) {
        await throwApiError('OpenAI', response);
    }
    const data: any = await response.json();
    const models: { id: string; created: number }[] = (data.data || [])
        .filter((m: any) => typeof m.id === 'string' &&
            /^(gpt-|chatgpt-|o\d)/.test(m.id) &&
            !OPENAI_EXCLUDE.test(m.id))
        .map((m: any) => ({ id: m.id, created: m.created || 0 }));
    models.sort((a, b) => b.created - a.created);
    return models.map(m => m.id);
}

async function openaiChatCompletion(apiKey: string, model: string, request: ChatRequest): Promise<string> {
    const body: any = {
        model,
        messages: [] as any[]
    };
    if (request.system) {
        body.messages.push({ role: 'system', content: request.system });
    }
    body.messages.push({ role: 'user', content: request.prompt });
    if (request.temperature !== undefined) {
        body.temperature = request.temperature;
    }
    if (request.schema) {
        body.response_format = {
            type: 'json_schema',
            json_schema: {
                name: request.schemaName || 'response',
                strict: true,
                schema: request.schema
            }
        };
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        await throwApiError('OpenAI', response);
    }
    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
        throw new Error('OpenAI API returned no text content');
    }
    return content;
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

const ANTHROPIC_VERSION = '2023-06-01';

async function fetchAnthropicModels(apiKey: string): Promise<string[]> {
    // The Models API returns newest models first
    const response = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION
        }
    });
    if (!response.ok) {
        await throwApiError('Anthropic', response);
    }
    const data: any = await response.json();
    return (data.data || [])
        .map((m: any) => m.id)
        .filter((id: any) => typeof id === 'string');
}

async function anthropicChatCompletion(apiKey: string, model: string, request: ChatRequest): Promise<string> {
    const body: any = {
        model,
        max_tokens: 8192,
        messages: [{ role: 'user', content: request.prompt }]
    };
    if (request.system) {
        body.system = request.system;
    }
    // Note: temperature is intentionally not sent — current Anthropic models
    // reject sampling parameters.
    if (request.schema) {
        body.output_config = {
            format: {
                type: 'json_schema',
                schema: request.schema
            }
        };
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION
        },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        await throwApiError('Anthropic', response);
    }
    const data: any = await response.json();
    if (data.stop_reason === 'refusal') {
        throw new Error('Anthropic declined to answer this request (stop_reason: refusal)');
    }
    const text = (data.content || [])
        .filter((block: any) => block.type === 'text' && typeof block.text === 'string')
        .map((block: any) => block.text)
        .join('');
    if (!text) {
        throw new Error('Anthropic API returned no text content');
    }
    return text;
}

// ---------------------------------------------------------------------------
// Google Gemini
// ---------------------------------------------------------------------------

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function fetchGeminiModels(apiKey: string): Promise<string[]> {
    const response = await fetch(`${GEMINI_BASE}/models?pageSize=1000`, {
        headers: { 'x-goog-api-key': apiKey }
    });
    if (!response.ok) {
        await throwApiError('Gemini', response);
    }
    const data: any = await response.json();
    return (data.models || [])
        .filter((m: any) => Array.isArray(m.supportedGenerationMethods) &&
            m.supportedGenerationMethods.includes('generateContent') &&
            typeof m.name === 'string' &&
            m.name.includes('gemini') &&
            !/embedding/.test(m.name))
        .map((m: any) => m.name.replace(/^models\//, ''));
}

async function geminiChatCompletion(apiKey: string, model: string, request: ChatRequest): Promise<string> {
    let system = request.system || '';
    const generationConfig: any = {};
    if (request.temperature !== undefined) {
        // Gemini accepts temperatures in [0, 2]
        generationConfig.temperature = Math.max(0, Math.min(2, request.temperature));
    }
    if (request.schema) {
        // responseMimeType forces JSON output on every Gemini model; the schema
        // itself goes into the system instruction for broad model compatibility
        // (structured responseSchema support varies across model generations).
        generationConfig.responseMimeType = 'application/json';
        system += `${system ? '\n\n' : ''}Your entire response must be a single JSON value that validates against this JSON Schema:\n${JSON.stringify(request.schema)}`;
    }

    const body: any = {
        contents: [{ role: 'user', parts: [{ text: request.prompt }] }]
    };
    if (system) {
        body.systemInstruction = { parts: [{ text: system }] };
    }
    if (Object.keys(generationConfig).length > 0) {
        body.generationConfig = generationConfig;
    }

    const response = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
        },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        await throwApiError('Gemini', response);
    }
    const data: any = await response.json();
    if (data.promptFeedback?.blockReason) {
        throw new Error(`Gemini blocked the request: ${data.promptFeedback.blockReason}`);
    }
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts
        .filter((p: any) => typeof p.text === 'string')
        .map((p: any) => p.text)
        .join('');
    if (!text) {
        throw new Error('Gemini API returned no text content');
    }
    return text;
}
