import * as React from 'react';
import { cn } from '@/lib/utils';

/** Etiqueta + control + error de validación. El control recibe el id para que la etiqueta sea accesible. */
export function Field({ label, error, hint, htmlFor, className, children }: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      className,
    )}
    {...props}
  />
));
Select.displayName = 'Select';
