import { cn } from "../../lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-[1rem] bg-white/8", className)}
      {...props}
    />
  );
}

export { Skeleton };
