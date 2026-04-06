import type { ChatMessage } from '../types'

interface Props {
  message: ChatMessage
  isSelf: boolean
  showSender: boolean
}

export function MessageBubble({ message, isSelf, showSender }: Props) {
  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className={`flex ${isSelf ? 'justify-end' : 'justify-start'} ${showSender ? 'mt-2' : 'mt-0.5'}`}>
      <div
        className={`max-w-[85%] md:max-w-[65%] rounded-lg px-3 py-1.5 ${
          isSelf
            ? 'bg-pl-sent rounded-tr-sm'
            : 'bg-pl-received rounded-tl-sm'
        }`}
      >
        {showSender && !isSelf && (
          <div className="text-xs font-medium text-pl-accent mb-0.5">
            {message.sender_name}
          </div>
        )}
        <div className="text-sm text-pl-text whitespace-pre-wrap break-words">
          {message.content}
        </div>
        <div className="text-[10px] text-pl-text-sec text-right mt-0.5 -mb-0.5">
          {time}
        </div>
      </div>
    </div>
  )
}
