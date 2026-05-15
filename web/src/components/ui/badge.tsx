import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-hidden focus:ring-2 focus:ring-ring",
  {
    variants: {
      variant: {
        default:     "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:   "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline:     "text-foreground",
        // DTAK-specific status variants (mirrors old StatusPill API):
        info:                "border-transparent bg-status-info     text-fg-on-brand",
        success:             "border-transparent bg-status-success  text-fg-on-brand",
        warning:             "border-transparent bg-status-warning  text-fg-primary",
        critical:            "border-transparent bg-status-critical text-fg-on-brand",
        count:               "border-transparent bg-status-critical text-fg-on-brand",
        "cot-friendly":      "border-transparent bg-cot-friendly    text-fg-on-brand",
        "cot-hostile":       "border-transparent bg-cot-hostile     text-fg-on-brand",
        "cot-neutral":       "border-transparent bg-cot-neutral     text-fg-primary",
        "cot-unknown":       "border-transparent bg-cot-unknown     text-fg-primary",
        "transport-wifi":    "border-transparent bg-transport-wifi    text-fg-on-brand",
        "transport-ble":     "border-transparent bg-transport-ble     text-fg-on-brand",
        "transport-relay":   "border-transparent bg-transport-relay   text-fg-primary",
        "transport-offline": "border-transparent bg-transport-offline text-fg-on-brand",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
