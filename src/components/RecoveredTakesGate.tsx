import React, { Suspense, lazy, useEffect, useState } from 'react';
import { hasTakesFolder } from '@/audio/recording/recordingSupport';

const RecoveredTakesNotice = lazy(() => import('./RecoveredTakesNotice'));

/**
 * Mounted by App (#1498 P1): after boot settles, looks for an OPFS `takes/`
 * folder and only then loads the unfinished-take notice and the recorder, so
 * an origin that never recorded pays one directory lookup.
 */
export const RecoveredTakesGate: React.FC = React.memo(() => {
    const [show, setShow] = useState(false);
    useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(() => {
            void hasTakesFolder().then((yes) => { if (!cancelled) setShow(yes); });
        }, 1500);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, []);
    return show ? <Suspense fallback={null}><RecoveredTakesNotice /></Suspense> : null;
});
