import { useState } from 'react'
import { Plus, Volume2, VolumeX } from 'lucide-react'
import type { VoiceChannel } from '../types'
import { useChatStore } from '../store/chatStore'
import { VoiceMemberItem } from './VoiceMemberItem'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'

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
      {/* Section header — aligned to px-3 from sidebar edge (px-2 wrapper + px-1 here) */}
      <div className="flex items-center justify-between px-1 pt-2 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-secondary/70">
          Voice Channels
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-fg-secondary/70 hover:text-fg-primary"
          onClick={() => setShowCreate(!showCreate)}
          aria-label="Create voice channel"
          title="Create voice channel"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Create channel input */}
      {showCreate && (
        <div className="px-1 pb-2">
          <div className="flex gap-1">
            <Input
              placeholder="Channel name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') setShowCreate(false)
              }}
              className="h-8 text-xs"
              autoFocus
            />
            <Button
              size="sm"
              onClick={handleCreate}
              className="h-8 text-xs"
            >
              Add
            </Button>
          </div>
        </div>
      )}

      {/* Channel list */}
      <ul className="bg-card rounded-md overflow-hidden">
        {safeChannels.map((channel, i) => {
          const inThis = isInChannel(channel.id)
          const memberCount = Array.isArray(channel.members) ? channel.members.length : 0
          const members = Array.isArray(channel.members) ? channel.members : []
          return (
            <li key={channel.id}>
              {i > 0 && <Separator />}
              <button
                onClick={() => {
                  if (inThis) {
                    onLeaveChannel()
                  } else {
                    onJoinChannel(channel.id)
                  }
                }}
                className={`w-full flex items-center gap-2 px-2 rounded-none text-left transition min-h-touch ${
                  inThis
                    ? 'bg-brand/15 text-brand'
                    : 'text-fg-secondary hover:bg-accent hover:text-fg-primary'
                }`}
              >
                {memberCount > 0 ? (
                  <Volume2 className="h-4 w-4 shrink-0" />
                ) : (
                  <VolumeX className="h-4 w-4 shrink-0" />
                )}
                <span className="text-xs font-medium truncate">{String(channel.name || 'Voice')}</span>
                {memberCount > 0 && (
                  <span className="text-[10px] text-fg-secondary ml-auto shrink-0">
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
            </li>
          )
        })}
      </ul>
    </div>
  )
}
