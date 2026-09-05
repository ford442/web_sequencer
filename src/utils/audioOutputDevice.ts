export const AUDIO_OUTPUT_STORAGE_KEY = 'hyphon.audioOutputDevice';

export interface StoredAudioOutput {
  groupId: string;
  label: string;
}

type SinkCapableContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
  sinkId?: string;
};

export function supportsSetSinkId(): boolean {
  try {
    return typeof AudioContext !== 'undefined'
      && typeof (AudioContext.prototype as SinkCapableContext).setSinkId === 'function';
  } catch {
    return false;
  }
}

export function getStoredAudioOutput(): StoredAudioOutput | null {
  try {
    const raw = localStorage.getItem(AUDIO_OUTPUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed
      && typeof parsed === 'object'
      && typeof (parsed as StoredAudioOutput).groupId === 'string'
      && typeof (parsed as StoredAudioOutput).label === 'string'
    ) {
      return parsed as StoredAudioOutput;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function setStoredAudioOutput(pref: StoredAudioOutput | null): void {
  try {
    if (!pref) {
      localStorage.removeItem(AUDIO_OUTPUT_STORAGE_KEY);
      return;
    }
    localStorage.setItem(AUDIO_OUTPUT_STORAGE_KEY, JSON.stringify(pref));
  } catch {
    /* ignore */
  }
}

export async function listAudioOutputDevices(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audiooutput');
}

export async function requestAudioOutputPermission(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) return;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
}

function matchStoredDevice(devices: MediaDeviceInfo[], stored: StoredAudioOutput | null): MediaDeviceInfo | null {
  if (!stored) return null;
  const byGroup = devices.find((d) => d.groupId && d.groupId === stored.groupId);
  if (byGroup) return byGroup;
  const byLabel = devices.find((d) => d.label && d.label === stored.label);
  return byLabel ?? null;
}

export async function applyAudioOutputSink(
  context: AudioContext,
  deviceId?: string,
): Promise<{ sinkId: string; sinkLabel: string } | null> {
  if (!supportsSetSinkId()) return null;
  const sinkContext = context as SinkCapableContext;
  if (typeof sinkContext.setSinkId !== 'function') return null;

  try {
    let targetId = deviceId;
    let label = 'default';
    if (targetId === undefined) {
      const stored = getStoredAudioOutput();
      const devices = await listAudioOutputDevices();
      const match = matchStoredDevice(devices, stored);
      if (!match) {
        return { sinkId: sinkContext.sinkId ?? '', sinkLabel: 'default' };
      }
      targetId = match.deviceId;
      label = match.label || stored?.label || 'default';
    } else if (targetId === '' || targetId === 'default') {
      targetId = '';
      label = 'default';
    } else {
      const devices = await listAudioOutputDevices();
      label = devices.find((d) => d.deviceId === targetId)?.label || targetId;
    }

    await sinkContext.setSinkId(targetId);
    return { sinkId: sinkContext.sinkId ?? targetId, sinkLabel: label || 'default' };
  } catch {
    return { sinkId: '', sinkLabel: 'default' };
  }
}
