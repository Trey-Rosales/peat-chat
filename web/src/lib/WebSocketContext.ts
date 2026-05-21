import { createContext, useContext } from 'react'

export type SendFn = (type: string, data: unknown) => void

export const WebSocketContext = createContext<SendFn | null>(null)

export function useSend(): SendFn {
  const send = useContext(WebSocketContext)
  if (!send) throw new Error('useSend must be used within a WebSocketContext.Provider')
  return send
}
