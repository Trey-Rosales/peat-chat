import { useEffect, useRef, useCallback } from 'react'
import { useSettingsStore } from '../store/settingsStore'
import { useChatStore } from '../store/chatStore'

export interface GeoPosition {
  lat: number
  lon: number
  hae: number
  ce: number
}

export function useGeolocation(send: (type: string, data: any) => void) {
  const locationEnabled = useSettingsStore((s) => s.locationEnabled)
  const watchIdRef = useRef<number | null>(null)
  const positionRef = useRef<GeoPosition | null>(null)

  const sendPosition = useCallback(() => {
    const pos = positionRef.current
    const activeRoomId = useChatStore.getState().activeRoomId
    if (!pos || !activeRoomId) return
    send('cot_position', {
      room_id: activeRoomId,
      lat: pos.lat,
      lon: pos.lon,
      hae: pos.hae,
      ce: pos.ce,
      cot_type: 'a-f-G-U-C',
    })
  }, [send])

  useEffect(() => {
    if (!locationEnabled || !navigator.geolocation) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      positionRef.current = null
      return
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        positionRef.current = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          hae: pos.coords.altitude ?? 0,
          ce: pos.coords.accuracy,
        }
        sendPosition()
      },
      (err) => {
        console.warn('Geolocation error:', err.message)
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000,
      }
    )

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [locationEnabled, sendPosition])

  return positionRef
}
