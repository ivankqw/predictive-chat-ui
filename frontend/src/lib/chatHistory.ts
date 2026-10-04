export interface ChatMessage { role: 'user' | 'assistant'; content: string }

// Keep the newest contiguous context within the chat route's request limits.
export function recentChatHistory(messages: ChatMessage[]): ChatMessage[] {
  const recent: ChatMessage[] = [];
  let total = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (recent.length === 40 || total + message.content.length > 24000 || message.content.length > 6000) break;
    recent.unshift({ role: message.role, content: message.content });
    total += message.content.length;
  }
  return recent;
}
