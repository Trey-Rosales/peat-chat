import { useState } from 'react'
import type { VoiceChannel } from '../types'
import { useChatStore } from '../store/chatStore'
import { VoiceMemberItem } from './VoiceMemberItem'

interface Props {
  roomId: string
  channels: VoiceChannel[]
  onJoinChannel: (channelId: string) => void
  onLeaveChannel: () => void
  onCreateChannel: (name: string) => void
}

export function VoiceChannelList({
  roomId,
  channels,
  onJoinChannel,
  onLeaveChannel,
  onCreateChannel,
}: Props) {
  const userId = useChatStore((s) => s.userId)
  const activeVoice = useChatStore((s) => s.activeVoice)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const safeChannels = Array.isArray(channels) ? channels : []

  const isInChannel = (channelId: string) =>
    activeVoice?.roomId === roomId && activeVoice?.channelId === channelId

  const handleCreate = () => {
    const trimmed = newName.trim()
    if (trimmed) {
      onCreateChannel(trimmed)
      setNewName('')
      setShowCreate(false)
    }
  }

  return (
    <div className="px-2 pb-2">
      {/* Section header */}
      <div className="flex items-center justify-between px-2 pt-2 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-pl-text-sec/70">
          Voice Channels
        </span>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-pl-text-sec/70 hover:text-pl-text transition p-0.5 rounded"
          title="Create voice channel"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {/* Create channel input */}
      {showCreate && (
        <div className="px-2 pb-2">
          <div className="flex gap-1">
            <input
              type="text"
              placeholder="Channel name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') setShowCreate(false)
              }}
              className="flex-1 bg-pl-input text-pl-text text-xs rounded px-2 py-1 placeholder-pl-text-sec"
              autoFocus
            />
            <button
              onClick={handleCreate}
              className="text-xs text-pl-accent px-2 py-1 rounded hover:bg-pl-hover"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Channel list */}
      {safeChannels.map((channel) => {
        const inThis = isInChannel(channel.id)
        const memberCount = Array.isArray(channel.members) ? channel.members.length : 0
        const members = Array.isArray(channel.members) ? channel.members : []
        return (
          <div key={channel.id} className="mb-1">
            <button
              onClick={() => {
                if (inThis) {
                  onLeaveChannel()
                } else {
                  onJoinChannel(channel.id)
                }
              }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition ${
                inThis
                  ? 'bg-pl-accent/15 text-pl-accent'
                  : 'text-pl-text-sec hover:bg-pl-hover hover:text-pl-text'
              }`}
            >
              {/* Speaker icon */}
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="shrink-0"
              >
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                {memberCount > 0 && (
                  <>
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </>
                )}
              </svg>
              <span className="text-xs font-medium truncate">{String(channel.name || 'Voice')}</span>
              {memberCount > 0 && (
                <span className="text-[10px] text-pl-text-sec ml-auto shrink-0">
                  {memberCount}
                </span>
              )}
            </button>

            {/* Members in this channel */}
            {memberCount > 0 && (
              <div className="ml-4 mt-0.5">
                {members.map((member) => (
                  <VoiceMemberItem
                    key={member.id}
                    member={member}
                    isSelf={member.id === userId}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
