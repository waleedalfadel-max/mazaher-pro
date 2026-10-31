import { createClaudeProxyHandler, READING_UPSTREAM_TIMEOUT_MS } from './_claudeProxy.js'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb',
    },
  },
}

// تحليل المستندات والكشوف — يتطلب مستخدماً موثّقاً عضواً بمنشأة، ويتحقق من أن
// رد المزوّد JSON قبل إعادته. المهلة منسّقة مع maxDuration في vercel.json (انظر _claudeProxy.js)
export default createClaudeProxyHandler({ name: 'analyze', validateJson: true, upstreamTimeoutMs: READING_UPSTREAM_TIMEOUT_MS })
