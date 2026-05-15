import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { X } from 'lucide-react'

import { useSettingsStore } from '../store/settingsStore'
import { useChatStore } from '../store/chatStore'
import { KeyBindingCapture } from './KeyBindingCapture'
import { VoiceSettings } from './VoiceSettings'
import { useTheme, type Theme } from '../hooks/useTheme'

import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Separator } from '@/components/ui/separator'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

import { profileSchema, type ProfileValues } from '@/lib/forms/profile'
import { meshSchema, type MeshValues } from '@/lib/forms/mesh'

const DEFAULT_DEVICE_SENTINEL = '__default__'

interface Props {
  onClose: () => void
  send: (type: string, data: any) => void
}

interface DeviceInfo {
  deviceId: string
  label: string
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold text-fg-secondary uppercase tracking-wider">
      {children}
    </h2>
  )
}

export function SettingsPage({ onClose, send }: Props) {
  const displayName = useChatStore((s) => s.displayName)
  const setDisplayName = useChatStore((s) => s.setDisplayName)

  const micDeviceId = useSettingsStore((s) => s.micDeviceId)
  const speakerDeviceId = useSettingsStore((s) => s.speakerDeviceId)
  const pttKey = useSettingsStore((s) => s.pttKey)
  const inputVolume = useSettingsStore((s) => s.inputVolume)
  const preferredTransport = useSettingsStore((s) => s.preferredTransport)
  const setMicDevice = useSettingsStore((s) => s.setMicDevice)
  const setSpeakerDevice = useSettingsStore((s) => s.setSpeakerDevice)
  const setPttKey = useSettingsStore((s) => s.setPttKey)
  const setInputVolume = useSettingsStore((s) => s.setInputVolume)
  const setPreferredTransport = useSettingsStore((s) => s.setPreferredTransport)
  const protomapsApiKey = useSettingsStore((s) => s.protomapsApiKey)
  const setProtomapsApiKey = useSettingsStore((s) => s.setProtomapsApiKey)
  const locationEnabled = useSettingsStore((s) => s.locationEnabled)
  const setLocationEnabled = useSettingsStore((s) => s.setLocationEnabled)
  const backgroundMode = useSettingsStore((s) => s.backgroundMode)
  const setBackgroundMode = useSettingsStore((s) => s.setBackgroundMode)

  const { theme, setTheme } = useTheme()

  const [audioInputs, setAudioInputs] = useState<DeviceInfo[]>([])
  const [audioOutputs, setAudioOutputs] = useState<DeviceInfo[]>([])

  // Enumerate audio devices
  useEffect(() => {
    async function loadDevices() {
      try {
        // Request permission first so labels are populated
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach((t) => t.stop())

        const devices = await navigator.mediaDevices.enumerateDevices()
        setAudioInputs(
          devices
            .filter((d) => d.kind === 'audioinput')
            .map((d) => ({
              deviceId: d.deviceId,
              label: d.label || `Microphone ${d.deviceId.slice(0, 8)}`,
            }))
        )
        setAudioOutputs(
          devices
            .filter((d) => d.kind === 'audiooutput')
            .map((d) => ({
              deviceId: d.deviceId,
              label: d.label || `Speaker ${d.deviceId.slice(0, 8)}`,
            }))
        )
      } catch {
        // Mic permission denied -- show empty lists
      }
    }
    loadDevices()
  }, [])

  // --- Profile form ---
  const profileForm = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName },
  })

  function onProfileSubmit(values: ProfileValues) {
    const trimmed = values.displayName.trim()
    if (trimmed && trimmed !== displayName) {
      setDisplayName(trimmed)
      send('set_name', { name: trimmed })
    }
  }

  // --- Network (Mesh) form ---
  const meshForm = useForm<MeshValues>({
    resolver: zodResolver(meshSchema),
    defaultValues: {
      preferredTransport: (preferredTransport as MeshValues['preferredTransport']) ?? 'tcp',
      backgroundMode: backgroundMode ?? false,
    },
  })

  function onMeshSubmit(values: MeshValues) {
    setPreferredTransport(values.preferredTransport)
    send('set_preferred_transport', { transport: values.preferredTransport })
    setBackgroundMode(values.backgroundMode)
  }

  return (
    <div className="fixed inset-0 z-50 bg-surface-canvas flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 bg-surface-2 flex items-center justify-between border-b border-border-subtle shrink-0">
        <h1 className="text-lg font-semibold text-fg-primary">Settings</h1>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close settings">
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Single-page scrollable content */}
      <ScrollArea className="flex-1">
        <div className="max-w-lg mx-auto px-4 py-6 space-y-10">

          {/* ── Theme ── */}
          <section className="space-y-4">
            <SectionHeader>Display Theme</SectionHeader>
            <RadioGroup
              value={theme}
              onValueChange={(v) => setTheme(v as Theme)}
              className="gap-3"
            >
              <div className="flex items-center gap-3 min-h-touch">
                <RadioGroupItem value="dark" id="theme-dark" />
                <Label htmlFor="theme-dark" className="text-fg-primary cursor-pointer">
                  Dark
                </Label>
              </div>
              <div className="flex items-center gap-3 min-h-touch">
                <RadioGroupItem value="light" id="theme-light" />
                <Label htmlFor="theme-light" className="text-fg-primary cursor-pointer">
                  Light
                </Label>
              </div>
              <div className="flex items-center gap-3 min-h-touch">
                <RadioGroupItem value="ld" id="theme-ld" />
                <Label htmlFor="theme-ld" className="text-fg-primary cursor-pointer">
                  Low Detection
                </Label>
              </div>
            </RadioGroup>
            <p className="text-fg-tertiary text-xs">
              Persists across sessions. Low-detection follows DIG stealth-mode rules (red on black, no blue).
            </p>
          </section>

          <Separator />

          {/* ── Profile ── */}
          <section className="space-y-4">
            <SectionHeader>Profile</SectionHeader>
            <Form {...profileForm}>
              <form onSubmit={profileForm.handleSubmit(onProfileSubmit)} className="space-y-4">
                <FormField
                  control={profileForm.control}
                  name="displayName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Display Name</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input
                            {...field}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                profileForm.handleSubmit(onProfileSubmit)()
                              }
                            }}
                            placeholder="Enter display name"
                          />
                        </FormControl>
                        <Button
                          type="submit"
                          disabled={
                            !profileForm.formState.isDirty ||
                            profileForm.formState.isSubmitting
                          }
                        >
                          Save
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </form>
            </Form>
          </section>

          <Separator />

          {/* ── Audio Input ── */}
          <section className="space-y-4">
            <SectionHeader>Audio Input</SectionHeader>
            <div className="space-y-2">
              <Label htmlFor="mic-select" className="text-fg-primary">Microphone</Label>
              <Select
                value={micDeviceId || DEFAULT_DEVICE_SENTINEL}
                onValueChange={(v) =>
                  setMicDevice(v === DEFAULT_DEVICE_SENTINEL ? '' : v)
                }
              >
                <SelectTrigger id="mic-select" className="w-full">
                  <SelectValue placeholder="System Default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_DEVICE_SENTINEL}>System Default</SelectItem>
                  {audioInputs.map((d) => (
                    <SelectItem key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-fg-primary">
                Input Volume ({Math.round(inputVolume * 100)}%)
              </Label>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[inputVolume]}
                onValueChange={([v]) => setInputVolume(v)}
              />
            </div>
          </section>

          <Separator />

          {/* ── Audio Output ── */}
          <section className="space-y-4">
            <SectionHeader>Audio Output</SectionHeader>
            <div className="space-y-2">
              <Label htmlFor="speaker-select" className="text-fg-primary">Speaker</Label>
              <Select
                value={speakerDeviceId || DEFAULT_DEVICE_SENTINEL}
                onValueChange={(v) =>
                  setSpeakerDevice(v === DEFAULT_DEVICE_SENTINEL ? '' : v)
                }
              >
                <SelectTrigger id="speaker-select" className="w-full">
                  <SelectValue placeholder="System Default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_DEVICE_SENTINEL}>System Default</SelectItem>
                  {audioOutputs.map((d) => (
                    <SelectItem key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>

          <Separator />

          {/* ── Voice ── */}
          <section className="space-y-4">
            <SectionHeader>Voice</SectionHeader>
            <VoiceSettings />
            <div className="space-y-2 pt-4">
              <Label className="text-fg-primary">PTT Key (keyboard)</Label>
              <div className="flex items-center gap-3 min-h-touch">
                <KeyBindingCapture currentKey={pttKey} onCapture={setPttKey} />
                <span className="text-xs text-fg-secondary">
                  Hold this key to transmit voice (PTT mode)
                </span>
              </div>
            </div>
          </section>

          <Separator />

          {/* ── Network ── */}
          <section className="space-y-4">
            <SectionHeader>Network</SectionHeader>
            <Form {...meshForm}>
              <form onSubmit={meshForm.handleSubmit(onMeshSubmit)} className="space-y-6">
                <FormField
                  control={meshForm.control}
                  name="preferredTransport"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Preferred Transport</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="tcp">TCP — stable internet connection</SelectItem>
                          <SelectItem value="wifi-direct">WiFi Direct — peer-to-peer, no internet needed</SelectItem>
                          <SelectItem value="btle">BLE — lowest power, shortest range</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Preferred network path for mesh connections. Default priority: TCP &gt; WiFi Direct &gt; BLE.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={meshForm.control}
                  name="backgroundMode"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-3 min-h-touch">
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className="cursor-pointer">
                          Keep Mesh Alive in Background
                        </FormLabel>
                      </div>
                      <FormDescription>
                        Runs a foreground service to keep BLE, WiFi Direct, and the Rust server alive (Android only)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  disabled={!meshForm.formState.isDirty || meshForm.formState.isSubmitting}
                  className="w-full"
                >
                  Save Network Settings
                </Button>
              </form>
            </Form>
          </section>

          <Separator />

          {/* ── Map ── */}
          <section className="space-y-4">
            <SectionHeader>Map</SectionHeader>
            <div className="space-y-2">
              <Label htmlFor="protomaps-key" className="text-fg-primary">Protomaps API Key</Label>
              <Input
                id="protomaps-key"
                type="text"
                value={protomapsApiKey}
                onChange={(e) => setProtomapsApiKey(e.target.value)}
                placeholder="Get a free key at protomaps.com"
                className="font-mono"
              />
              <p className="text-xs text-fg-tertiary">Required for tactical map tiles</p>
            </div>

            <div className="space-y-2">
              <Label className="text-fg-primary">Share Location</Label>
              <div className="flex items-center gap-3 min-h-touch">
                <Switch
                  checked={locationEnabled}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      // Trigger geolocation from user gesture so iOS prompts
                      navigator.geolocation.getCurrentPosition(
                        () => setLocationEnabled(true),
                        (err) => {
                          console.warn('Geolocation denied:', err.message)
                          alert('Location access denied. Enable location in your browser/OS settings.')
                        },
                        { enableHighAccuracy: true, timeout: 10000 }
                      )
                    } else {
                      setLocationEnabled(false)
                    }
                  }}
                />
                <span className="text-xs text-fg-secondary">
                  {locationEnabled
                    ? 'Broadcasting position to room'
                    : 'Location sharing off'}
                </span>
              </div>
              <p className="text-xs text-fg-tertiary">
                When enabled, your GPS position is shared with room members on the tactical map
              </p>
            </div>
          </section>

        </div>
      </ScrollArea>
    </div>
  )
}
