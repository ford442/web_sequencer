// A Lock-Free, Single-Producer, Single-Consumer (SPSC) Ring Buffer.
// Designed for use with AudioWorklets, where the main thread is the producer
// and the AudioWorklet is the consumer.

const HEAD_INDEX = 0;
const TAIL_INDEX = 1;

export class RingBuffer {
    readonly sab: SharedArrayBuffer;
    private readonly atomicIndices: Int32Array;
    private readonly buffer: Float32Array;
    private readonly bufferSize: number;

    constructor(sab: SharedArrayBuffer);
    constructor(size: number);
    constructor(arg: number | SharedArrayBuffer) {
        if (typeof arg === 'number') {
            const size = arg;
            if (size & (size - 1)) {
                throw new Error("RingBuffer size must be a power of two.");
            }
            this.sab = new SharedArrayBuffer(
                (2 * Int32Array.BYTES_PER_ELEMENT) + (size * Float32Array.BYTES_PER_ELEMENT)
            );
        } else {
            this.sab = arg;
        }

        this.atomicIndices = new Int32Array(this.sab, 0, 2);
        this.buffer = new Float32Array(this.sab, 2 * Int32Array.BYTES_PER_ELEMENT);
        this.bufferSize = this.buffer.length;
    }

    // Producer side (main thread)
    push(data: Float32Array): number {
        const head = Atomics.load(this.atomicIndices, HEAD_INDEX);
        const tail = Atomics.load(this.atomicIndices, TAIL_INDEX);

        const availableToWrite = this.bufferSize - (head - tail);
        if (data.length > availableToWrite) {
            return 0; // Not enough space
        }

        const headIndex = head & (this.bufferSize - 1);
        const toWrite = Math.min(data.length, this.bufferSize - headIndex);

        this.buffer.set(data.subarray(0, toWrite), headIndex);
        this.buffer.set(data.subarray(toWrite), 0);

        Atomics.store(this.atomicIndices, HEAD_INDEX, head + data.length);
        return data.length;
    }

    // Consumer side (AudioWorklet)
    pull(data: Float32Array): number {
        const head = Atomics.load(this.atomicIndices, HEAD_INDEX);
        const tail = Atomics.load(this.atomicIndices, TAIL_INDEX);

        const availableToRead = head - tail;
        if (availableToRead === 0) {
            return 0; // Buffer is empty
        }

        const toRead = Math.min(data.length, availableToRead);
        const tailIndex = tail & (this.bufferSize - 1);
        const fromRead = Math.min(toRead, this.bufferSize - tailIndex);

        data.set(this.buffer.subarray(tailIndex, tailIndex + fromRead));
        data.set(this.buffer.subarray(0, toRead - fromRead), fromRead);

        Atomics.store(this.atomicIndices, TAIL_INDEX, tail + toRead);
        return toRead;
    }

    availableRead(): number {
        const head = Atomics.load(this.atomicIndices, HEAD_INDEX);
        const tail = Atomics.load(this.atomicIndices, TAIL_INDEX);
        return head - tail;
    }
}
