import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-[1rem] text-sm font-semibold transition-[background-color,color,border-color,box-shadow,transform] duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-primary/50 bg-primary text-primary-foreground shadow-[0_2px_0_rgba(0,0,0,0.18),0_20px_40px_-20px_rgba(245,200,0,0.72)] hover:-translate-y-0.5 hover:bg-primary/92 active:translate-y-px",
        secondary:
          "border border-white/12 bg-white/6 text-foreground hover:bg-white/10",
        ghost: "text-foreground hover:bg-white/7",
        outline:
          "border border-white/16 bg-transparent text-foreground hover:border-primary/35 hover:bg-white/6",
        destructive:
          "border border-destructive/45 bg-destructive/12 text-destructive hover:bg-destructive/18",
        gold:
          "border border-primary/50 bg-primary text-primary-foreground shadow-[0_2px_0_rgba(0,0,0,0.2),0_12px_28px_rgba(245,200,0,0.22)] hover:-translate-y-0.5 hover:bg-primary/92 hover:shadow-[0_2px_0_rgba(0,0,0,0.2),0_18px_34px_rgba(245,200,0,0.3)] active:scale-[0.985] disabled:grayscale-[0.5]",
        "outline-light":
          "border border-white/30 bg-transparent text-white/85 hover:-translate-y-0.5 hover:border-primary/55 hover:bg-white/10 data-[selected=true]:border-primary data-[selected=true]:bg-primary/15 data-[selected=true]:text-primary",
      },
      size: {
        default: "px-4 py-2.5",
        sm: "min-h-10 rounded-[0.9rem] px-3 py-2 text-xs",
        lg: "min-h-14 rounded-[1.1rem] px-6 py-3.5 text-base",
        icon: "h-11 w-11 rounded-full",
        block: "min-h-14 w-full rounded-[1.1rem] px-6 py-3.5 text-base font-bold tracking-[0.02em]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
