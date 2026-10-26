import { useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { useToast } from './Toast';
import Avatar from './Avatar';
import { PillButton } from './ui';
import { removeAvatar, uploadAvatar } from '../services/api';
import { squareJpeg } from '../lib/image';

/** Photo row: current picture + "Upload photo" / "Remove". Changes are saved straight away. */
export default function PhotoEditor({ employee, path, onChanged }) {
  const toast = useToast();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);

  async function pick(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const blob = await squareJpeg(file);
      await uploadAvatar(employee, blob, path);
      toast.success('Photo saved.');
      await onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await removeAvatar(employee, path);
      toast.success('Photo removed.');
      await onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="la-photo-edit">
      <Avatar person={employee} path={path} size="xl" />
      <div className="la-photo-actions">
        <div className="la-photo-buttons">
          <PillButton variant="secondary" size="sm" icon={Camera} onClick={() => input.current?.click()} disabled={busy}>
            {busy ? 'Saving…' : path ? 'Change photo' : 'Upload photo'}
          </PillButton>
          {path && (
            <PillButton variant="ghost" size="sm" icon={Trash2} onClick={remove} disabled={busy}>
              Remove
            </PillButton>
          )}
        </div>
        <p className="la-meta">JPEG, PNG or WebP. It is cropped to a square.</p>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="la-sr" aria-label="Choose a photo" tabIndex={-1} onChange={pick} />
      </div>
    </div>
  );
}
