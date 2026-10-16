import type { Effort, ParseResult, Priority, Task, TaskStatus } from '../types/task'

const priorities: Priority[] = ['Low', 'Medium', 'High']
const efforts: Effort[] = ['Small', 'Medium', 'Large']
const statuses: TaskStatus[] = ['Open', 'In Progress', 'Completed']

export async function parseWithGemini(text: string, apiKey: string, currentTasks: Task[]): Promise<ParseResult> {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{
          text: `You are CommitDesk, a careful meeting commitment parser and task manager. Use today's local date (${localDate()}) to resolve explicit relative dates. Do not invent people, deadlines, priority, effort, or commitments. Defaults: priority Medium, effort Medium, status Open. Use the supplied board-task context only to identify explicitly requested task actions; never create a task from that context. If multiple existing tasks could match an instruction, set needsClarification and make no action for it. Return JSON only with this schema: {"tasks":[{"title":"string","description":"string","dueDate":"YYYY-MM-DD or null","requester":"string or null","assignee":"string or null","priority":"Low|Medium|High","effort":"Small|Medium|Large","status":"Open|In Progress|Completed"}],"actions":[{"type":"complete|reopen|update","taskTitle":"existing task title or distinctive phrase","changes":{"priority":"Low|Medium|High","assignee":"string","dueDate":"YYYY-MM-DD or null","status":"Open|In Progress|Completed"}}],"reply":"brief explanation","needsClarification":"question or omitted"}. Use actions only for explicit changes to existing tasks. Do not create tasks for questions, summaries, or show/list requests.`
        }],
      },
      contents: [{
        role: 'user',
        parts: [
          { text: `User message:\n${text}` },
          { text: `Current board task context for identifying explicit actions only:\n${JSON.stringify(currentTasks.map(({ title, assignee, dueDate, status }) => ({ title, assignee, dueDate, status })))}` },
        ],
      }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    }),
  })

  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Gemini request failed (${response.status}). Check your API key and network connection, then retry.`)
  }
  const payload: unknown = await response.json()
  const content = getGeminiText(payload)
  let decoded: unknown
  try {
    decoded = JSON.parse(content)
  } catch {
    throw new Error('Gemini returned invalid JSON. Retry the request or check your API key.')
  }
  return validateParseResult(decoded)
}

export function parseLocally(text: string): ParseResult {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  if (/\b(show|list|find)\b/.test(lower) && /\boverdue\b/.test(lower)) {
    return { tasks: [], actions: [], reply: 'I’ve highlighted overdue tasks on the board. Use the filters to narrow the list.' }
  }

  const completeMatch = trimmed.match(/(?:mark|set|complete|finish)\s+(?:the\s+)?(.+?)\s+(?:task\s+)?(?:as\s+)?(?:completed|complete|done)\.?$/i)
  if (completeMatch) {
    return { tasks: [], actions: [{ type: 'complete', taskTitle: cleanTitle(completeMatch[1]) }], reply: `I’ll mark “${cleanTitle(completeMatch[1])}” complete if it matches a task on your board.` }
  }

  const priorityMatch = trimmed.match(/(?:change|set)\s+(.+?)\s+priority\s+to\s+(low|medium|high)\.?$/i)
  if (priorityMatch) {
    const phrase = cleanTitle(priorityMatch[1])
    return {
      tasks: [],
      actions: [{ type: 'update', taskTitle: phrase, changes: { priority: titleCase(priorityMatch[2]) as Priority } }],
      reply: `I’ll update the priority for “${phrase}” if it matches a task on your board.`,
    }
  }

  if (/^(?:add|create)\s+(?:a\s+)?task\b/i.test(trimmed)) {
    const cleaned = trimmed.replace(/^(?:add|create)\s+(?:a\s+)?task(?:\s+to)?\s+/i, '')
    const parsed = parseTaskClause(cleaned)
    if (parsed) return { tasks: [parsed], actions: [], reply: `Added “${parsed.title}” to your task board.` }
  }

  const clauses = trimmed
    .replace(/\n+/g, '. ')
    .split(/[.!?]+/)
    .map((clause) => clause.trim().replace(/^(?:and|also|then)\s+/i, ''))
    .filter(Boolean)
  const tasks = clauses.map(parseTaskClause).filter((task): task is NonNullable<typeof task> => task !== null)
  if (tasks.length) {
    return {
      tasks,
      actions: [],
      reply: `I found ${tasks.length} ${tasks.length === 1 ? 'commitment' : 'commitments'} using the local parser. Review the task details; natural-language extraction is more limited without a Gemini API key.`,
    }
  }
  return {
    tasks: [],
    actions: [],
    reply: 'I couldn’t confidently turn that into a task locally. Try “Add a task to …”, describe a clear commitment, or configure a Gemini API key in Settings.',
  }
}

export function validateParseResult(value: unknown): ParseResult {
  if (!value || typeof value !== 'object') throw new Error('The parser returned an invalid response. No changes were applied.')
  const result = value as Record<string, unknown>
  if (!Array.isArray(result.tasks) || !Array.isArray(result.actions) || typeof result.reply !== 'string') {
    throw new Error('The parser response did not match the required task schema. No changes were applied.')
  }
  const tasks = result.tasks.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('A parsed task was invalid. No changes were applied.')
    const task = item as Record<string, unknown>
    if (typeof task.title !== 'string' || !task.title.trim()
      || typeof task.description !== 'string'
      || !(typeof task.dueDate === 'string' || task.dueDate === null)
      || !(typeof task.requester === 'string' || task.requester === null)
      || !(typeof task.assignee === 'string' || task.assignee === null)
      || !priorities.includes(task.priority as Priority)
      || !efforts.includes(task.effort as Effort)
      || !statuses.includes(task.status as TaskStatus)
      || (typeof task.dueDate === 'string' && !isISODate(task.dueDate))) {
      throw new Error('A parsed task had invalid or missing fields. No changes were applied.')
    }
    return {
      title: task.title.trim(),
      description: task.description.trim(),
      dueDate: task.dueDate as string | null,
      requester: task.requester as string | null,
      assignee: task.assignee as string | null,
      priority: task.priority as Priority,
      effort: task.effort as Effort,
      status: task.status as TaskStatus,
    }
  })
  const actions = result.actions.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('A parsed action was invalid. No changes were applied.')
    const action = item as Record<string, unknown>
    if (!['complete', 'reopen', 'update'].includes(String(action.type)) || typeof action.taskTitle !== 'string' || !action.taskTitle.trim()) {
      throw new Error('A parsed action had invalid fields. No changes were applied.')
    }
    let changes: import('../types/task').TaskAction['changes']
    if (action.type === 'update') {
      if (!action.changes || typeof action.changes !== 'object') {
        throw new Error('A parsed update had no changes. No changes were applied.')
      }
      const rawChanges = action.changes as Record<string, unknown>
      const allowedKeys = ['title', 'description', 'dueDate', 'requester', 'assignee', 'priority', 'effort', 'status']
      if (Object.keys(rawChanges).some((key) => !allowedKeys.includes(key))
        || Object.keys(rawChanges).length === 0
        || (rawChanges.title !== undefined && typeof rawChanges.title !== 'string')
        || (rawChanges.description !== undefined && typeof rawChanges.description !== 'string')
        || (rawChanges.dueDate !== undefined && rawChanges.dueDate !== null && (typeof rawChanges.dueDate !== 'string' || !isISODate(rawChanges.dueDate)))
        || (rawChanges.requester !== undefined && rawChanges.requester !== null && typeof rawChanges.requester !== 'string')
        || (rawChanges.assignee !== undefined && rawChanges.assignee !== null && typeof rawChanges.assignee !== 'string')
        || (rawChanges.priority !== undefined && !priorities.includes(rawChanges.priority as Priority))
        || (rawChanges.effort !== undefined && !efforts.includes(rawChanges.effort as Effort))
        || (rawChanges.status !== undefined && !statuses.includes(rawChanges.status as TaskStatus))) {
        throw new Error('A parsed update contained invalid task fields. No changes were applied.')
      }
      changes = Object.fromEntries(allowedKeys.filter((key) => rawChanges[key] !== undefined).map((key) => [key, rawChanges[key]])) as import('../types/task').TaskAction['changes']
    }
    return {
      type: action.type as 'complete' | 'reopen' | 'update',
      taskTitle: action.taskTitle,
      ...(changes ? { changes } : {}),
    }
  })
  if (result.needsClarification !== undefined && typeof result.needsClarification !== 'string') {
    throw new Error('The parser returned an invalid clarification. No changes were applied.')
  }
  return { tasks, actions, reply: result.reply, needsClarification: result.needsClarification as string | undefined }
}

function parseTaskClause(clause: string): ParseResult['tasks'][number] | null {
  const text = clause.trim().replace(/^[,;\s]+|[,;\s]+$/g, '')
  if (!text || /\b(?:discuss|show|list|find|what|how|when|maybe|might|could|should we)\b/i.test(text) && !/\b(?:will|needs to|should|must|assigned to)\b/i.test(text)) return null
  const selfAssignment = text.match(/^(i(?:'ll| will)|we(?:'ll| will))\s+(.+)$/i)
  const namedAssignment = text.match(/^(?:(?:during|in)\s+.+?,\s*)?(.+?)\s+(?:will|needs to|need to|should|must|is going to)\s+(.+)$/i)
  let assignee: string | null = null
  let actionText = text
  if (selfAssignment) {
    assignee = /^i(?:'ll| will)$/i.test(selfAssignment[1]) ? 'Me' : null
    actionText = selfAssignment[2].trim()
  } else if (namedAssignment) {
    assignee = cleanName(namedAssignment[1])
    actionText = namedAssignment[2].trim()
  } else if (/^(?:review|finish|complete|prepare|investigate|update|fix|create|write|send|deploy|document|follow up|coordinate|test|deliver|build|implement|check|schedule|organize)\b/i.test(text)) {
    actionText = text
  } else {
    return null
  }
  actionText = actionText.replace(/^(?:to\s+)?(?:finish|complete|work on|handle|take care of)\s+/i, '')
  const dueDate = extractDate(actionText)
  const cleaned = dueDate
    ? actionText.replace(/\b(?:(?:by|before|on|due)\s+)?(?:today|tomorrow|next\s+\w+|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/ig, '')
    : actionText
  const title = cleanTitle(cleaned)
  if (!title) return null
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    description: text !== actionText ? text : '',
    dueDate,
    requester: null,
    assignee,
    priority: /\b(urgent|critical|blocker|asap)\b/i.test(text) ? 'High' : 'Medium',
    effort: 'Medium',
    status: 'Open',
  }
}

function extractDate(text: string): string | null {
  const lower = text.toLowerCase()
  const today = new Date()
  if (/\btoday\b/.test(lower)) return localDate(today)
  if (/\btomorrow\b/.test(lower)) {
    today.setDate(today.getDate() + 1)
    return localDate(today)
  }
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const match = lower.match(/\b(?:(next)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)
  if (match) {
    const target = dayNames.indexOf(match[2])
    let diff = (target - today.getDay() + 7) % 7
    if (match[1]) diff += 7
    today.setDate(today.getDate() + diff)
    return localDate(today)
  }
  return null
}

function cleanTitle(value: string) {
  return value.replace(/\b(?:but we haven't decided on a deadline yet|but no deadline yet)\b/i, '')
    .replace(/\b(?:by|before|on|due)\s+(?:today|tomorrow|next\s+\w+|\w+day|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/ig, '')
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/[\s,;:.]+$/, '')
    .trim()
}

function cleanName(value: string) {
  return value.replace(/^(?:during today's meeting,\s*)/i, '').trim().replace(/\b\w/g, (char) => char.toUpperCase())
}

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function isISODate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

function getGeminiText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') throw new Error('Gemini returned an empty response.')
  const candidates = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates
  const text = candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('')
  if (!text) throw new Error('Gemini returned no task data. Retry the request.')
  return text
}
