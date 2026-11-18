import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost' | 'outline'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const variantClass: Record<ButtonVariant, string> = {
  default: 'bg-elevated border-border-strong text-fg hover:bg-fg/5',
  primary: 'bg-accent border-accent text-white hover:bg-accent-strong hover:border-accent-strong',
  danger: 'bg-danger border-danger text-white hover:opacity-90',
  ghost: 'bg-transparent border-transparent text-fg-soft hover:bg-fg/[0.06] hover:text-fg',
  outline: 'bg-transparent border-border-strong text-fg-soft hover:bg-fg/[0.04] hover:text-fg',
}

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
  lg: 'h-9 px-4 text-sm gap-2 rounded-md',
  icon: 'h-8 w-8 p-0 rounded-md justify-center',
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
        active && 'bg-accent/15 border-accent/40 text-accent-soft',
        className,
      )}
      {...props}
    />
  ),
)
Button.displayName = 'Button'
