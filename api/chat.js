import { createClaudeProxyHandler } from './_claudeProxy.js'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
}

// غير مستدعاة من التطبيق حالياً لكنها مكشوفة — تحمل نفس اشتراط الهوية والعضوية
export default createClaudeProxyHandler({ name: 'chat' })
