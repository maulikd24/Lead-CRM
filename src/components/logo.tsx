export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M9 20.5L13.5 15L17.5 18.5L23 11.5"
        stroke="var(--primary-foreground)"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M19 11.5H23V15.5" stroke="var(--primary-foreground)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
