import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import '../../src/index.css'
import './demo.css'

// لا تسجيل لـ service worker ولا اتصال بأي خادم: كل البيانات محلية على هذا الجهاز.
ReactDOM.createRoot(document.getElementById('root')).render(
  <HashRouter>
    <App />
  </HashRouter>
)
