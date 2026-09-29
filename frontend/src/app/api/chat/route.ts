const MAX_MESSAGES = 40;
const MAX_CONTENT = 6000;
const MAX_TOTAL = 24000;
const model = () => process.env.CHAT_MODEL || 'gpt-4.1-mini';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

function parseMessages(body: unknown): ChatMessage[] | null {
  if (!body || typeof body !== 'object' || !('messages' in body)) return null;
  const messages = body.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) return null;
  let total = 0;
  for (const message of messages) {
    if (!message || (message.role !== 'user' && message.role !== 'assistant') ||
        typeof message.content !== 'string' || !message.content.trim() || message.content.length > MAX_CONTENT) return null;
    total += message.content.length;
  }
  if (total > MAX_TOTAL || messages.at(-1)?.role !== 'user') return null;
  return messages.map(({ role, content }) => ({ role, content }));
}

export async function GET() {
  return Response.json({ available: Boolean(process.env.OPENAI_API_KEY), provider: 'OpenAI', model: model() });
}

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: 'Chat is not configured. Set OPENAI_API_KEY on the server, then restart. Local tools still work.' }, { status: 503 });
  }
  let messages: ChatMessage[] | null;
  try {
    messages = parseMessages(await request.json());
  } catch {
    return Response.json({ error: 'The chat request is not valid JSON.' }, { status: 400 });
  }
  if (!messages) {
    return Response.json({ error: 'Use a conversation of up to 40 messages and 24,000 characters, ending with your message.' }, { status: 400 });
  }
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: model(),
        messages: [{ role: 'system', content: 'You are the assistant in Vibes Chat. Be concise and useful. Editable local tools can appear beside the conversation, but you cannot access or modify their fields. Do not claim to have sent messages, saved calendar events, searched the web, or executed any action. Help with writing, planning, and comparisons; identify missing facts instead of inventing them.' }, ...messages],
        max_completion_tokens: 700,
        store: false,
      }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
      cache: 'no-store',
    });
    if (!response.ok) {
      return Response.json({ error: response.status === 429 ? 'The chat provider is busy or its quota is exhausted. Try again later; your draft is kept.' : 'The chat provider could not answer. Check the server model and API key, then retry.' }, { status: response.status === 429 ? 429 : 502 });
    }
    const data = await response.json();
    const message = data.choices?.[0]?.message?.content;
    if (typeof message !== 'string' || !message.trim()) {
      return Response.json({ error: 'The assistant returned an empty reply. Your draft is kept; try again.' }, { status: 502 });
    }
    return Response.json({ message });
  } catch {
    return Response.json({ error: 'The chat request timed out or disconnected. Your draft is kept; try again.' }, { status: 503 });
  }
}
