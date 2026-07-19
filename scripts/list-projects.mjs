import { createClient } from '@supabase/supabase-js'
const supabase = createClient(
  'https://dnuxevxxgmgptptmuzdy.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRudXhldnh4Z21ncHRwdG11emR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MjY1OTAsImV4cCI6MjA5NTEwMjU5MH0.o7lx6HiTU8a3XPF501WNFYk7NOxfYoBrphqVunhOk2s'
)
const { data } = await supabase.from('projects').select('id,name')
data?.forEach(p => console.log(p.id, ' ', p.name))
