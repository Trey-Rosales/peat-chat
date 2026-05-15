import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

export default function PrimitiveScratch() {
  return (
    <div className="p-8 space-y-4 bg-background text-foreground min-h-screen">
      <h2 className="text-lg font-semibold">Primitives — Scratch</h2>
      <section className="space-y-2">
        <h3 className="text-sm uppercase text-fg-tertiary">Button</h3>
        <div className="flex gap-2 flex-wrap">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="link">Link</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button size="icon">★</Button>
        </div>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm uppercase text-fg-tertiary">Input</h3>
        <Input placeholder="Type here..." className="max-w-sm" />
        <Input placeholder="Disabled" disabled className="max-w-sm" />
      </section>
      <section className="space-y-2">
        <h3 className="text-sm uppercase text-fg-tertiary">Label</h3>
        <Label htmlFor="x">A label</Label>
        <Input id="x" placeholder="Paired with label above" className="max-w-sm" />
      </section>
      <section className="space-y-2">
        <h3 className="text-sm uppercase text-fg-tertiary">Separator</h3>
        <div>Above</div>
        <Separator />
        <div>Below</div>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm uppercase text-fg-tertiary">Badge</h3>
        <div className="flex gap-2 flex-wrap">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="critical">Critical</Badge>
          <Badge variant="count">Count</Badge>
          <Badge variant="cot-friendly">Friendly</Badge>
          <Badge variant="cot-hostile">Hostile</Badge>
          <Badge variant="cot-neutral">Neutral</Badge>
          <Badge variant="cot-unknown">Unknown</Badge>
          <Badge variant="transport-wifi">WiFi</Badge>
          <Badge variant="transport-ble">BLE</Badge>
          <Badge variant="transport-relay">Relay</Badge>
          <Badge variant="transport-offline">Offline</Badge>
        </div>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm uppercase text-fg-tertiary">Card</h3>
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>Title</CardTitle>
            <CardDescription>Description text</CardDescription>
          </CardHeader>
          <CardContent>Body content goes here.</CardContent>
          <CardFooter><Button size="sm">Action</Button></CardFooter>
        </Card>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm uppercase text-fg-tertiary">Textarea</h3>
        <Textarea placeholder="Write a remark..." className="max-w-sm" />
      </section>
      <section className="space-y-2">
        <h3 className="text-sm uppercase text-fg-tertiary">Skeleton</h3>
        <div className="space-y-2 max-w-sm">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-12 w-12 rounded-full" />
        </div>
      </section>
    </div>
  )
}
