/** Binary read context shared by parser helper modules. */
export interface ParserBinaryContext {
  dataView: DataView;
  rawBytes: Uint8Array;
  fileSize: number;
  onProgress?: (percent: number) => void;
}
