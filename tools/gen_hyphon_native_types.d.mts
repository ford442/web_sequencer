export const EXPORTS_OUTPUT: string;
export const EVENT_SCHEMA: string;
export const EVENT_LAYOUT_TS: string;
export const EVENT_LAYOUT_H: string;

export interface EventSchemaField {
  name: string;
  type: string;
  count: number;
  offset: number;
  array: boolean;
  doc: string;
}
export interface EventSchemaType {
  name: string;
  symbol: string;
  id: number;
  doc: string;
  cancelledByStop?: boolean;
  args?: Array<{ name: string; doc: string }>;
}
export interface EventRingSchemaWord {
  name: string;
  /** Int32 slot in the header. */
  index: number;
  atomic: boolean;
  doc: string;
}
/** The event ring header both sides lay records out in (#1497 P2). */
export interface EventRingSchema {
  headerBytes: number;
  /** Four ASCII characters. */
  magic: string;
  /** `magic` as a little-endian uint32. */
  magicValue: number;
  /** Sorted by index. */
  words: EventRingSchemaWord[];
}
export interface EventSchema {
  version: number;
  bytes: number;
  fields: EventSchemaField[];
  types: EventSchemaType[];
  base: { symbol: string; id: number; doc: string };
  ring: EventRingSchema;
}

/** Parses and validates event_schema.json text (the committed file by default). */
export function loadEventSchema(text?: string): EventSchema;
export function generateEventLayoutTs(schema?: EventSchema): string;
export function generateEventLayoutH(schema?: EventSchema): string;
export function generate(schema?: EventSchema): string;
export function generatedFiles(): Array<{ rel: string; text: string }>;
export function staleGeneratedFiles(): string[];
