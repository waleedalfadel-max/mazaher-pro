import { createClaudeProxyHandler } from './_claudeProxy.js'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb',
    },
  },
}

// تحليل المستندات والكشوف — يتطلب مستخدماً موثّقاً عضواً بمنشأة، ويتحقق من أن
// رد المزوّد JSON قبل إعادته
export default createClaudeProxyHandler({ name: 'analyze', validateJson: true })
