import { createContext, useContext, type ReactNode } from 'react'
import type { VoiceMember } from '../types'

export interface AppActions {
  onJoinVoice: (roomId: string, channelId: string, members: VoiceMember[]) => void | Promise<void>
  onLeaveVoice: () => void
  onMuteToggle: (muted: boolean) => void
  onModeChange: (mode: string) => void
  onPTTStart: () => void
  onPTTEnd: () => void
}

const AppActionsContext = createContext<AppActions | null>(null)

interface ProviderProps {
  value: AppActions
  children: ReactNode
}

export function AppActionsProvider({ value, children }: ProviderProps) {
  return <AppActionsContext.Provider value={value}>{children}</AppActionsContext.Provider>
}

export function useAppActions(): AppActions {
  const ctx = useContext(AppActionsContext)
  if (!ctx) throw new Error('useAppActions must be used inside <AppActionsProvider>')
  return ctx
}
