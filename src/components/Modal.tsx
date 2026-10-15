import type { ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

export default function Modal({ title, onClose, children, wide }: ModalProps) {
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