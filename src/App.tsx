import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import './App.css'
import type { ChatMessage, Effort, ParseResult, Priority, Task, TaskStatus } from './types/task'
import { parseLocally, parseWithGemini } from './services/taskParser'
import { readChat, readSavedApiKey, readTasks, saveApiKey, saveChat, saveTasks } from './services/storage'

const today = localDate()
const yesterday = addDays(today, -1)
const demoTasks: Task[] = [
  seed('Audit refresh-token rotation edge cases', 'Cover expired sessions and concurrent refresh requests before the auth release.', yesterday, 'Maya', 'High', 'Large', 'In Progress'),
  seed('Review billing webhook retry PR', 'Check idempotency behavior and confirm the retry backoff matches the API contract.', today, 'Rahul', 'High', 'Medium', 'Open'),
  seed('Publish v2 API authentication guide', 'Document OAuth scopes, token refresh, and copy-ready request examples.', addDays(today, 3), 'Priya', 'Medium', 'Medium', 'Open'),
  seed('Investigate elevated checkout latency', 'Compare p95 traces across the payment and order services; capture a likely cause.', null, 'Neha', 'High', 'Large', 'In Progress'),
  seed('Migrate staging workers to Node 22', 'Update the staging image and verify scheduled jobs after rollout.', addDays(today, 5), 'Omar', 'Medium', 'Medium', 'Open'),
  seed('Prepare Northstar client review deck', 'Summarize launch readiness, open decisions, and next-quarter recommendations.', addDays(today, 4), 'You', 'Medium', 'Large', 'Open'),
  seed('Add export coverage for audit logs', 'Test CSV escaping and timezone behavior in the admin export flow.', addDays(today, 7), 'Maya', 'Low', 'Small', 'Open'),
  seed('Confirm incident follow-up owners', 'Send the incident action list and confirm an owner for each remaining item.', addDays(today, 2), 'Omar', 'Medium', 'Small', 'Completed'),
  seed('Benchmark vector index rebuild', 'Compare rebuild times for the current index settings and the proposed shard size.', addDays(today, 9), 'Neha', 'Low', 'Large', 'Open'),
  seed('Close legacy SSO rollout checklist', 'Verify the support handoff and archive the completed rollout notes.', addDays(today, -3), 'Rahul', 'Low', 'Small', 'Completed'),
  seed('Schedule platform and product sync', 'Find a 30-minute slot to resolve the ownership question for usage reporting.', addDays(today, 1), 'Priya', 'Medium', 'Small', 'Open'),
]

const initialAssistant: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'Hi! Paste meeting notes or describe a commitment, and I’ll turn clear action items into tasks. Without a Gemini key, I use a lightweight local parser.',
}

function App() {
  const saved = readSavedApiKey()
  const [tasks, setTasks] = useState<Task[]>(() => readTasks() ?? demoTasks)
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const history = readChat()
    return history.length ? history : [initialAssistant]
  })
  const [draft, setDraft] = useState('')
  const [apiKey, setApiKey] = useState(saved.key)
  const [saveKey, setSaveKey] = useState(saved.save)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editor, setEditor] = useState<Task | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retryText, setRetryText] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All statuses')
  const [priorityFilter, setPriorityFilter] = useState('All priorities')
  const [assigneeFilter, setAssigneeFilter] = useState('All assignees')
  const [sort, setSort] = useState('due')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const tasksRef = useRef(tasks)

  useEffect(() => { tasksRef.current = tasks; saveTasks(tasks) }, [tasks])
  useEffect(() => { saveChat(messages) }, [messages])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, busy])

  const counts = useMemo(() => ({
    open: tasks.filter((task) => task.status !== 'Completed').length,
    today: tasks.filter((task) => task.status !== 'Completed' && task.dueDate === today).length,
    overdue: tasks.filter((task) => task.status !== 'Completed' && task.dueDate !== null && task.dueDate < today).length,
    completed: tasks.filter((task) => task.status === 'Completed').length,
  }), [tasks])

  const assignees = useMemo(() => [...new Set(tasks.map((task) => task.assignee).filter((value): value is string => Boolean(value)))].sort(), [tasks])

  const visibleTasks = useMemo(() => tasks
    .filter((task) => {
      const query = search.trim().toLowerCase()
      return (!query || `${task.title} ${task.description} ${task.assignee ?? ''}`.toLowerCase().includes(query))
        && (statusFilter === 'All statuses' || task.status === statusFilter)
        && (priorityFilter === 'All priorities' || task.priority === priorityFilter)
        && (assigneeFilter === 'All assignees' || task.assignee === assigneeFilter)
        && (!overdueOnly || (task.status !== 'Completed' && Boolean(task.dueDate && task.dueDate < today)))
    })
    .sort((a, b) => {
      if (sort === 'priority') {
        const rank = { High: 0, Medium: 1, Low: 2 }
        return rank[a.priority] - rank[b.priority]
      }
      return (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31')
    }), [tasks, search, statusFilter, priorityFilter, assigneeFilter, sort, overdueOnly])

  async function submitMessage(event?: FormEvent, text = draft, retry = false) {
    event?.preventDefault()
    const content = text.trim()
    if (!content || busy) return
    if (!retry) {
      const userMessage: ChatMessage = { id: makeId(), role: 'user', content }
      setMessages((current) => [...current, userMessage])
    }
    setDraft('')
    setError('')
    setBusy(true)
    setRetryText(content)
    try {
      const showOverdue = /\b(show|list|find)\b.*\boverdue\b/i.test(content)
      const parsed = showOverdue || !apiKey.trim() ? parseLocally(content) : await parseWithGemini(content, apiKey.trim(), tasksRef.current)
      if (showOverdue) {
        setOverdueOnly(true)
        setStatusFilter('All statuses')
        setPriorityFilter('All priorities')
        setAssigneeFilter('All assignees')
      }
      const unmatched = applyParseResult(parsed)
      const reply = parsed.needsClarification || parsed.reply
      setMessages((current) => [...current, {
        id: makeId(),
        role: 'assistant',
        content: reply,
        source: apiKey.trim() && !showOverdue ? 'ai' : 'local',
      }])
      if (unmatched.length) {
        setMessages((current) => [...current, {
          id: makeId(),
          role: 'assistant',
          content: unmatched.length === 1
            ? `I couldn’t safely identify one task matching “${unmatched[0]}”. Nothing was changed for that instruction. Please include the task’s exact title.`
            : `I couldn’t safely identify these tasks: ${unmatched.map((title) => `“${title}”`).join(', ')}. Nothing was changed for those instructions.`,
          source: apiKey.trim() && !showOverdue ? 'ai' : 'local',
        }])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Task parsing failed. Retry the request.')
    } finally {
      setBusy(false)
    }
  }

  function applyParseResult(result: ParseResult): string[] {
    if (result.needsClarification) return []
    const incoming = result.tasks.map((task) => ({ ...task, id: makeId(), createdAt: new Date().toISOString() }))
    let unmatched: string[] = []
    let next = [...tasksRef.current, ...incoming]
    result.actions.forEach((action) => {
      const query = action.taskTitle.toLowerCase()
      const matches = next.filter((task) => task.title.toLowerCase().includes(query) || query.includes(task.title.toLowerCase()))
      if (matches.length !== 1) {
        unmatched.push(action.taskTitle)
        return
      }
      const target = matches[0]
      if (action.type === 'complete') next = next.map((task) => task.id === target.id ? { ...task, status: 'Completed' } : task)
      else if (action.type === 'reopen') next = next.map((task) => task.id === target.id ? { ...task, status: 'Open' } : task)
      else if (action.changes) next = next.map((task) => task.id === target.id ? { ...task, ...action.changes } : task)
    })
    tasksRef.current = next
    setTasks(next)
    return unmatched
  }

  function updateTask(task: Task) {
    setTasks((current) => current.some((item) => item.id === task.id)
      ? current.map((item) => item.id === task.id ? task : item)
      : [task, ...current])
    setEditor(undefined)
  }

  function removeTask(task: Task) {
    if (window.confirm(`Delete “${task.title}”? This cannot be undone.`)) {
      setTasks((current) => current.filter((item) => item.id !== task.id))
    }
  }

  function clearChat() {
    setMessages([initialAssistant])
    setError('')
    setRetryText('')
  }

  function resetDemo() {
    if (window.confirm('Restore the original demo tasks? This replaces your current task list.')) {
      setTasks(demoTasks.map((task) => ({ ...task, id: makeId() })))
      setMessages([initialAssistant])
      setSearch('')
      setStatusFilter('All statuses')
      setPriorityFilter('All priorities')
      setAssigneeFilter('All assignees')
      setOverdueOnly(false)
      setOverdueOnly(false)
    }
  }

  function saveSettings(event: FormEvent) {
    event.preventDefault()
    saveApiKey(apiKey.trim(), saveKey)
    setSettingsOpen(false)
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submitMessage()
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="CommitDesk home">
          <span className="brand-mark"><span /></span>
          <span>commit<span className="brand-light">desk</span></span>
        </a>
        <div className="workspace-label"><span className="status-dot" /> Personal workspace</div>
        <div className="top-actions">
          <button className="button button-quiet" onClick={resetDemo} title="Replace tasks with the demo dataset">Restore demo</button>
          <button className="button button-settings" onClick={() => setSettingsOpen(true)} aria-label="Open settings"><SettingsIcon /> <span>Settings</span></button>
          <div className="avatar" title="Your workspace">A</div>
        </div>
      </header>

      <section className="workspace">
        <aside className="chat-panel">
          <div className="panel-heading chat-heading">
            <div>
              <div className="eyebrow"><span className="sparkle">✦</span> COMMITMENT ASSISTANT</div>
              <h1>Turn talk into action.</h1>
              <p>Drop in meeting notes. I’ll find the follow-through.</p>
            </div>
            <button className="icon-button clear-button" onClick={clearChat} aria-label="Clear conversation" title="Clear conversation"><TrashIcon /></button>
          </div>

          <div className="chat-content">
            <div className="conversation">
              {messages.map((message) => (
                <article className={`message message-${message.role}`} key={message.id}>
                  {message.role === 'assistant' && <div className="assistant-avatar"><SparkIcon /></div>}
                  <div className="message-body">
                    {message.role === 'assistant' && <div className="message-meta">CommitDesk {message.source && <span className={`source-tag ${message.source}`}>{message.source === 'ai' ? 'Gemini' : 'Local parser'}</span>}</div>}
                    <div className="message-bubble">{message.content}</div>
                  </div>
                  {message.role === 'user' && <div className="user-avatar">A</div>}
                </article>
              ))}
              {busy && <div className="message message-assistant"><div className="assistant-avatar"><SparkIcon /></div><div className="message-body"><div className="message-meta">CommitDesk</div><div className="message-bubble loading-bubble"><span className="loader" /> Finding the commitments…</div></div></div>}
              {error && <div className="error-card" role="alert"><div><strong>Couldn’t parse that message</strong><p>{error}</p></div>              <button className="button button-small" onClick={() => void submitMessage(undefined, retryText, true)} disabled={busy}>Retry</button></div>}
              <div ref={bottomRef} />
            </div>
            <div className="composer-wrap">
              <div className="suggestion-label">TRY SOMETHING LIKE</div>
              <button className="suggestion" onClick={() => setDraft("During today's meeting, Priya will finish the API documentation by Friday. Rahul needs to review the authentication PR by tomorrow. I'll prepare the client presentation by Monday. Neha should investigate the production latency issue, but we haven't decided on a deadline yet.")}>
                “Priya will finish the API docs by Friday…”
              </button>
              <form className="composer" onSubmit={(event) => void submitMessage(event)}>
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onInputKeyDown} placeholder="Paste meeting notes or describe a task…" rows={3} aria-label="Message CommitDesk" />
                <div className="composer-footer">
                  <span><kbd>↵</kbd> to send <span className="key-divider">·</span> <kbd>Shift + ↵</kbd> for a new line</span>
                  <button className="send-button" type="submit" disabled={!draft.trim() || busy} aria-label="Send message"><ArrowIcon /></button>
                </div>
              </form>
              <div className="privacy-note"><LockIcon /> {apiKey ? 'Gemini enabled · Your task data is sent only for parsing' : 'Local mode · Add a Gemini key in Settings for smarter extraction'}</div>
            </div>
          </div>
        </aside>

        <section className="board-panel">
          <div className="board-header">
            <div className="board-title-row">
              <div><div className="eyebrow">YOUR WORKSPACE</div><h2>Task board <span className="task-total">{tasks.length}</span></h2></div>
              <button className="button button-primary" onClick={() => setEditor(null)}><PlusIcon /> New task</button>
            </div>
            <div className="summary-strip">
              <SummaryItem label="OPEN TASKS" value={counts.open} tone="ink" />
              <SummaryItem label="DUE TODAY" value={counts.today} tone="amber" />
              <SummaryItem label="OVERDUE" value={counts.overdue} tone="red" />
              <SummaryItem label="COMPLETED" value={counts.completed} tone="green" />
            </div>
          </div>
          <div className="board-toolbar">
            <label className="search-field"><SearchIcon /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks…" aria-label="Search tasks" /></label>
            <div className="filter-controls">
              <button className={`overdue-filter ${overdueOnly ? 'active' : ''}`} onClick={() => setOverdueOnly((value) => !value)} aria-pressed={overdueOnly}>Overdue</button>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
                <option>All statuses</option><option>Open</option><option>In Progress</option><option>Completed</option>
              </select>
              <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} aria-label="Filter by priority">
                <option>All priorities</option><option>High</option><option>Medium</option><option>Low</option>
              </select>
              <select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)} aria-label="Filter by assignee">
                <option>All assignees</option>{assignees.map((assignee) => <option key={assignee}>{assignee}</option>)}
              </select>
              <label className="sort-control"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort tasks"><option value="due">Due date</option><option value="priority">Priority</option></select></label>
            </div>
          </div>
          <div className="task-list">
            {visibleTasks.length ? visibleTasks.map((task) => (
              <TaskCard key={task.id} task={task} onEdit={() => setEditor(task)} onDelete={() => removeTask(task)} onStatus={(status) => setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status } : item))} />
            )) : <div className="empty-state"><div className="empty-icon"><CheckIcon /></div><h3>{tasks.length ? 'No matching tasks' : 'Your board is clear'}</h3><p>{tasks.length ? 'Try changing your filters or search.' : 'Paste meeting notes in the chat, or create your first task.'}</p><button className="button button-primary" onClick={() => setEditor(null)}><PlusIcon /> Create a task</button></div>}
          </div>
          <div className="board-footnote"><span className="sync-mark"><CheckIcon /></span> Changes save automatically to this browser <span className="footnote-dot">·</span> {visibleTasks.length} of {tasks.length} tasks</div>
        </section>
      </section>

      {settingsOpen && <SettingsDialog apiKey={apiKey} setApiKey={setApiKey} saveKey={saveKey} setSaveKey={setSaveKey} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />}
      {editor !== undefined && <TaskDialog task={editor ?? undefined} onSave={updateTask} onClose={() => setEditor(undefined)} />}
    </main>
  )
}

function TaskCard({ task, onEdit, onDelete, onStatus }: {
  task: Task
  onEdit: () => void
  onDelete: () => void
  onStatus: (status: TaskStatus) => void
}) {
  const overdue = task.status !== 'Completed' && Boolean(task.dueDate && task.dueDate < today)
  const dueToday = task.status !== 'Completed' && task.dueDate === today
  return (
    <article className={`task-card ${task.status === 'Completed' ? 'is-complete' : ''}`}>
      <div className="task-main">
        <button className={`completion-toggle ${task.status === 'Completed' ? 'checked' : ''}`} aria-label={task.status === 'Completed' ? 'Reopen task' : 'Mark task completed'} onClick={() => onStatus(task.status === 'Completed' ? 'Open' : 'Completed')}>
          {task.status === 'Completed' && <CheckIcon />}
        </button>
        <div className="task-copy">
          <div className="task-title-line"><h3>{task.title}</h3><PriorityBadge priority={task.priority} /></div>
          {task.description && <p className="task-description">{task.description}</p>}
          <div className="task-meta">
            <span className={`due ${overdue ? 'overdue' : ''} ${dueToday ? 'due-today' : ''}`}><CalendarIcon /> {formatDue(task.dueDate, overdue, dueToday)}</span>
            <span className="meta-separator" />
            <span className="assignee"><span className={`person-avatar ${avatarTone(task.assignee)}`}>{initials(task.assignee)}</span>{task.assignee ?? 'Unassigned'}</span>
            <span className="effort"><span className="effort-dot" /> {task.effort} effort</span>
          </div>
        </div>
      </div>
      <div className="task-actions">
        <StatusBadge status={task.status} onChange={onStatus} />
        <button className="icon-button task-action" onClick={onEdit} aria-label={`Edit ${task.title}`} title="Edit task"><EditIcon /></button>
        <button className="icon-button task-action delete-action" onClick={onDelete} aria-label={`Delete ${task.title}`} title="Delete task"><TrashIcon /></button>
      </div>
    </article>
  )
}

function StatusBadge({ status, onChange }: { status: TaskStatus; onChange: (status: TaskStatus) => void }) {
  return <select className={`status-badge status-${status.toLowerCase().replace(' ', '-')}`} value={status} onChange={(event) => onChange(event.target.value as TaskStatus)} aria-label="Task status">
    <option>Open</option><option>In Progress</option><option>Completed</option>
  </select>
}

function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`priority-badge priority-${priority.toLowerCase()}`}><span />{priority}</span>
}

function SummaryItem({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className={`summary-item summary-${tone}`}><span className="summary-label">{label}</span><strong>{String(value).padStart(2, '0')}</strong></div>
}

function TaskDialog({ task, onSave, onClose }: { task?: Task; onSave: (task: Task) => void; onClose: () => void }) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '')
  const [assignee, setAssignee] = useState(task?.assignee ?? '')
  const [requester, setRequester] = useState(task?.requester ?? '')
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'Medium')
  const [effort, setEffort] = useState<Effort>(task?.effort ?? 'Medium')
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'Open')
  const [formError, setFormError] = useState('')
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) { setFormError('Add a title to save this task.'); return }
    onSave({
      id: task?.id ?? makeId(), title: title.trim(), description: description.trim(), dueDate: dueDate || null,
      assignee: assignee.trim() || null, requester: requester.trim() || null, priority, effort, status,
      createdAt: task?.createdAt ?? new Date().toISOString(),
    })
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="dialog task-dialog" role="dialog" aria-modal="true" aria-labelledby="task-dialog-title">
    <div className="dialog-header"><div><div className="eyebrow">{task ? 'TASK DETAILS' : 'NEW COMMITMENT'}</div><h2 id="task-dialog-title">{task ? 'Edit task' : 'Create a task'}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><CloseIcon /></button></div>
    <form onSubmit={submit}>
      <label className="form-field">Task title<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Review the deployment pipeline" /></label>
      <label className="form-field">Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="Add useful context…" /></label>
      <div className="form-grid">
        <label className="form-field">Assignee<input value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="Person responsible" /></label>
        <label className="form-field">Requested by<input value={requester} onChange={(event) => setRequester(event.target.value)} placeholder="Optional" /></label>
        <label className="form-field">Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
        <label className="form-field">Priority<select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}><option>Low</option><option>Medium</option><option>High</option></select></label>
        <label className="form-field">Effort<select value={effort} onChange={(event) => setEffort(event.target.value as Effort)}><option>Small</option><option>Medium</option><option>Large</option></select></label>
        <label className="form-field">Status<select value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)}><option>Open</option><option>In Progress</option><option>Completed</option></select></label>
      </div>
      {formError && <p className="form-error">{formError}</p>}
      <div className="dialog-footer"><button className="button button-quiet" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">{task ? 'Save changes' : 'Create task'}</button></div>
    </form>
  </section></div>
}

function SettingsDialog({ apiKey, setApiKey, saveKey, setSaveKey, onSave, onClose }: {
  apiKey: string
  setApiKey: (key: string) => void
  saveKey: boolean
  setSaveKey: (value: boolean) => void
  onSave: (event: FormEvent) => void
  onClose: () => void
}) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <div className="dialog-header"><div><div className="eyebrow">PREFERENCES</div><h2 id="settings-title">Settings</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><CloseIcon /></button></div>
    <form onSubmit={onSave}>
      <label className="form-field">Gemini API key<input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Paste your Gemini API key" /></label>
      <p className="settings-help">With Gemini enabled, this browser sends your message and current task titles, assignees, due dates, and statuses directly to Gemini to interpret requested actions. Other task details are not included. CommitDesk has no server and never logs your API key.</p>
      <label className="checkbox-row"><input type="checkbox" checked={saveKey} onChange={(event) => setSaveKey(event.target.checked)} /> Save API key in this browser’s local storage</label>
      <div className="security-note"><LockIcon /><span>A locally saved key is stored in browser storage and is not protected like a server-side secret. Leave this unchecked to keep it for this session only.</span></div>
      <div className="dialog-footer"><button className="button button-quiet" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">Save settings</button></div>
    </form>
  </section></div>
}

function seed(title: string, description: string, dueDate: string | null, assignee: string, priority: Priority, effort: Effort, status: TaskStatus): Task {
  return { id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, description, dueDate, requester: null, assignee, priority, effort, status, createdAt: new Date().toISOString() }
}
function makeId() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}` }
function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
function addDays(value: string, days: number) { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + days); return localDate(date) }
function formatDue(value: string | null, overdue: boolean, dueToday: boolean) {
  if (!value) return 'No due date'
  if (dueToday) return 'Due today'
  if (overdue) return `${new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · Overdue`
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
function initials(name: string | null) { return name?.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() ?? '—' }
function avatarTone(name: string | null) { return ['Maya', 'Priya', 'Neha', 'Rahul', 'Omar', 'You'].indexOf(name ?? '') % 5 }

function SettingsIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 7.3a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4Z" /><path d="m16.2 11.2 1.1.9-1.4 2.4-1.4-.5a6.7 6.7 0 0 1-1.4.8l-.3 1.5h-2.8l-.3-1.5a6.7 6.7 0 0 1-1.4-.8l-1.4.5-1.4-2.4 1.1-.9a6 6 0 0 1 0-1.6l-1.1-.9 1.4-2.4 1.4.5a6.7 6.7 0 0 1 1.4-.8l.3-1.5h2.8l.3 1.5a6.7 6.7 0 0 1 1.4.8l1.4-.5 1.4 2.4-1.1.9a6 6 0 0 1 0 1.6Z" /></svg> }
function TrashIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11M8 6V4h4v2m2.8 0-.6 10H5.8L5.2 6m3 3v4m3.6-4v4" /></svg> }
function SparkIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2 1.8 5.2L17 9l-5.2 1.8L10 16l-1.8-5.2L3 9l5.2-1.8L10 2Z" /><path d="m16 13 .8 2.2L19 16l-2.2.8L16 19l-.8-2.2L13 16l2.2-.8L16 13Z" /></svg> }
function ArrowIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 10h12m-5-5 5 5-5 5" /></svg> }
function LockIcon() { return <svg viewBox="0 0 18 18" aria-hidden="true"><rect x="3.5" y="7.5" width="11" height="8" rx="1.5" /><path d="M5.8 7.5V5.4a3.2 3.2 0 0 1 6.4 0v2.1m-3.2 3v2" /></svg> }
function CalendarIcon() { return <svg viewBox="0 0 18 18" aria-hidden="true"><rect x="2.5" y="4" width="13" height="11" rx="1.7" /><path d="M5.5 2.5v3M12.5 2.5v3M2.5 7.2h13" /></svg> }
function SearchIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.7" cy="8.7" r="5.5" /><path d="m13 13 4 4" /></svg> }
function PlusIcon() { return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 3.5v11M3.5 9h11" /></svg> }
function CheckIcon() { return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m3.5 9.5 3.7 3.7 7.4-8" /></svg> }
function EditIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.8 4.2 3 3M4 16l3.4-.7 8.8-8.8a1.8 1.8 0 0 0-2.6-2.6l-8.8 8.8L4 16Z" /></svg> }
function CloseIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg> }

export default App
