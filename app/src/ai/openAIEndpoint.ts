import type { AIProviderProfile } from '../domain/models'

export function resolveOpenAIEndpoint(
  baseUrl: string,
  mode: AIProviderProfile['endpointMode'] = 'auto',
): string {
  const url = new URL(baseUrl.trim())
  if (url.username || url.password || url.hash) {
    throw new Error('地址不能包含账号、密码或 fragment')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('真实 API 必须使用 HTTPS；仅本机地址允许 HTTP')
  }
  const path = url.pathname.replace(/\/+$/u, '')
  if (mode === 'full_endpoint' && !path.endsWith('/chat/completions')) {
    throw new Error('完整 Endpoint 必须以 /chat/completions 结尾')
  }
  const finalPath = mode === 'full_endpoint' || path.endsWith('/chat/completions') && mode === 'auto'
    ? path
    : mode === 'api_root'
      ? `${path}/v1/chat/completions`
      : mode === 'v1_base' || path.endsWith('/v1')
        ? `${path}/chat/completions`
        : path ? `${path}/chat/completions` : '/v1/chat/completions'
  url.pathname = finalPath.replace(/\/+/gu, '/')
  return url.toString()
}
