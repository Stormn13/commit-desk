import type { ChatMessage, Task } from '../types/task'

const TASKS_KEY = 'commitdesk.tasks.v1'
const CHAT_KEY = 'commitdesk.chat.v1'
const API_KEY_KEY = 'commitdesk.geminiKey.v1'
const SAVE_KEY_KEY = 'commitdesk.saveKey.v1'

export function readTasks(): Task[] | null {
  try {
    const raw = localStorage.getItem(TASKS_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) && value.every(isTask) ? value : null
  } catch {
    return null
  }
}

export function saveTasks(tasks: Task[]) {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks))
}

export function readChat(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_KEY)
    if (!raw) return []
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) && value.every(isMessage) ? value : []
  } catch {
    return []
  }
}

export function saveChat(messages: ChatMessage[]) {
  localStorage.setItem(CHAT_KEY, JSON.stringify(messages))
}

export function readSavedApiKey(): { key: string; save: boolean } {
  try {
    return {
      key: localStorage.getItem(API_KEY_KEY) ?? '',
      save: localStorage.getItem(SAVE_KEY_KEY) === 'true',
    }
  } catch {
    return { key: '', save: false }
  }
}

export function saveApiKey(key: string, save: boolean) {
  if (save) {
    localStorage.setItem(API_KEY_KEY, key)
    localStorage.setItem(SAVE_KEY_KEY, 'true')
  } else {
    localStorage.removeItem(API_KEY_KEY)
    localStorage.removeItem(SAVE_KEY_KEY)
  }
}

function isTask(value: unknown): value is Task {
  if (!value || typeof value !== 'object') return false
  const task = value as Record<string, unknown>
  return typeof task.id === 'string'
    && typeof task.title === 'string'
    && typeof task.description === 'string'
    && (typeof task.dueDate === 'string' && isISODate(task.dueDate) || task.dueDate === null)
    && (typeof task.requester === 'string' || task.requester === null)
    && (typeof task.assignee === 'string' || task.assignee === null)
    && ['Low', 'Medium', 'High'].includes(String(task.priority))
    && ['Small', 'Medium', 'Large'].includes(String(task.effort))
    && ['Open', 'In Progress', 'Completed'].includes(String(task.status))
    && typeof task.createdAt === 'string'
}

function isISODate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function isMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  return typeof message.id === 'string'
    && (message.role === 'user' || message.role === 'assistant')
    && typeof message.content === 'string'
    && (message.source === undefined || message.source === 'ai' || message.source === 'local')
}
