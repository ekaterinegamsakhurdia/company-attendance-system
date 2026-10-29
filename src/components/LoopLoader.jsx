import LoopArt from './LoopArt';

/**
 * Shown while the app really is loading (signing in, fetching a page of code). It only fades in after a short
 * moment, so quick loads never flash it, and it never delays anything: it is just the loop running.
 */
export default function LoopLoader({ label = 'Loading…' }) {
  return (
    <div className="la-loader" role="status">
      <LoopArt run stroke={3} />
      <span className="la-sr">{label}</span>
    </div>
  );
}
