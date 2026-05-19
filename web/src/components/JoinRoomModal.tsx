import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { joinRoomSchema, type JoinRoomInput } from '@/lib/forms/join-room'
import { useSend } from '@/lib/WebSocketContext'
import { useChatStore } from '../store/chatStore'

export function JoinRoomModal() {
  const send = useSend()
  const setMenuRoute = useChatStore((s) => s.setMenuRoute)

  const form = useForm<JoinRoomInput>({
    resolver: zodResolver(joinRoomSchema),
    defaultValues: { name: '' },
    mode: 'onChange',
  })

  function handleJoin(values: JoinRoomInput) {
    const name = values.name.trim()
    if (!name) return
    send('join_room', { name })
    setMenuRoute('home')
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <p className="text-sm text-fg-secondary">Enter the name of the room you want to join.</p>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleJoin)} className="space-y-4">
          <FormField
            name="name"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Room name</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Room name" autoFocus />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={() => setMenuRoute('home')}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!form.formState.isValid}
            >
              Join
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}
