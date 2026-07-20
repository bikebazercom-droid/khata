import * as React from "react"
import { X as Cross2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

export type ToastProps = React.ComponentPropsWithoutRef<"li"> & {
  variant?: "default" | "destructive"
  onOpenChange?: (open: boolean) => void
  open?: boolean
}

export type ToastActionElement = React.ReactElement

const Toast = React.forwardRef<HTMLLIElement, ToastProps>(
  ({ className, variant, onOpenChange, open = true, ...props }, ref) => {
    if (!open) return null
    return (
      <li
        ref={ref}
        className={cn(
          "group pointer-events-auto relative flex w-full items-center justify-between space-x-2 overflow-hidden rounded-md border p-4 pr-6 shadow-lg transition-all",
          variant === "destructive" ? "destructive group border-destructive bg-destructive text-destructive-foreground" : "bg-background",
          className
        )}
        {...props}
      >
        {props.children}
        <button
          type="button"
          className="absolute right-1 top-1 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-1 group-hover:opacity-100"
          onClick={() => onOpenChange?.(false)}
        >
          <Cross2Icon className="h-4 w-4" />
        </button>
      </li>
    )
  }
)
Toast.displayName = "Toast"

export { Toast }
