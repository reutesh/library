import { useEffect, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

// How many modals are open — the page stays locked until the last one closes
let openModals = 0;
let lockedScrollY = 0;

/**
 * Stops the page behind a modal from scrolling. `overflow: hidden` alone isn't
 * enough on iOS Safari, so the body is pinned in place and the scroll position
 * restored on close.
 */
function lockPageScroll() {
  if (openModals++ > 0) return;
  lockedScrollY = window.scrollY;
  const hasScrollbar = window.innerWidth > document.documentElement.clientWidth;
  const { style } = document.body;
  style.position = 'fixed';
  style.top = `-${lockedScrollY}px`;
  style.width = '100%';
  // Keep the scrollbar's space so the page doesn't jump sideways
  if (hasScrollbar) style.overflowY = 'scroll';
}

function unlockPageScroll() {
  if (--openModals > 0) return;
  const { style } = document.body;
  style.position = '';
  style.top = '';
  style.width = '';
  style.overflowY = '';
  window.scrollTo(0, lockedScrollY);
}

export default function Modal({ title, onClose, children, wide }: ModalProps) {
  useEffect(() => {
    lockPageScroll();
    return unlockPageScroll;
  }, []);

  return (
    <div className="modal" onClick={onClose}>
      <div className={wide ? 'modal-content modal-wide' : 'modal-content'} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="סגור">
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}