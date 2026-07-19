import { execSync } from 'child_process'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

// Build
console.log('🔨 Building...')
execSync('npm run build', { stdio: 'inherit' })

// Deploy to Vercel prod and capture deployment URL
console.log('\n🚀 Deploying to Vercel...')
const output = execSync('vercel --prod --yes 2>&1', {
  env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
  encoding: 'utf8',
})
console.log(output)

// Extract the deployment URL (tahseeb-xxxx-mazaher-s-projects.vercel.app)
const match = output.match(/https:\/\/(tahseeb-[a-z0-9]+-mazaher-s-projects\.vercel\.app)/)
if (match) {
  const deployUrl = match[1]
  console.log(`\n🔗 Pointing tahseeb-pro.vercel.app → ${deployUrl}`)
  execSync(`vercel alias set ${deployUrl} tahseeb-pro.vercel.app`, {
    env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    stdio: 'inherit',
  })
  console.log('\n✅ Done! https://tahseeb-pro.vercel.app is live')
} else {
  console.warn('⚠️  Could not extract deployment URL — update alias manually')
}
