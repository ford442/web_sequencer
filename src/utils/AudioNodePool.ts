export class AudioNodePool {
    private context: BaseAudioContext;
    private name: string;
    private options: AudioWorkletNodeOptions | undefined;
    private pool: AudioWorkletNode[] = [];
    private maxPoolSize: number;
    private isWorkletReady: boolean = false;

    constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions, maxPoolSize: number = 32) {
        this.context = context;
        this.name = name;
        this.options = options;
        this.maxPoolSize = maxPoolSize;

        // Ensure worklet is loaded before allowing pool instantiation
        try {
            // @ts-ignore
            new AudioWorkletNode(this.context, this.name, this.options);
            this.isWorkletReady = true;
        } catch (e) {
            this.isWorkletReady = false;
        }
    }

    acquire(parameterData?: Record<string, number>): AudioWorkletNode | null {
        if (!this.isWorkletReady) {
             // Fallback: If not ready initially, try again
            try {
                // @ts-ignore
                new AudioWorkletNode(this.context, this.name, this.options);
                this.isWorkletReady = true;
            } catch (e) {
                return null;
            }
        }

        let node: AudioWorkletNode;
        if (this.pool.length > 0) {
            node = this.pool.pop()!;
        } else {
            node = new AudioWorkletNode(this.context, this.name, this.options);
        }

        // Apply dynamic parameters if provided
        if (parameterData) {
            for (const key in parameterData) {
                const param = node.parameters.get(key);
                if (param) {
                    param.value = parameterData[key];
                }
            }
        }

        return node;
    }

    release(node: AudioWorkletNode) {
        node.disconnect();
        // Zero out state via teardown message if supported by the worklet
        node.port.postMessage({ type: 'TEARDOWN' });

        if (this.pool.length < this.maxPoolSize) {
            this.pool.push(node);
        } else {
            // Let it be garbage collected
        }
    }
}
