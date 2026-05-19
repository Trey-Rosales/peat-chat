'use client'

import * as React from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'

import { cn } from '@/lib/utils'

function Drawer({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />
}

function DrawerTrigger(props: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerPortal(props: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />
}

function DrawerClose(props: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn(
        'fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out',
        className,
      )}
      {...props}
    />
  )
}

function DrawerContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPortal>
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 flex h-full flex-col rounded-t-2xl border border-border-subtle bg-surface-1/95 backdrop-blur-md',
          className,
        )}
        {...props}
      >
        <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-border-default" />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  )
}

function DrawerHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="drawer-header" className={cn('grid gap-1 p-3', className)} {...props} />
}

function DrawerFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="drawer-footer" className={cn('mt-auto flex flex-col gap-2 p-3', className)} {...props} />
}

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn('text-sm font-semibold text-fg-primary', className)}
      {...props}
    />
  )
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn('text-xs text-fg-secondary', className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
