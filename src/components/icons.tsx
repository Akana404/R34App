/**
 * Inline stroke icons (currentColor, 1.75px). Kept local instead of pulling in
 * an icon package — the set is small and each icon ships as plain markup.
 */
type IconProps = { className?: string };

function Svg({
  className = "size-4",
  children,
  fill = "none",
}: IconProps & { children: React.ReactNode; fill?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  );
}

export function SortIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 4v14" />
      <path d="m4 7 3-3 3 3" />
      <path d="M17 20V6" />
      <path d="m14 17 3 3 3-3" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Svg>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5 10.1 12.8 4.5 10.9 10.1 9z" />
      <path d="M18.5 3.5v3M20 5h-3" />
    </Svg>
  );
}

export function HeartIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <Svg {...props} fill={filled ? "currentColor" : "none"}>
      <path d="M12 20s-7.5-4.4-7.5-9.4A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 3C19.5 15.6 12 20 12 20Z" />
    </Svg>
  );
}

export function SimilarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 9c1.8-2.4 3.5-2.4 5.3 0s3.5 2.4 5.3 0 3.5-2.4 5.4 0" />
      <path d="M4 15c1.8-2.4 3.5-2.4 5.3 0s3.5 2.4 5.3 0 3.5-2.4 5.4 0" />
    </Svg>
  );
}

export function ShuffleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h3.2c1.2 0 2.3.6 3 1.6l3.6 5.4c.7 1 1.8 1.6 3 1.6H20" />
      <path d="M4 17h3.2c1.2 0 2.3-.6 3-1.6l.9-1.3M15.9 9.3l.9-1.3c.7-1 1.8-1.6 3-1.6H20" />
      <path d="m17.5 3.5 2.5 2.5-2.5 2.5M17.5 13.5 20 16l-2.5 2.5" />
    </Svg>
  );
}

export function SlidersIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
      <circle cx="16" cy="8" r="2" />
      <circle cx="10" cy="16" r="2" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </Svg>
  );
}

export function StarIcon(props: IconProps) {
  return (
    <Svg {...props} fill="currentColor">
      <path
        d="m12 4.5 2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1L4.5 10l5.2-.8z"
        strokeWidth={1}
      />
    </Svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props} fill="currentColor">
      <path d="M8 5.5v13l11-6.5z" strokeWidth={1} />
    </Svg>
  );
}

/** Grid density switch: one wide column vs. two narrow ones. */
export function SingleColumnIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="7" rx="1.5" />
      <rect x="4" y="13" width="16" height="7" rx="1.5" />
    </Svg>
  );
}

export function TwoColumnsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="7" height="16" rx="1.5" />
      <rect x="13" y="4" width="7" height="16" rx="1.5" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m14.5 5-7 7 7 7" />
    </Svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9.5 5 7 7-7 7" />
    </Svg>
  );
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 5h5v5M19 5l-7.5 7.5" />
      <path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </Svg>
  );
}

export function NotInterestedIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="m6.5 6.5 11 11" />
    </Svg>
  );
}
