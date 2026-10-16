export type Priority = 'Low' | 'Medium' | 'High'
export type Effort = 'Small' | 'Medium' | 'Large'
export type TaskStatus = 'Open' | 'In Progress' | 'Completed'

export interface Task {
  id: string
  title: string
  description: string
  dueDate: string | null
  requester: string | null
  assignee: string | null
  priority: Priority
  effort: Effort
  status: TaskStatus
  createdAt: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  source?: 'ai' | 'local'
}

export interface TaskAction {
  type: 'complete' | 'reopen' | 'update'
  taskTitle: string
  changes?: Partial<Pick<Task, 'title' | 'description' | 'dueDate' | 'requester' | 'assignee' | 'priority' | 'effort' | 'status'>>
}

export interface ParseResult {
  tasks: Omit<Task, 'id' | 'createdAt'>[]
  actions: TaskAction[]
  reply: string
  needsClarification?: string
}
