import { createPortal } from 'react-dom';

/**
 * Renders a child's primary action into the wizard's shared bottom bar.
 * The button keeps living in the child (state, disabled and busy semantics stay there);
 * only its DOM position moves. Renders nothing until the bar slot element exists.
 */
export default function InSlot({ slot, children }) {
  return slot ? createPortal(children, slot) : null;
}
