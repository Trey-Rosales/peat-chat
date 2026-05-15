import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from 'flowbite-react'
import App from './App'
import { flowbiteTheme } from './styles/flowbite-theme'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={flowbiteTheme}>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
)
