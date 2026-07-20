import * as React from "react"
import { cn } from "@/lib/utils"

export const TooltipProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>
export const Tooltip = ({ children }: { children: React.ReactNode }) => <>{children}</>
export const TooltipTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(({ className, ...props }, ref) => <button ref={ref} className={className} {...props} />)
export const TooltipContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => <div ref={ref} className={cn("z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95", className)} {...props} />)
