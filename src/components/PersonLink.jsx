import { useProfileCard } from '../hooks/useProfileCard';

/** A person's name; for CEOs and developers it opens their profile card. Elsewhere it is plain text. */
export default function PersonLink({ id, children }) {
  const card = useProfileCard();
  if (!card || !id) return children;
  return (
    <button type="button" className="la-person" onClick={() => card.open(id)}>
      {children}
    </button>
  );
}
