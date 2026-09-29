'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckSquare2,
  Copy,
  Download,
  FileText,
  ListChecks,
  LoaderCircle,
  Minus,
  Plus,
  Send,
  Sparkles,
  Table2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatIcsDate } from '@/lib/ics';
import { createDecisionLifecycle, type DecisionLifecycle } from '@/lib/decisionLifecycle';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export type ToolKind = 'calendar' | 'checklist' | 'compare' | 'draft_message';
type Intent = ToolKind | 'none';

const toolMeta: Record<ToolKind, { label: string; icon: typeof CalendarDays; description: string }> = {
  calendar: {
    label: 'Event draft',
    icon: CalendarDays,
    description: 'Shape the details, then download an .ics file when you are ready.',
  },
  checklist: {
    label: 'Checklist',
    icon: ListChecks,
    description: 'Turn the thought into a small, editable list you can copy.',
  },
  compare: {
    label: 'Comparison',
    icon: Table2,
    description: 'Set up a neutral table for your own options and criteria.',
  },
  draft_message: {
    label: 'Message draft',
    icon: FileText,
    description: 'Write and copy a message without sending anything.',
  },
};

const intentLabels: Record<Intent, string> = {
  calendar: 'Event draft',
  checklist: 'Checklist',
  compare: 'Comparison',
  draft_message: 'Message draft',
  none: 'No tool',
};

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

interface CalendarDraft {
  source: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
}

interface ChecklistTask {
  id: number;
  text: string;
  done: boolean;
}

interface CompareDraft {
  options: string[];
  criteria: string[];
  cells: string[][];
}

interface MessageDraft {
  source: string;
  recipient: string;
  subject: string;
  body: string;
}

const emptyCalendar = (source = ''): CalendarDraft => ({ source, title: '', date: '', startTime: '', endTime: '', location: '', description: '' });
const emptyMessage = (source = ''): MessageDraft => ({ source, recipient: '', subject: '', body: '' });

function isIntent(value: unknown): value is Intent {
  return value === 'calendar' || value === 'checklist' || value === 'compare' || value === 'draft_message' || value === 'none';
}

function parseDecision(value: unknown, requestId: number): DecisionResponse {
  if (!value || typeof value !== 'object') throw new Error('Decision response was not an object.');
  const candidate = value as Record<string, unknown>;
  if (candidate.request_id !== requestId || !isIntent(candidate.intent)) throw new Error('Decision response did not match the current draft.');
  if (typeof candidate.provider !== 'string' || typeof candidate.model !== 'string' || typeof candidate.decision_ms !== 'number' || typeof candidate.abstained !== 'boolean') throw new Error('Decision response is missing runtime details.');
  if (!candidate.scores || typeof candidate.scores !== 'object') throw new Error('Decision response is missing scores.');
  const incomingScores = candidate.scores as Record<string, unknown>;
  const scores = {} as Record<Intent, number>;
  for (const key of scoreKeys) {
    if (typeof incomingScores[key] !== 'number' || !Number.isFinite(incomingScores[key])) throw new Error('Decision response contains invalid scores.');
    scores[key] = incomingScores[key] as number;
  }
  scores.none = typeof incomingScores.none === 'number' && Number.isFinite(incomingScores.none) ? incomingScores.none : 0;
  return { request_id: requestId, intent: candidate.intent, scores, provider: candidate.provider, model: candidate.model, decision_ms: candidate.decision_ms, abstained: candidate.abstained };
}

function downloadCalendar(draft: CalendarDraft) {
  const now = new Date();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Predictive Workspace//EN',
    'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}@predictive-workspace`,
    `DTSTAMP:${formatIcsDate(now.toISOString().slice(0, 10), now.toISOString().slice(11, 16))}Z`,
    `DTSTART:${formatIcsDate(draft.date, draft.startTime)}`,
    `DTEND:${formatIcsDate(draft.date, draft.endTime)}`,
    `SUMMARY:${draft.title.replaceAll('\n', ' ')}`,
    ...(draft.location ? [`LOCATION:${draft.location.replaceAll('\n', ' ')}`] : []),
    ...(draft.description ? [`DESCRIPTION:${draft.description.replaceAll('\n', '\\n')}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
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
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      const fallback = document.createElement('textarea');
      fallback.value = text;
      fallback.style.position = 'fixed';
      fallback.style.opacity = '0';
      document.body.appendChild(fallback);
      fallback.select();
      const copiedWithFallback = document.execCommand('copy');
      fallback.remove();
      setCopied(copiedWithFallback);
      if (copiedWithFallback) window.setTimeout(() => setCopied(false), 1600);
    }
  }, []);
  return { copied, copy };
}

function Field({ label, value, onChange, placeholder, multiline = false, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; multiline?: boolean; type?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={4} /> : <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />}
    </label>
  );
}

function ToolPanel({ tool, source, calendar, setCalendar, checklist, setChecklist, compare, setCompare, message, setMessage, onClose }: { tool: ToolKind; source: string; calendar: CalendarDraft; setCalendar: React.Dispatch<React.SetStateAction<CalendarDraft>>; checklist: ChecklistTask[]; setChecklist: React.Dispatch<React.SetStateAction<ChecklistTask[]>>; compare: CompareDraft; setCompare: React.Dispatch<React.SetStateAction<CompareDraft>>; message: MessageDraft; setMessage: React.Dispatch<React.SetStateAction<MessageDraft>>; onClose: () => void }) {
  const copy = useCopy();
  const meta = toolMeta[tool];
  const Icon = meta.icon;
  const [copyNote, setCopyNote] = useState('');
  const noteCopy = (text: string) => {
    void copy.copy(text);
    setCopyNote('Copied');
    window.setTimeout(() => setCopyNote(''), 1600);
  };
  const checklistText = checklist.map((task) => `${task.done ? '[x]' : '[ ]'} ${task.text}`).join('\n');
  const comparisonText = [['', ...compare.options].join(' | '), ...compare.criteria.map((criterion, row) => [criterion, ...compare.options.map((_, column) => compare.cells[row]?.[column] || '')].join(' | '))].join('\n');
  return (
    <section className="tool-panel" aria-label={`${meta.label} tool`}>
      <div className="tool-heading"><div className="tool-title-wrap"><span className="tool-icon"><Icon size={18} strokeWidth={1.8} /></span><div><p className="eyebrow">Local tool</p><h2>{meta.label}</h2></div></div><button className="icon-button" onClick={onClose} aria-label="Close tool"><X size={18} /></button></div>
      {source && <p className="source-draft"><span>Source draft</span> {source}</p>}
      {tool === 'calendar' && <div className="tool-content"><p className="tool-intro">Enter the details you want in the file. Nothing is added to a calendar.</p><div className="field-grid two-up"><Field label="Title" value={calendar.title} onChange={(title) => setCalendar((current) => ({ ...current, title }))} placeholder="Enter an event title" /><Field label="Date" value={calendar.date} onChange={(date) => setCalendar((current) => ({ ...current, date }))} placeholder="YYYY-MM-DD" type="date" /><Field label="Starts" value={calendar.startTime} onChange={(startTime) => setCalendar((current) => ({ ...current, startTime }))} placeholder="09:00" type="time" /><Field label="Ends" value={calendar.endTime} onChange={(endTime) => setCalendar((current) => ({ ...current, endTime }))} placeholder="10:00" type="time" /></div><Field label="Location (optional)" value={calendar.location} onChange={(location) => setCalendar((current) => ({ ...current, location }))} placeholder="Add a place or link" /><Field label="Notes (optional)" value={calendar.description} onChange={(description) => setCalendar((current) => ({ ...current, description }))} placeholder="Add context for the event" multiline /><div className="tool-actions"><button className="button primary" disabled={!calendar.title.trim() || !calendar.date || !calendar.startTime || !calendar.endTime} onClick={() => downloadCalendar(calendar)}><Download size={16} /> Download .ics</button><span className="action-note">Download only · no calendar access</span></div></div>}
      {tool === 'checklist' && <div className="tool-content"><p className="tool-intro">Keep the list yours. Edit, reorder later, or copy it into another app.</p><div className="task-list">{checklist.map((task) => <div className={cn('task-row', task.done && 'is-done')} key={task.id}><button className="check-button" onClick={() => setChecklist((current) => current.map((item) => item.id === task.id ? { ...item, done: !item.done } : item))} aria-label={task.done ? 'Mark task open' : 'Mark task complete'}><Check size={15} /></button><input value={task.text} onChange={(event) => setChecklist((current) => current.map((item) => item.id === task.id ? { ...item, text: event.target.value } : item))} placeholder="Add a task" /><button className="icon-button subtle" onClick={() => setChecklist((current) => current.filter((item) => item.id !== task.id))} aria-label="Remove task"><Minus size={16} /></button></div>)}</div><button className="button quiet" onClick={() => setChecklist((current) => [...current, { id: Math.max(0, ...current.map((item) => item.id)) + 1, text: '', done: false }])}><Plus size={16} /> Add task</button><div className="tool-actions"><button className="button secondary" disabled={!checklist.some((task) => task.text.trim())} onClick={() => noteCopy(checklistText)}><Copy size={16} /> {copy.copied ? 'Copied' : 'Copy checklist'}</button>{copyNote && <span className="action-note">{copyNote}</span>}</div></div>}
      {tool === 'compare' && <div className="tool-content"><p className="tool-intro">A blank comparison keeps the decision grounded in the facts you add.</p><div className="comparison-wrap"><table className="comparison-table"><thead><tr><th>Criteria</th>{compare.options.map((option, column) => <th key={column}><input value={option} onChange={(event) => setCompare((current) => ({ ...current, options: current.options.map((item, index) => index === column ? event.target.value : item) }))} placeholder={`Option ${column + 1}`} /></th>)}</tr></thead><tbody>{compare.criteria.map((criterion, row) => <tr key={row}><th><input value={criterion} onChange={(event) => setCompare((current) => ({ ...current, criteria: current.criteria.map((item, index) => index === row ? event.target.value : item) }))} placeholder={`Criterion ${row + 1}`} /></th>{compare.options.map((_, column) => <td key={column}><input value={compare.cells[row]?.[column] || ''} onChange={(event) => setCompare((current) => ({ ...current, cells: current.cells.map((cells, rowIndex) => rowIndex === row ? cells.map((cell, columnIndex) => columnIndex === column ? event.target.value : cell) : cells) }))} placeholder="Add fact" /></td>)}</tr>)}</tbody></table></div><div className="tool-actions split-actions"><div><button className="button quiet" onClick={() => setCompare((current) => ({ ...current, criteria: [...current.criteria, ''], cells: [...current.cells, current.options.map(() => '')] }))}><Plus size={16} /> Add criterion</button><button className="button quiet" onClick={() => setCompare((current) => ({ ...current, options: [...current.options, ''], cells: current.cells.map((cells) => [...cells, '']) }))}><Plus size={16} /> Add option</button></div><button className="button secondary" onClick={() => noteCopy(comparisonText)}><Copy size={16} /> {copy.copied ? 'Copied' : 'Copy table'}</button></div></div>}
      {tool === 'draft_message' && <div className="tool-content"><p className="tool-intro">Draft locally and copy when it sounds right. Sending stays in your hands.</p><Field label="Recipient" value={message.recipient} onChange={(recipient) => setMessage((current) => ({ ...current, recipient }))} placeholder="Name or address" /><Field label="Subject" value={message.subject} onChange={(subject) => setMessage((current) => ({ ...current, subject }))} placeholder="What is this about?" /><Field label="Body" value={message.body} onChange={(body) => setMessage((current) => ({ ...current, body }))} placeholder="Write your message" multiline /><div className="tool-actions"><button className="button secondary" disabled={!message.body.trim()} onClick={() => noteCopy(`To: ${message.recipient}\nSubject: ${message.subject}\n\n${message.body}`)}><Copy size={16} /> {copy.copied ? 'Copied' : 'Copy draft'}</button>{copyNote && <span className="action-note">{copyNote}</span>}</div></div>}
    </section>
  );
}

export default function Home() {
  const [draft, setDraft] = useState('');
  const [prediction, setPrediction] = useState<DecisionResponse | null>(null);
  const [decisionState, setDecisionState] = useState<'idle' | 'loading' | 'ready' | 'error' | 'disabled'>('idle');
  const [decisionError, setDecisionError] = useState('');
  const [predictionEnabled, setPredictionEnabled] = useState(true);
  const [activeTool, setActiveTool] = useState<ToolKind | null>(null);
  const [toolSources, setToolSources] = useState<Partial<Record<ToolKind, string>>>({});
  const [dismissedSuggestion, setDismissedSuggestion] = useState('');
  const [roundtripMs, setRoundtripMs] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatError, setChatError] = useState('');
  const [calendar, setCalendar] = useState<CalendarDraft>(() => emptyCalendar());
  const [checklist, setChecklist] = useState<ChecklistTask[]>([{ id: 1, text: '', done: false }]);
  const [compare, setCompare] = useState<CompareDraft>({ options: ['', ''], criteria: ['', ''], cells: [['', ''], ['', '']] });
  const [message, setMessage] = useState<MessageDraft>(() => emptyMessage());
  const lifecycleRef = useRef<DecisionLifecycle | null>(null);
  if (!lifecycleRef.current) lifecycleRef.current = createDecisionLifecycle();
  const composingRef = useRef(false);
  const [compositionTick, setCompositionTick] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const cancelDecision = useCallback(() => {
    lifecycleRef.current?.invalidate();
  }, []);

  useEffect(() => {
    if (composingRef.current) return;
    const text = draft.trim();
    const lifecycle = lifecycleRef.current;
    if (!lifecycle) return;
    const request = lifecycle.begin();
    const { requestId, controller } = request;
    setPrediction(null);
    if (!predictionEnabled) {
      setPrediction(null);
      setDecisionState('disabled');
      setDecisionError('');
      return;
    }
    if (!text) {
      setPrediction(null);
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
          setDecisionState('loading');
          lifecycle.schedule(requestId, () => { void attemptDecision(attempt + 1); }, 1000 * (2 ** attempt));
          return;
        }
        if (!response.ok) throw new Error(response.status === 429 ? 'Decision model is still warming or busy after retries. Try again shortly.' : `Decision service returned ${response.status}.`);
        const data = parseDecision(await response.json(), requestId);
        if (!lifecycle.isCurrent(requestId)) return;
        setPrediction(data);
        setRoundtripMs(Math.round(performance.now() - startedAt));
        setDecisionState('ready');
      } catch (error) {
        if (controller.signal.aborted || !lifecycle.isCurrent(requestId)) return;
        setDecisionState('error');
        setDecisionError(error instanceof Error ? error.message : 'Decision service unavailable.');
        setPrediction(null);
        setRoundtripMs(null);
      }
    };
    lifecycle.schedule(requestId, () => { void attemptDecision(0); }, 250);
    return () => lifecycle.invalidate();
  }, [draft, predictionEnabled, compositionTick]);

  const openTool = (tool: ToolKind, source = draft.trim()) => {
    cancelDecision();
    setActiveTool(tool);
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

  const sendToChat = async () => {
    const text = draft.trim();
    if (!text || chatBusy) return;
    setChatBusy(true);
    setChatError('');
    setMessages((current) => [...current, { role: 'user', content: text }]);
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [...messages, { role: 'user', content: text }] }) });
      if (!response.ok) throw new Error(`Chat service returned ${response.status}.`);
      const data = await response.json() as { message?: string; response?: string; content?: string };
      const reply = data.message || data.response || data.content;
      if (!reply) throw new Error('Chat service returned no reply.');
      setMessages((current) => [...current, { role: 'assistant', content: reply }]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'Chat service unavailable.');
    } finally {
      setChatBusy(false);
    }
  };

  const continueDraft = () => {
    if (prediction && topIntent && !prediction.abstained) {
      openTool(topIntent);
      return;
    }
    document.querySelector<HTMLButtonElement>('.manual-tool')?.focus();
  };

  const suggestionVisible = Boolean(prediction && prediction.intent !== 'none' && !prediction.abstained && `${prediction.request_id}:${prediction.intent}` !== dismissedSuggestion);
  const topIntent = prediction && prediction.intent !== 'none' ? prediction.intent : null;

  return (
    <main className="workspace-shell">
      <div className="workspace-frame">
        <header className="site-header"><Link href="/" className="wordmark" aria-label="Predictive workspace home"><span className="wordmark-mark"><Sparkles size={16} /></span><span>Predictive workspace</span></Link><div className="header-status"><span className={cn('status-dot', predictionEnabled && 'is-on')} /> {predictionEnabled ? 'Prediction on' : 'Prediction paused'} <button className="text-button" onClick={() => { const next = !predictionEnabled; setPredictionEnabled(next); if (!next) cancelDecision(); }}>Change</button></div></header>
        <div className="workspace-grid">
          <section className="composer-column">
            <div className="intro-block"><p className="eyebrow">A quieter way to start</p><h1>Put the thought down.<br /><em>Pick up the right tool.</em></h1><p className="intro-copy">Write what is on your mind. Predictive workspace suggests a useful starting point before you send anything.</p></div>
            <div className="composer-card"><div className="composer-label"><span>What are you working on?</span><span className="character-hint">{draft.length > 0 ? `${draft.length}/600 characters` : 'Your draft stays here'}</span></div><textarea maxLength={600} ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; setCompositionTick((tick) => tick + 1); }} placeholder="Try: remind me to compare the two offers…" rows={6} aria-label="Describe what you want to work on" /><div className="composer-footer"><span className="privacy-note"><span className="lock-mark">◎</span> Local prediction receives this draft while you type</span><div className="composer-actions">{draft && <button className="clear-button" onClick={() => { setDraft(''); inputRef.current?.focus(); }}>Clear</button>}<button className="button primary send-button" onClick={continueDraft} disabled={!draft.trim() || chatBusy}>{chatBusy ? <LoaderCircle className="spin" size={16} /> : <ArrowUpRight size={15} />}{prediction && topIntent && !prediction.abstained ? 'Open suggestion' : 'Choose a tool'}</button></div></div></div>
            <div className="examples"><span className="examples-label">Start with an example</span><div className="example-row"><button onClick={() => setDraft('Plan a team offsite next Thursday from 10am to 4pm')}>Plan a team offsite</button><button onClick={() => setDraft('Compare these two job offers on pay, growth, and location')}>Compare two offers</button><button onClick={() => setDraft('Write a note to Sam asking to move our catch-up')}>Draft a note</button></div></div>
            <div className="optional-chat"><button className="optional-chat-toggle" onClick={() => setChatOpen((open) => !open)}>{chatOpen ? 'Hide optional assistant chat' : 'Optional: ask the assistant'}</button>{chatOpen && <div className="optional-chat-panel"><p>This separate chat route may require its own provider. It does not run the local tools.</p><button className="button secondary" onClick={sendToChat} disabled={!draft.trim() || chatBusy}>{chatBusy ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />} Send this draft</button></div>}</div>
            {chatError && <p className="inline-error" role="alert">The assistant is unavailable right now. Your draft is still here. <span>{chatError}</span></p>}
            {decisionState === 'error' && <p className="inline-error" role="status">Prediction is unavailable. You can still choose a local tool manually. <span>{decisionError}</span></p>}
            {messages.length > 0 && <div className="message-thread" aria-label="Chat messages">{messages.map((item, index) => <div className={cn('message-bubble', item.role)} key={`${item.role}-${index}`}><span>{item.role === 'user' ? 'You' : 'Assistant'}</span><p>{item.content}</p></div>)}</div>}
            <footer className="quiet-footer"><span>Local tools · Your edits stay in your browser</span><a href="#details">How decisions are made <ArrowUpRight size={13} /></a></footer>
          </section>
          <aside className="tools-column"><div className="tools-head"><div><p className="eyebrow">Workspace</p><h2>{activeTool ? toolMeta[activeTool].label : 'Choose a starting point'}</h2></div>{decisionState === 'loading' && <LoaderCircle className="spin muted-icon" size={18} aria-label="Predicting" />}</div>
            {activeTool ? <ToolPanel tool={activeTool} source={toolSources[activeTool] || ''} calendar={calendar} setCalendar={setCalendar} checklist={checklist} setChecklist={setChecklist} compare={compare} setCompare={setCompare} message={message} setMessage={setMessage} onClose={() => setActiveTool(null)} /> : <><>{suggestionVisible && prediction && topIntent ? <div className="suggestion-card"><div className="suggestion-top"><span className="suggestion-kicker"><Sparkles size={14} /> Suggested tool</span><button className="icon-button subtle" onClick={dismissSuggestion} aria-label="Dismiss suggestion"><X size={16} /></button></div><h3>{intentLabels[topIntent]}</h3><p>{toolMeta[topIntent].description}</p><button className="suggestion-open" onClick={() => openTool(topIntent)}><span>Open {toolMeta[topIntent].label}</span><ArrowUpRight size={16} /></button></div> : <div className="empty-tools"><div className="empty-icon"><CheckSquare2 size={20} /></div><h3>{decisionState === 'error' ? 'Tools are still available' : 'Your tools will appear here'}</h3><p>{decisionState === 'error' ? 'Prediction is unavailable. Choose a tool manually and keep going.' : 'Start typing and we will offer one when the intent is clear.'}</p></div>}</><div className="manual-tools"><div className="manual-heading"><span>Or choose manually</span><span className="manual-rule" /></div>{scoreKeys.map((tool) => { const Icon = toolMeta[tool].icon; return <button className="manual-tool" key={tool} onClick={() => openTool(tool)}><span className="manual-tool-icon"><Icon size={17} /></span><span><strong>{toolMeta[tool].label}</strong><small>{toolMeta[tool].description}</small></span><ArrowUpRight size={15} /></button>; })}</div>{prediction && (prediction.intent === 'none' || prediction.abstained) && <p className="abstain-note">{prediction.abstained ? 'The decision model abstained for this draft. You can choose a tool manually.' : 'No clear tool suggestion for this draft. You can still choose one above.'}</p>}</>}
            <div className="decision-details" id="details"><details><summary>Decision details</summary>{prediction ? <div className="detail-grid"><span>Provider</span><strong>{prediction.provider}</strong><span>Model</span><strong>{prediction.model}</strong><span>Model time</span><strong>{prediction.decision_ms.toFixed(0)} ms</strong><span>Roundtrip</span><strong>{roundtripMs === null ? '—' : `${roundtripMs} ms`}</strong><span>Result</span><strong>{prediction.abstained ? 'Abstained' : intentLabels[prediction.intent]}</strong></div> : <p>{decisionState === 'disabled' ? 'Prediction is paused.' : 'Details appear after a prediction returns.'}</p>}</details></div>
          </aside>
        </div>
      </div>
    </main>
  );
}
