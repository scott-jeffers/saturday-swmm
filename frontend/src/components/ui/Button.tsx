import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost' | 'outline'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const variantClass: Record<ButtonVariant, string> = {
  default:
    'bg-elevated border-border-strong text-fg hover:bg-border/60 hover:border-muted',
  primary:
    'bg-accent-strong border-accent text-white hover:bg-accent shadow-sm shadow-accent/20',
  danger: 'bg-danger-bg border-danger/60 text-white hover:bg-danger/80',
  ghost: 'bg-transparent border-transparent text-fg-soft hover:bg-border/50 hover:text-fg',
  outline:
    'bg-transparent border-border-strong text-fg-soft hover:border-accent hover:text-fg',
}

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1.5 rounded-lg',
  md: 'h-9 px-3 text-sm gap-2 rounded-lg',
  lg: 'h-10 px-4 text-sm gap-2 rounded-xl',
  icon: 'h-9 w-9 p-0 rounded-lg justify-center',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  active?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'default',
      size = 'md',
      active = false,
      type = 'button',
      disabled,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center border font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        'disabled:opacity-45 disabled:pointer-events-none',
        variantClass[variant],
        sizeClass[size],
        active && 'bg-accent border-accent-soft text-surface',
        className,
      )}
      {...props}
    />
  ),
)
Button.displayName = 'Button'
