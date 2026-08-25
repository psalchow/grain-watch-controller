import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

/**
 * Minimal modal dialog: a full-screen overlay with a centred panel.
 * Clicking the overlay or the close button calls onClose.
 *
 * Rendered through a portal into the document body: an ancestor carrying
 * `backdrop-filter`, `filter` or `transform` — the sticky header does — becomes
 * the containing block for fixed positioning, which would shrink the overlay to
 * that ancestor's box instead of the viewport.
 */
export function Dialog({ open, onClose, title, children }: DialogProps) {
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className={cn(
          'w-full max-w-md rounded-lg border bg-card text-card-foreground shadow-lg',
          // Taller dialogs (the user forms) must not run off a phone screen —
          // dvh accounts for the browser chrome that vh ignores.
          'max-h-[calc(100dvh-2rem)] overflow-y-auto'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            // Negative margin keeps the layout while the padding grows the
            // touch target to ~40px, which a thumb can actually hit.
            className="-m-2 p-2 text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}
