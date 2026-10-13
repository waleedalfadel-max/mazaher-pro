// مدخل نموذج التصميم. مستقل عن src/main.jsx: لا Supabase، ولا /api، ولا قراءة آلية، ولا عامل خدمة.
import { installNetworkGuard } from './networkGuard.js'
import React from 'react'
import ReactDOM from 'react-dom/client'
import '../ui/fonts.js'
import '../ui/theme.css'
import '../ui/frame.css'
import './prototype.css'
import App from './App.jsx'

installNetworkGuard()

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
