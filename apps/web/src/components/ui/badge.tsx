import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badge = cva('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', {
  variants: {
    tone: {
      neutral: 'bg-muted text-muted-foreground',
      good: 'bg-success/15 text-success',
      warn: 'bg-warning/15 text-warning',
      bad: 'bg-destructive/15 text-destructive',
      brand: 'bg-primary/15 text-primary',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export const Badge = ({ className, tone, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) => (
  <span className={cn(badge({ tone }), className)} {...p} />
);
