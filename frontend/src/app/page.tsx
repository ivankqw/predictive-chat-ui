'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Copy,
  Download,
  FileText,
  ListChecks,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Table2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatIcsDate } from '@/lib/ics';
import { recentChatHistory } from '@/lib/chatHistory';
import { createDecisionLifecycle, type DecisionLifecycle } from '@/lib/decisionLifecycle';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface StoredMessage extends Message {
  id: string;
  failed?: boolean;
}

export type ToolKind = 'calendar' | 'checklist' | 'compare' | 'draft_message';
type Intent = ToolKind | 'none';

const toolMeta: Record<ToolKind, { label: string; icon: typeof CalendarDays; description: string }> = {
  calendar: { label: 'Event draft', icon: CalendarDays, description: 'Edit the details, then download an .ics file.' },
  checklist: { label: 'Checklist', icon: ListChecks, description: 'Turn the thought into an editable list.' },
  compare: { label: 'Comparison', icon: Table2, description: 'Set up a table for the options and facts.' },
  draft_message: { label: 'Message draft', icon: FileText, description: 'Write and copy a message without sending it.' },
};

const intentLabels: Record<Intent, string> = { calendar: 'Event draft', checklist: 'Checklist', compare: 'Comparison', draft_message: 'Message draft', none: 'No tool' };
const scoreKeys: ToolKind[] = ['calendar', 'checklist', 'compare', 'draft_message'];

interface DecisionResponse {
  request_id: number;
  intent: Intent;
  scores: Record<Intent, number>;
  provider: string;
  model: string;
  decision_ms: number;
  abstained: boolean;
}

interface CalendarDraft { source: string; title: string; date: string; startTime: string; endTime: string; location: string; description: string }
interface ChecklistTask { id: number; text: string; done: boolean }
interface CompareDraft { options: string[]; criteria: string[]; cells: string[][] }
interface MessageDraft { source: string; recipient: string; subject: string; body: string }
interface ChatStatus { available: boolean; provider: string; model: string }

const emptyCalendar = (source = ''): CalendarDraft => ({ source, title: '', date: '', startTime: '', endTime: '', location: '', description: '' });
const emptyMessage = (source = ''): MessageDraft => ({ source, recipient: '', subject: '', body: '' });

function isIntent(value: unknown): value is Intent {
  return value === 'calendar' || value === 'checklist' || value === 'compare' || value === 'draft_message' || value === 'none';
}

function parseDecision(value: unknown, requestId: number): DecisionResponse {
  if (!value || typeof value !== 'object') throw new Error('Prediction response was not an object.');
  const candidate = value as Record<string, unknown>;
  if (candidate.request_id !== requestId || !isIntent(candidate.intent)) throw new Error('Prediction did not match the current draft.');
  if (typeof candidate.provider !== 'string' || typeof candidate.model !== 'string' || typeof candidate.decision_ms !== 'number' || typeof candidate.abstained !== 'boolean') throw new Error('Prediction response is missing runtime details.');
  if (!candidate.scores || typeof candidate.scores !== 'object') throw new Error('Prediction response is missing scores.');
  const incomingScores = candidate.scores as Record<string, unknown>;
  const scores = {} as Record<Intent, number>;
  for (const key of scoreKeys) {
    if (typeof incomingScores[key] !== 'number' || !Number.isFinite(incomingScores[key])) throw new Error('Prediction response contains invalid scores.');
    scores[key] = incomingScores[key] as number;
  }
  scores.none = typeof incomingScores.none === 'number' && Number.isFinite(incomingScores.none) ? incomingScores.none : 0;
  return { request_id: requestId, intent: candidate.intent, scores, provider: candidate.provider, model: candidate.model, decision_ms: candidate.decision_ms, abstained: candidate.abstained };
}

function escapeIcsText(value: string) {
  return value.replaceAll('\\', '\\\\').replace(/\r?\n/g, '\\n').replaceAll(';', '\\;').replaceAll(',', '\\,');
}

function validateCalendar(draft: CalendarDraft) {
  if (!draft.title.trim() || !draft.date || !draft.startTime || !draft.endTime) return 'Add a title, date, start time, and end time.';
  if (draft.endTime <= draft.startTime) return 'End time must be after start time.';
  return '';
}

function downloadCalendar(draft: CalendarDraft) {
  const validationError = validateCalendar(draft);
  if (validationError) throw new Error(validationError);
  const now = new Date();
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Predictive Workspace//EN', 'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}@predictive-workspace`,
    `DTSTAMP:${formatIcsDate(now.toISOString().slice(0, 10), now.toISOString().slice(11, 16))}Z`,
    `DTSTART:${formatIcsDate(draft.date, draft.startTime)}`,
    `DTEND:${formatIcsDate(draft.date, draft.endTime)}`,
    `SUMMARY:${escapeIcsText(draft.title.trim())}`,
    ...(draft.location ? [`LOCATION:${escapeIcsText(draft.location.trim())}`] : []),
    ...(draft.description ? [`DESCRIPTION:${escapeIcsText(draft.description.trim())}`] : []),
    'END:VEVENT', 'END:VCALENDAR',
  ];
  const blob = new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${draft.title.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'event'}.ics`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function useCopy() {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copy = useCallback(async (text: string) => {
    setCopied(false);
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
      return true;
    } catch {
      try {
        const fallback = document.createElement('textarea');
        fallback.value = text;
        fallback.style.position = 'fixed';
        fallback.style.opacity = '0';
        document.body.appendChild(fallback);
        fallback.select();
        const copiedWithFallback = document.execCommand('copy');
        fallback.remove();
        setCopied(copiedWithFallback);
        setCopyError(!copiedWithFallback);
        if (copiedWithFallback) window.setTimeout(() => setCopied(false), 1600);
        return copiedWithFallback;
      } catch {
        setCopyError(true);
        return false;
      }
    }
  }, []);
  return { copied, copyError, copy };
}

function Field({ label, value, onChange, placeholder, multiline = false, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; multiline?: boolean; type?: string }) {
  return <label className="field"><span>{label}</span>{multiline ? <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={4} /> : <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />}</label>;
}

function ToolPanel({ tool, source, calendar, setCalendar, checklist, setChecklist, compare, setCompare, message, setMessage, onClose }: { tool: ToolKind; source: string; calendar: CalendarDraft; setCalendar: React.Dispatch<React.SetStateAction<CalendarDraft>>; checklist: ChecklistTask[]; setChecklist: React.Dispatch<React.SetStateAction<ChecklistTask[]>>; compare: CompareDraft; setCompare: React.Dispatch<React.SetStateAction<CompareDraft>>; message: MessageDraft; setMessage: React.Dispatch<React.SetStateAction<MessageDraft>>; onClose: () => void }) {
  const copy = useCopy();
  const meta = toolMeta[tool];
  const Icon = meta.icon;
  const [copyNote, setCopyNote] = useState('');
  const [calendarNote, setCalendarNote] = useState('');
  const noteCopy = async (text: string) => {
    const copied = await copy.copy(text);
    setCopyNote(copied ? 'Copied' : 'Copy failed. Select the text and copy it manually.');
    window.setTimeout(() => setCopyNote(''), copied ? 1600 : 3000);
  };
  const handleCalendarDownload = () => {
    try { downloadCalendar(calendar); setCalendarNote('Download started. Import the file into your calendar when ready.'); }
    catch (error) { setCalendarNote(error instanceof Error ? error.message : 'Check the event details and try again.'); }
  };
  const checklistText = checklist.map((task) => `${task.done ? '[x]' : '[ ]'} ${task.text}`).join('\n');
  const comparisonText = [['', ...compare.options].join(' | '), ...compare.criteria.map((criterion, row) => [criterion, ...compare.options.map((_, column) => compare.cells[row]?.[column] || '')].join(' | '))].join('\n');
  return <section className="tool-panel" aria-label={`${meta.label} tool`}>
    <div className="tool-heading"><div className="tool-title-wrap"><span className="tool-icon"><Icon size={18} strokeWidth={1.8} /></span><div><h2>{meta.label}</h2></div></div><button type="button" className="icon-button" onClick={onClose} aria-label={`Close ${meta.label} tool`}><X size={18} /></button></div>
    {source && <p className="source-draft"><span>From your draft</span>{source}</p>}
    {tool === 'calendar' && <div className="tool-content"><p className="tool-intro">Edit the file here. Nothing is added to a calendar automatically.</p><div className="field-grid two-up"><Field label="Title" value={calendar.title} onChange={(title) => setCalendar((current) => ({ ...current, title }))} placeholder="Team offsite" /><Field label="Date" value={calendar.date} onChange={(date) => setCalendar((current) => ({ ...current, date }))} placeholder="YYYY-MM-DD" type="date" /><Field label="Starts" value={calendar.startTime} onChange={(startTime) => setCalendar((current) => ({ ...current, startTime }))} placeholder="09:00" type="time" /><Field label="Ends" value={calendar.endTime} onChange={(endTime) => setCalendar((current) => ({ ...current, endTime }))} placeholder="10:00" type="time" /></div><Field label="Location (optional)" value={calendar.location} onChange={(location) => setCalendar((current) => ({ ...current, location }))} placeholder="Add a place or link" /><Field label="Notes (optional)" value={calendar.description} onChange={(description) => setCalendar((current) => ({ ...current, description }))} placeholder="Add context for the event" multiline /><p className="action-note" role="status">{validateCalendar(calendar)}</p><div className="tool-actions"><button type="button" className="button primary" disabled={Boolean(validateCalendar(calendar))} onClick={handleCalendarDownload}><Download size={16} /> Download .ics</button>{calendarNote && <span className={cn('action-note', calendarNote.startsWith('Download') ? 'action-success' : 'action-error')} role="status">{calendarNote}</span>}</div></div>}
    {tool === 'checklist' && <div className="tool-content"><p className="tool-intro">Edit the list, then copy it into another app.</p><div className="task-list">{checklist.map((task, index) => <div className={cn('task-row', task.done && 'is-done')} key={task.id}><button type="button" className="check-button" onClick={() => setChecklist((current) => current.map((item) => item.id === task.id ? { ...item, done: !item.done } : item))} aria-label={task.done ? `Mark task ${index + 1} open` : `Mark task ${index + 1} complete`}><Check size={15} /></button><input aria-label={`Task ${index + 1}`} value={task.text} onChange={(event) => setChecklist((current) => current.map((item) => item.id === task.id ? { ...item, text: event.target.value } : item))} placeholder="Add a task" /><button type="button" className="icon-button subtle" onClick={() => setChecklist((current) => current.filter((item) => item.id !== task.id))} aria-label={`Remove task ${index + 1}`}><Minus size={16} /></button></div>)}</div><button type="button" className="button quiet" onClick={() => setChecklist((current) => [...current, { id: Math.max(0, ...current.map((item) => item.id)) + 1, text: '', done: false }])}><Plus size={16} /> Add task</button><div className="tool-actions"><button type="button" className="button secondary" disabled={!checklist.some((task) => task.text.trim())} onClick={() => { void noteCopy(checklistText); }}><Copy size={16} /> {copy.copied ? 'Copied' : 'Copy checklist'}</button>{copyNote && <span className={cn('action-note', copy.copyError && 'action-error')} role="status">{copyNote}</span>}</div></div>}
    {tool === 'compare' && <div className="tool-content"><p className="tool-intro">Add the facts you want to compare. The table stays in this browser.</p><div className="comparison-wrap"><table className="comparison-table"><thead><tr><th scope="col">Criteria</th>{compare.options.map((option, column) => <th scope="col" key={column}><input aria-label={`Option ${column + 1}`} value={option} onChange={(event) => setCompare((current) => ({ ...current, options: current.options.map((item, index) => index === column ? event.target.value : item) }))} placeholder={`Option ${column + 1}`} /></th>)}</tr></thead><tbody>{compare.criteria.map((criterion, row) => <tr key={row}><th scope="row"><input aria-label={`Criterion ${row + 1}`} value={criterion} onChange={(event) => setCompare((current) => ({ ...current, criteria: current.criteria.map((item, index) => index === row ? event.target.value : item) }))} placeholder={`Criterion ${row + 1}`} /></th>{compare.options.map((_, column) => <td key={column}><input aria-label={`${criterion || `Criterion ${row + 1}`} for ${compare.options[column] || `Option ${column + 1}`}`} value={compare.cells[row]?.[column] || ''} onChange={(event) => setCompare((current) => ({ ...current, cells: current.cells.map((cells, rowIndex) => rowIndex === row ? cells.map((cell, columnIndex) => columnIndex === column ? event.target.value : cell) : cells) }))} placeholder="Add fact" /></td>)}</tr>)}</tbody></table></div><div className="tool-actions split-actions"><div><button type="button" className="button quiet" onClick={() => setCompare((current) => ({ ...current, criteria: [...current.criteria, ''], cells: [...current.cells, current.options.map(() => '')] }))}><Plus size={16} /> Add criterion</button><button type="button" className="button quiet" onClick={() => setCompare((current) => ({ ...current, options: [...current.options, ''], cells: current.cells.map((cells) => [...cells, '']) }))}><Plus size={16} /> Add option</button></div><button type="button" className="button secondary" onClick={() => { void noteCopy(comparisonText); }}><Copy size={16} /> {copy.copied ? 'Copied' : 'Copy table'}</button></div>{copyNote && <p className={cn('action-note', 'copy-note', copy.copyError && 'action-error')} role="status">{copyNote}</p>}</div>}
    {tool === 'draft_message' && <div className="tool-content"><p className="tool-intro">Draft locally and copy when it sounds right. Sending stays in your hands.</p><Field label="Recipient" value={message.recipient} onChange={(recipient) => setMessage((current) => ({ ...current, recipient }))} placeholder="Name or address" /><Field label="Subject" value={message.subject} onChange={(subject) => setMessage((current) => ({ ...current, subject }))} placeholder="What is this about?" /><Field label="Body" value={message.body} onChange={(body) => setMessage((current) => ({ ...current, body }))} placeholder="Write your message" multiline /><div className="tool-actions"><button type="button" className="button secondary" disabled={!message.body.trim()} onClick={() => { void noteCopy(`To: ${message.recipient}\nSubject: ${message.subject}\n\n${message.body}`); }}><Copy size={16} /> {copy.copied ? 'Copied' : 'Copy draft'}</button>{copyNote && <span className={cn('action-note', copy.copyError && 'action-error')} role="status">{copyNote}</span>}</div></div>}
  </section>;
}

function ToolPicker({ onSelect }: { onSelect: (tool: ToolKind) => void }) {
  return <div className="tool-picker" id="local-tools" aria-label="Choose a local tool"><div className="tool-picker-heading"><span>Local tools</span><small>Choose one if the suggestion is not what you need.</small></div><div className="tool-picker-grid">{scoreKeys.map((tool) => { const Icon = toolMeta[tool].icon; return <button type="button" className="tool-choice" key={tool} onClick={() => onSelect(tool)}><span className="tool-choice-icon"><Icon size={16} /></span><span><strong>{toolMeta[tool].label}</strong><small>{toolMeta[tool].description}</small></span><ArrowUpRight size={14} /></button>; })}</div></div>;
}

export default function Home() {
  const [draft, setDraft] = useState('');
  const [prediction, setPrediction] = useState<DecisionResponse | null>(null);
  const [decisionState, setDecisionState] = useState<'idle' | 'loading' | 'ready' | 'error' | 'disabled'>('idle');
  const [decisionError, setDecisionError] = useState('');
  const [predictionEnabled, setPredictionEnabled] = useState(true);
  const [activeTool, setActiveTool] = useState<ToolKind | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolSources, setToolSources] = useState<Partial<Record<ToolKind, string>>>({});
  const [dismissedSuggestion, setDismissedSuggestion] = useState('');
  const [roundtripMs, setRoundtripMs] = useState<number | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([{ id: 'welcome', role: 'assistant', content: 'What would you like to work on?' }]);
  const [chatBusy, setChatBusy] = useState(false);
  const [pendingMessage, setPendingMessage] = useState('');
  const [statusRetry, setStatusRetry] = useState(0);
  const [chatError, setChatError] = useState('');
  const [chatStatus, setChatStatus] = useState<ChatStatus | null>(null);
  const [chatStatusState, setChatStatusState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [calendar, setCalendar] = useState<CalendarDraft>(() => emptyCalendar());
  const [checklist, setChecklist] = useState<ChecklistTask[]>([{ id: 1, text: '', done: false }]);
  const [compare, setCompare] = useState<CompareDraft>({ options: ['', ''], criteria: ['', ''], cells: [['', ''], ['', '']] });
  const [message, setMessage] = useState<MessageDraft>(() => emptyMessage());
  const lifecycleRef = useRef<DecisionLifecycle | null>(null);
  if (!lifecycleRef.current) lifecycleRef.current = createDecisionLifecycle();
  const composingRef = useRef(false);
  const [compositionTick, setCompositionTick] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const cancelDecision = useCallback(() => lifecycleRef.current?.invalidate(), []);

  useEffect(() => {
    let cancelled = false;
    const loadChatStatus = async () => {
      setChatStatusState('loading');
      try {
        const response = await fetch('/api/chat', { cache: 'no-store' });
        if (!response.ok) throw new Error('Chat status could not be checked.');
        const data = await response.json() as Partial<ChatStatus>;
        if (cancelled) return;
        if (typeof data.available !== 'boolean' || typeof data.provider !== 'string' || typeof data.model !== 'string') throw new Error('Chat status response was incomplete.');
        setChatStatus({ available: data.available, provider: data.provider, model: data.model });
        setChatStatusState('ready');
      } catch {
        if (!cancelled) setChatStatusState('error');
      }
    };
    void loadChatStatus();
    return () => { cancelled = true; };
  }, [statusRetry]);

  useEffect(() => {
    if (composingRef.current) return;
    const text = draft.trim();
    const lifecycle = lifecycleRef.current;
    if (!lifecycle) return;
    const request = lifecycle.begin();
    const { requestId, controller } = request;
    setPrediction(null);
    if (!predictionEnabled) {
      setDecisionState('disabled');
      setDecisionError('');
      return;
    }
    if (!text) {
      setDecisionState('idle');
      setDecisionError('');
      setRoundtripMs(null);
      return;
    }
    setDecisionState('loading');
    setDecisionError('');
    const attemptDecision = async (attempt: number) => {
      if (!lifecycle.isCurrent(requestId) || !predictionEnabled) return;
      const startedAt = performance.now();
      try {
        const response = await fetch('/api/decision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, request_id: requestId }), signal: controller.signal });
        if (response.status === 429 && attempt < 3) {
          lifecycle.schedule(requestId, () => { void attemptDecision(attempt + 1); }, 1000 * (2 ** attempt));
          return;
        }
        if (!response.ok) throw new Error(response.status === 429 ? 'Prediction is busy after retries. Try again shortly.' : `Prediction service returned ${response.status}.`);
        const data = parseDecision(await response.json(), requestId);
        if (!lifecycle.isCurrent(requestId)) return;
        setPrediction(data);
        setRoundtripMs(Math.round(performance.now() - startedAt));
        setDecisionState('ready');
      } catch (error) {
        if (controller.signal.aborted || !lifecycle.isCurrent(requestId)) return;
        setDecisionState('error');
        setDecisionError(error instanceof Error ? error.message : 'Prediction service unavailable.');
        setPrediction(null);
        setRoundtripMs(null);
      }
    };
    lifecycle.schedule(requestId, () => { void attemptDecision(0); }, 250);
    return () => lifecycle.invalidate();
  }, [draft, predictionEnabled, compositionTick]);

  useEffect(() => {
    const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    messagesEndRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'end' });
  }, [messages, chatBusy]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const openTool = (tool: ToolKind, source = draft.trim()) => {
    cancelDecision();
    setActiveTool(tool);
    setToolsOpen(true);
    setDecisionState('idle');
    setToolSources((current) => current[tool] ? current : { ...current, [tool]: source });
    if (tool === 'calendar') setCalendar((current) => current.source ? current : emptyCalendar(source));
    if (tool === 'checklist' && checklist.every((task) => !task.text.trim())) {
      const colon = source.indexOf(':');
      const explicitItems = colon >= 0 ? source.slice(colon + 1).split(/[\n,;]/).map((item) => item.trim()).filter(Boolean) : [];
      if (explicitItems.length > 0) setChecklist(explicitItems.map((text, id) => ({ id: id + 1, text, done: false })));
    }
    if (tool === 'compare' && compare.options.every((option) => !option.trim())) {
      const match = source.match(/([^,.!?\n]+?)\s+(?:vs\.?|versus)\s+([^,.!?\n]+)/i);
      if (match) setCompare((current) => ({ ...current, options: [match[1].trim(), match[2].trim()] }));
    }
    if (tool === 'draft_message') setMessage((current) => current.source ? current : emptyMessage(source));
    setPrediction(null);
    setDismissedSuggestion('');
  };

  const dismissSuggestion = () => {
    cancelDecision();
    if (prediction) setDismissedSuggestion(`${prediction.request_id}:${prediction.intent}`);
    setPrediction(null);
    setDecisionState('idle');
  };

  const sendToChat = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || chatBusy || !chatStatus?.available) return;
    const nextMessages: StoredMessage[] = [...messages, { id: crypto.randomUUID(), role: 'user', content: text }];
    setChatBusy(true);
    setPendingMessage(text);
    setChatError('');
    cancelDecision();
    setPrediction(null);
    setDecisionState('idle');
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: recentChatHistory(nextMessages.filter((message) => !message.failed)) }), signal: AbortSignal.timeout(30000) });
      const data = await response.json() as { message?: string; error?: string };
      if (!response.ok || typeof data.message !== 'string' || !data.message.trim()) throw new Error(data.error || `Chat service returned ${response.status}.`);
      setMessages([...nextMessages, { id: crypto.randomUUID(), role: 'assistant', content: data.message }]);
      setDraft((current) => current.trim() === text ? '' : current);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'Chat is unavailable. Your draft is still here.');
      setMessages([...messages, { ...nextMessages[nextMessages.length - 1], failed: true }]);
    } finally {
      setChatBusy(false);
      setPendingMessage('');
    }
  };

  const suggestionVisible = Boolean(prediction && prediction.intent !== 'none' && !prediction.abstained && `${prediction.request_id}:${prediction.intent}` !== dismissedSuggestion);
  const topIntent = prediction && prediction.intent !== 'none' ? prediction.intent : null;
  const statusLabel = chatStatusState === 'loading' ? 'Checking assistant' : chatStatus?.available ? `${chatStatus.provider} ready` : chatStatusState === 'error' ? 'Assistant status unavailable' : 'Assistant not configured';

  return <main className="app-shell"><section className="chat-shell" aria-label="Vibes Chat">
    <header className="chat-header"><div className="brand"><span className="brand-mark"><Sparkles size={16} /></span><div><strong>Vibes Chat</strong><span>Local tools, one conversation</span></div></div><div className="header-actions"><span className={cn('service-status', chatStatus?.available && 'is-ready')}><span className="status-dot" />{statusLabel}</span><button type="button" className="header-button" onClick={() => { const next = !predictionEnabled; setPredictionEnabled(next); if (!next) cancelDecision(); }} aria-pressed={predictionEnabled}>{predictionEnabled ? 'Prediction on' : 'Prediction off'}</button></div></header>
    <div className="conversation" role="log" aria-live="polite" aria-label="Conversation"><div className="conversation-intro"><p>Start with a message. A local suggestion may appear while you write.</p></div><div className="message-list">{messages.map((item) => <article className={cn('message', item.role)} key={item.id}><span className="message-role">{item.failed ? 'You · No reply' : item.role === 'user' ? 'You' : 'Assistant'}</span><p>{item.content}</p></article>)}{pendingMessage && <article className="message user"><span className="message-role">You</span><p>{pendingMessage}</p></article>}{chatBusy && <article className="message assistant pending" aria-label="Assistant is responding"><span className="message-role">Assistant</span><span className="typing-indicator"><i /><i /><i /></span></article>}{chatError && <div className="chat-error" role="alert"><span>{chatError}</span><button type="button" className="retry-button" onClick={() => inputRef.current?.focus()}><RefreshCw size={13} /> Keep draft</button></div>}<div ref={messagesEndRef} /></div></div>
    <div className="composer-zone">{activeTool && <div className="drawer-wrap"><ToolPanel tool={activeTool} source={toolSources[activeTool] || ''} calendar={calendar} setCalendar={setCalendar} checklist={checklist} setChecklist={setChecklist} compare={compare} setCompare={setCompare} message={message} setMessage={setMessage} onClose={() => setActiveTool(null)} /></div>}{toolsOpen && !activeTool && <ToolPicker onSelect={(tool) => openTool(tool)} />}
      <div className="suggestion-line" aria-live="polite">{suggestionVisible && prediction && topIntent ? <div className="suggestion"><span className="suggestion-icon"><Sparkles size={15} /></span><div className="suggestion-copy"><strong>{intentLabels[topIntent]} suggested</strong><span>{toolMeta[topIntent].description}</span></div><button type="button" className="suggestion-action" onClick={() => openTool(topIntent)}>Open <ArrowUpRight size={14} /></button><button type="button" className="suggestion-dismiss" onClick={dismissSuggestion} aria-label="Dismiss tool suggestion"><X size={15} /></button></div> : decisionState === 'loading' && draft.trim() ? <div className="prediction-note"><LoaderCircle size={13} className="spin" /> Finding a useful local tool…</div> : decisionState === 'error' && draft.trim() ? <div className="prediction-note error" role="status"><span>Local suggestion unavailable. {decisionError || 'You can still use Tools.'}</span><button type="button" onClick={() => setToolsOpen(true)}>Open tools</button></div> : prediction && (prediction.intent === 'none' || prediction.abstained) ? <div className="prediction-note"><span>{prediction.abstained ? 'No clear local tool for this draft.' : 'No local tool suggested.'}</span><button type="button" onClick={() => setToolsOpen(true)}>Browse tools</button></div> : null}</div>
      <form className="composer" onSubmit={sendToChat}><div className="composer-topline"><label htmlFor="message-draft">Message</label><span>{draft.length ? `${draft.length}/600` : 'Shift + Enter for a new line'}</span></div><textarea id="message-draft" ref={inputRef} value={draft} maxLength={600} onChange={(event) => setDraft(event.target.value)} onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; setCompositionTick((tick) => tick + 1); }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !composingRef.current) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Type a message…" rows={1} aria-describedby="composer-help" /><div className="composer-bottom"><span id="composer-help" className="composer-help">Prediction stays local. Sending shares recent messages with {chatStatus?.provider || 'the assistant provider'}.</span><div className="composer-controls"><button type="button" className="tools-button" onClick={() => { setToolsOpen((open) => !open); if (activeTool) setActiveTool(null); }} aria-expanded={toolsOpen}>{toolsOpen ? 'Hide tools' : 'Tools'}<span className="tool-count">4</span></button><button type="submit" className="send-button" disabled={!draft.trim() || chatBusy || chatStatusState !== 'ready' || !chatStatus?.available}>{chatBusy ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}<span>{chatBusy ? 'Sending…' : 'Send'}</span></button></div></div></form>
      {chatStatusState === 'ready' && !chatStatus?.available && <p className="configuration-note" role="status">Assistant is not configured. Set <code>OPENAI_API_KEY</code> on the server and restart. Local tools remain available.</p>}{chatStatusState === 'error' && <p className="configuration-note" role="status">Assistant status could not be checked. <button type="button" onClick={() => setStatusRetry((current) => current + 1)}>Try again</button></p>}
      <footer className="chat-footer"><span>Local tools stay in this browser</span>{prediction && <details><summary>Prediction details</summary><span>{prediction.provider} · {prediction.model} · {roundtripMs === null ? '—' : `${roundtripMs} ms`}</span></details>}</footer>
    </div>
  </section></main>;
}
