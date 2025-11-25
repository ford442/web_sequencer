import { useState, useEffect, useRef, useCallback } from 'react';

// Define the types for communication
export type Role = 'master' | 'renderer';

export interface RenderRequest {
  type: 'RENDER_REQUEST';
  stepId: number;
  track: string;
  note: string;
  params: any;
  duration: number;
  targetTime: number;
}

export interface AudioResponse {
  type: 'AUDIO_RESPONSE';
  stepId: number;
  track: string;
  audioData: Float32Array;
}

const CHANNEL_NAME = 'electribe_sync_v1';

export const useDistributedAudio = () => {
  const [role, setRole] = useState<Role>('master');
  const channel = useRef<BroadcastChannel | null>(null);

  const onRenderRequestHandler = useRef<(req: RenderRequest) => Promise<Float32Array | null>>(async () => null);
  const onAudioReceivedHandler = useRef<(res: AudioResponse) => void>(() => {});

  useEffect(() => {
    channel.current = new BroadcastChannel(CHANNEL_NAME);

    const handleMessage = async (event: MessageEvent) => {
      const { data } = event;

      if (role === 'renderer' && data.type === 'RENDER_REQUEST') {
        const req = data as RenderRequest;
        const audioData = await onRenderRequestHandler.current(req);
        if (audioData && channel.current) {
          const response: AudioResponse = {
            type: 'AUDIO_RESPONSE',
            stepId: req.stepId,
            track: req.track,
            audioData,
          };
          channel.current.postMessage(response);
        }
      }

      if (role === 'master' && data.type === 'AUDIO_RESPONSE') {
        const res = data as AudioResponse;
        onAudioReceivedHandler.current(res);
      }
    };

    channel.current.addEventListener('message', handleMessage);

    return () => {
      channel.current?.removeEventListener('message', handleMessage);
      channel.current?.close();
    };
  }, [role]);

  const sendRenderRequest = useCallback((req: Omit<RenderRequest, 'type'>) => {
    if (channel.current && role === 'master') {
      const fullRequest: RenderRequest = { ...req, type: 'RENDER_REQUEST' };
      channel.current.postMessage(fullRequest);
    }
  }, [role]);

  const setRenderRequestHandler = useCallback((handler: (req: RenderRequest) => Promise<Float32Array | null>) => {
    onRenderRequestHandler.current = handler;
  }, []);

  const setAudioReceivedHandler = useCallback((handler: (res: AudioResponse) => void) => {
    onAudioReceivedHandler.current = handler;
  }, []);

  return {
    role,
    setRole,
    sendRenderRequest,
    setRenderRequestHandler,
    setAudioReceivedHandler,
  };
};
