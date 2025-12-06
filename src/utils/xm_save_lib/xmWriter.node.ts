
import type { XMModule } from './types';
import { XMWriter } from './xmWriter';

/**
 * Save an XM module to a file (Node.js only)
 * @param module The XM module to save
 * @param filename The output filename
 */
export async function saveToFile(module: XMModule, filename: string): Promise<void> {
  const writer = new XMWriter();
  const buffer = writer.write(module);

  // Dynamic import for Node.js fs module
  const { promises: fs } = await import('fs');
  await fs.writeFile(filename, Buffer.from(buffer));
}
