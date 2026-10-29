// The Looper mark: the two O's of the wordmark drawn as one infinity loop (a figure eight lying on its side).
// `LOOP_PATH` is one closed path in a 120 x 60 box; the clock-in animation draws and runs along the same path.
export const LOOP_PATH = 'M60 30 C73 12 102 10 102 30 C102 50 73 48 60 30 C47 12 18 10 18 30 C18 50 47 48 60 30 Z';

export default function LooperMark({ size = 18, stroke = 11, className = '', title }) {
  return (
    <svg
      className={`la-mark ${className}`}
      viewBox="0 0 120 60"
      width={size * 2}
      height={size}
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
      focusable="false"
    >
      <path d={LOOP_PATH} stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
