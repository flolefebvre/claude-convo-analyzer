// The wrapper every Suspense fallback's skeleton sits in: skeletons carry no
// text, so `role="status"` and a label are what names the loading region, for
// screen readers and for the `instant()` specs. `status` is a live region:
// render this only as a `<Suspense>` fallback, never around settled content,
// or assistive tech hears every update.

/**
 * A labelled loading region, the fallback of one `<Suspense>` boundary.
 *
 * @example
 * <Suspense fallback={<LoadingRegion label="Loading tools"><Skeleton className="h-64" /></LoadingRegion>}>
 */
export function LoadingRegion({
  label,
  className,
  children,
}: {
  /** What is loading, e.g. "Loading conversations". */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-label={label} className={className}>
      {children}
    </div>
  );
}
