import { useState } from 'react';
import { avatarUrl } from '../services/api';

export const initialsOf = (person) =>
  `${(person?.first_name || '?').trim()[0] ?? '?'}${(person?.last_name || '').trim()[0] ?? ''}`.toUpperCase();

/** Round profile picture; falls back to the person's initials when there is no photo (or it fails to load). */
export default function Avatar({ person, path, size = 'md' }) {
  const url = avatarUrl(path);
  const [failed, setFailed] = useState(null);
  const showPhoto = url && failed !== url;
  return (
    <span className={`la-avatar ${size}${showPhoto ? ' photo' : ''}`} aria-hidden="true">
      {showPhoto ? <img src={url} alt="" onError={() => setFailed(url)} /> : initialsOf(person)}
    </span>
  );
}
