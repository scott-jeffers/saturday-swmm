import { forwardRef } from 'react'
import { Button, type ButtonProps } from './Button'
import { cn } from '../../lib/cn'

export interface IconButtonProps extends ButtonProps {
  label: string
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, className, size = 'icon', ...props }, ref) => (
    <Button
      ref={ref}
      size={size}
      aria-label={label}
      title={label}
      className={cn(className)}
      {...props}
    />
  ),
)
IconButton.displayName = 'IconButton'
