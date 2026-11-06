export type MascotMood = 'oops' | 'happy' | 'calm';

/** "Oops", Oopsie's mascot — same face as the extension icon. */
export function Mascot({ size = 40, mood = 'oops', className = '' }: { size?: number; mood?: MascotMood; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`mascot mascot--${mood} ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="6" y="10" width="88" height="86" rx="22" fill="#F2A811" />
      <rect x="6" y="7" width="88" height="86" rx="22" fill="#FFC93C" />
      <ellipse cx="27" cy="60" rx="7" ry="4.5" fill="#FF966E" opacity="0.85" />
      <ellipse cx="73" cy="60" rx="7" ry="4.5" fill="#FF966E" opacity="0.85" />
      {mood === 'calm' ? (
        <>
          <path d="M29 43 q6 -6 12 0" stroke="#2B2118" strokeWidth="4.5" fill="none" strokeLinecap="round" />
          <path d="M59 43 q6 -6 12 0" stroke="#2B2118" strokeWidth="4.5" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <ellipse className="mascot__eye" cx="35" cy="43" rx="5.5" ry="7.5" fill="#2B2118" />
          <ellipse className="mascot__eye" cx="65" cy="43" rx="5.5" ry="7.5" fill="#2B2118" />
        </>
      )}
      {mood === 'oops' ? (
        <circle cx="50" cy="66" r="6.5" stroke="#2B2118" strokeWidth="4.5" fill="none" />
      ) : (
        <path d="M40 63 q10 10 20 0" stroke="#2B2118" strokeWidth="4.5" fill="none" strokeLinecap="round" />
      )}
      {mood === 'oops' && <path d="M84 13 q5 8 0 11 q-5 -3 0 -11z" fill="#56AAEB" />}
    </svg>
  );
}
