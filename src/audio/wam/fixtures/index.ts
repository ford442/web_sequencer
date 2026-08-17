import { getBundledPackage, HYPHON_GAIN_PACKAGE_ID, HYPHON_TONE_PACKAGE_ID } from '../catalog';
import type { Wam2Plugin } from '../types';
import { HyphonGainPlugin } from './hyphonGain';
import { HyphonTonePlugin } from './hyphonTone';

export async function createBundledPlugin(packageId: string): Promise<Wam2Plugin> {
  const descriptor = await getBundledPackage(packageId);
  if (!descriptor) {
    throw new Error(`Unknown bundled WAM2 package: ${packageId}`);
  }
  if (packageId === HYPHON_TONE_PACKAGE_ID) {
    return new HyphonTonePlugin(descriptor);
  }
  if (packageId === HYPHON_GAIN_PACKAGE_ID) {
    return new HyphonGainPlugin(descriptor);
  }
  throw new Error(`No fixture constructor for ${packageId}`);
}

export { HyphonGainPlugin, HyphonTonePlugin };
