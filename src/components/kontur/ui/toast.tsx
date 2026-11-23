"use client"

import * as React from "react"
import * as ToastPrimitives from "@radix-ui/react-toast"
import { cva, type VariantProps } from "class-variance-authority"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/kontur/utils"

const toastVariants = cva(
  "group data-[swipe=move]:transition-none bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=cancel]:translate-x-0 data-[swipe=end]:animate-out data-[swipe=end]:slide-out-to-right-full grid grid-cols-[auto_max-content]-auto relative items-center gap-x-3 gap-y-0.5 rounded-lg border p-4 pr-8 shadow-lg duration-200 data-[swipe=move]:duration-0 sm:grid-cols-[auto_max-content_max-content]",
  {
    variants: {
      variant: {
        default: "border",
        destructive: "border-destructive bg-destructive text-destructive-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function ToastProvider({ ...props }: React.ComponentProps<typeof ToastPrimitives.Provider>) {
  return <ToastPrimitives.Provider data-slot="toast-provider" {...props} />
}

function Toast({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof ToastPrimitives.Root> & VariantProps<typeof toastVariants>) {
  return (
    <ToastPrimitives.Root
      data-slot="toast"
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  )
}

function ToastAction({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitives.Action>) {
  return (
    <ToastPrimitives.Action
      data-slot="toast-action"
      className={cn(
        "ring-offset-background hover:bg-secondary focus:ring-ring group-[.destructive]:border-muted/40 group-[.destructive]:hover:border-destructive/30 group-[.destructive]:hover:bg-destructive group-[.destructive]:hover:text-destructive-foreground group-[.destructive]:focus:ring-destructive rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function ToastClose({ className, ...props }: React.ComponentProps<typeof ToastPrimitives.Close>) {
  return (
    <ToastPrimitives.Close
      data-slot="toast-close"
      className={cn(
        "group-[.destructive]:text-red-300 hover:text-foreground absolute top-2 right-2 flex size-4 items-center justify-center rounded-md opacity-0 transition-all group-hover:opacity-100 focus:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-none group-[.destructive]:hover:text-red-50",
        className
      )}
      toast-close=""
      {...props}
    >
      <XIcon className="size-4" />
    </ToastPrimitives.Close>
  )
}

function ToastTitle({ className, ...props }: React.ComponentProps<typeof ToastPrimitives.Title>) {
  return (
    <ToastPrimitives.Title
      data-slot="toast-title"
      className={cn("text-sm font-semibold leading-none", className)}
      {...props}
    />
  )
}

function ToastDescription({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitives.Description>) {
  return (
    <ToastPrimitives.Description
      data-slot="toast-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

// Типы для парного хука use-toast (совместимость классического shadcn-контура)
export type ToastProps = React.ComponentProps<typeof Toast>
export type ToastActionElement = React.ReactElement<typeof ToastAction>

export { Toast, ToastAction, ToastClose, ToastDescription, ToastProvider, ToastTitle }
