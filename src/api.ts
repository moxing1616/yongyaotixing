export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...options, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...options.headers },
    })
  } catch { throw new ApiError('无法连接服务，请检查网络后重试。', 0) }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(body.error || '操作未完成，请稍后重试。', response.status)
  return body.data as T
}
export const post = <T>(path: string, data: unknown = {}) => api<T>(path, { method: 'POST', body: JSON.stringify(data) })
export const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试。'
