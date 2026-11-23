import React, { useContext } from 'react';
import { createPortal } from 'react-dom';
import { ChassisDeckContext } from './chassisContext';

/**
 * Renders its children in the chassis deck under the oscillator knobs when one is open, and in
 * place (where it sits in the tree) otherwise. Tall pickers such as the 303 voice list live in
 * the narrow overlay column over the knobs, where they are clipped by the 380px stage; in a
 * chassis they move to the full-width deck. A portal keeps their state, handlers and context.
 */
export const ChassisDeckPortal = ({ children }: { children: React.ReactNode }) => {
    const deck = useContext(ChassisDeckContext);
    return deck ? createPortal(children, deck) : <>{children}</>;
};
