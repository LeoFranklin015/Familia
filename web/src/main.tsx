import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// App supplies the desktop handset frame itself — see components/Device.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
