/**
 * Minimal store-only ZIP writer (no compression).
 * Avoids adding a zip dependency for stem export downloads.
 */

function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let j = 0; j < 8; j++) {
            const mask = -(crc & 1);
            crc = (crc >>> 1) ^ (0xedb88320 & mask);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number) {
    view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
    view.setUint32(offset, value, true);
}

export interface ZipEntry {
    path: string;
    data: Uint8Array;
}

export function createZipBlob(entries: ZipEntry[]): Blob {
    const encoder = new TextEncoder();
    const localChunks: Uint8Array[] = [];
    const centralChunks: Uint8Array[] = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBytes = encoder.encode(entry.path.replace(/\\/g, '/'));
        const data = entry.data;
        const crc = crc32(data);

        const localHeader = new ArrayBuffer(30 + nameBytes.length);
        const localView = new DataView(localHeader);
        writeUint32(localView, 0, 0x04034b50);
        writeUint16(localView, 4, 20); // version needed
        writeUint16(localView, 6, 0); // flags
        writeUint16(localView, 8, 0); // store
        writeUint16(localView, 10, 0);
        writeUint16(localView, 12, 0);
        writeUint32(localView, 14, crc);
        writeUint32(localView, 18, data.length);
        writeUint32(localView, 22, data.length);
        writeUint16(localView, 26, nameBytes.length);
        writeUint16(localView, 28, 0);
        new Uint8Array(localHeader, 30).set(nameBytes);

        localChunks.push(new Uint8Array(localHeader), data);

        const centralHeader = new ArrayBuffer(46 + nameBytes.length);
        const centralView = new DataView(centralHeader);
        writeUint32(centralView, 0, 0x02014b50);
        writeUint16(centralView, 4, 20);
        writeUint16(centralView, 6, 20);
        writeUint16(centralView, 8, 0);
        writeUint16(centralView, 10, 0);
        writeUint16(centralView, 12, 0);
        writeUint16(centralView, 14, 0);
        writeUint32(centralView, 16, crc);
        writeUint32(centralView, 20, data.length);
        writeUint32(centralView, 24, data.length);
        writeUint16(centralView, 28, nameBytes.length);
        writeUint16(centralView, 30, 0);
        writeUint16(centralView, 32, 0);
        writeUint16(centralView, 34, 0);
        writeUint16(centralView, 36, 0);
        writeUint32(centralView, 38, 0);
        writeUint32(centralView, 42, offset);
        new Uint8Array(centralHeader, 46).set(nameBytes);
        centralChunks.push(new Uint8Array(centralHeader));

        offset += localHeader.byteLength + data.length;
    }

    const centralDirectoryOffset = offset;
    const centralDirectorySize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    offset += centralDirectorySize;

    const endRecord = new ArrayBuffer(22);
    const endView = new DataView(endRecord);
    writeUint32(endView, 0, 0x06054b50);
    writeUint16(endView, 4, 0);
    writeUint16(endView, 6, 0);
    writeUint16(endView, 8, entries.length);
    writeUint16(endView, 10, entries.length);
    writeUint32(endView, 12, centralDirectorySize);
    writeUint32(endView, 16, centralDirectoryOffset);
    writeUint16(endView, 20, 0);

    const totalSize =
        localChunks.reduce((sum, chunk) => sum + chunk.length, 0) +
        centralDirectorySize +
        endRecord.byteLength;

    const out = new Uint8Array(totalSize);
    let writeOffset = 0;
    for (const chunk of [...localChunks, ...centralChunks, new Uint8Array(endRecord)]) {
        out.set(chunk, writeOffset);
        writeOffset += chunk.length;
    }

    return new Blob([out], { type: 'application/zip' });
}
