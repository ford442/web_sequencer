
/* eslint-disable no-restricted-globals */
// Clock Worker
// Handles the scheduling tick to ensure steady timing off the main thread.

let timerID: number | null = null;
let interval = 25.0; // ms

self.onmessage = (e) => {
    if (e.data === 'start') {
        if (e.data.interval) interval = e.data.interval;
        timerID = self.setInterval(() => {
            self.postMessage('tick');
        }, interval);
    } else if (e.data === 'stop') {
        if (timerID !== null) {
            self.clearInterval(timerID);
            timerID = null;
        }
    } else if (e.data.interval) {
        // Update interval on the fly if needed (though usually we just restart)
        interval = e.data.interval;
        if (timerID !== null) {
            self.clearInterval(timerID);
            timerID = self.setInterval(() => {
                self.postMessage('tick');
            }, interval);
        }
    }
};

export {};
