// The Worker receives "start" and "stop" messages and emits "tick" messages.
// This decouples the timing from the main thread's visual rendering loop.

let timerID: number | null = null;
let interval = 25.0; // milliseconds

self.onmessage = (e: MessageEvent) => {
    if (e.data === 'start') {
        if (e.data.interval) interval = e.data.interval;
        if (timerID) clearInterval(timerID);

        // Start the timer
        timerID = self.setInterval(() => {
            self.postMessage('tick');
        }, interval);
    }
    else if (e.data === 'stop') {
        if (timerID) {
            clearInterval(timerID);
            timerID = null;
        }
    }
    else if (e.data.interval) {
        // Allow updating interval while running (though usually we just stop/start)
        interval = e.data.interval;
        if (timerID) {
            clearInterval(timerID);
            timerID = self.setInterval(() => {
                self.postMessage('tick');
            }, interval);
        }
    }
};
