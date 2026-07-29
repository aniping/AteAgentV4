interface BrandMarkProps {
  size?: number;
}

export function BrandMark({ size = 36 }: BrandMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className="ate-brand-mark"
      focusable="false"
      height={size}
      viewBox="0 0 46 46"
      width={size}
    >
      <rect fill="#fb3a4e" x="0.5" y="0.5" width="45" height="45" rx="10" />
      <path d="M11.4 34.4 22.8 10.6 34.4 34.4" fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.7" />
      <path d="M9.6 29.1h6.5l3.1-5.9 5.1 11.1 5.3-8.8h7.8" fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.7" />
      <circle fill="#fff" cx="36.7" cy="34.2" r="2.8" />
    </svg>
  );
}
