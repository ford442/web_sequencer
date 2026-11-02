/**
 * VoiceEventRoute: one voice worklet's route on the EventBus (#1497 P2), and
 * the records its engine façade sends over it.
 *
 * Two ways to open one:
 *
 *   - `voiceRing: true` (drums, Prophecy: one native voice per worklet). The
 *     route starts on batched port messages, so a record sent before the
 *     voice exists still arrives. The worklet's ready message then offers the
 *     voice's own ring inside hyphon_native's shared memory, and adopt() moves
 *     the route onto it: from there each record is written in place, the C++
 *     voice takes it at block start, and nothing copies or posts it. On the
 *     single-threaded build there is no shared memory, nothing is offered,
 *     and the route stays on messages.
 *   - `voiceRing: false` (the 303: one worklet routes each record to the
 *     voice its engine selection picks). A SharedArrayBuffer ring of the
 *     route's own where memory is shared, messages elsewhere. The worklet
 *     drains it at block start.
 *
 * Every record is stamped with a frame on the context's clock (frameAtTime).
 * A missing audioTime is frame 0, the next block. The values go through the
 * bus's stage, so they are never boxed on the way into a ring.
 *
 * Close the route before the worklet destroys its voice: an in-place writer
 * must not outlive the ring it writes.
 */

import { frameAtTime } from '@/shared/rt/audioClock';
import { EventField, EventType } from '@/shared/rt/eventLayout';
import {
  MessageEventSink,
  RingEventSink,
  createEngineEventSink,
  parseRingTransport,
  type EventPort,
  type EventTransport,
} from '@/shared/rt/eventTransport';
import { engineEventBus, type EventBus, type EventRoute } from './EventBus';

export interface VoiceEventRouteOptions {
  /** The context's rate: frames are stamped on its clock. */
  sampleRate: number;
  /** hyphon_native runs the pthread profile: its memory, and a ring, can be shared. */
  sharedMemory: boolean;
  /** Wait for the worklet to offer its voice's own ring (adopt) instead of making one. */
  voiceRing: boolean;
}

export class VoiceEventRoute {
  readonly bus: EventBus;
  private route: EventRoute = 0;
  private rate = 48000;
  private adopted = false;

  constructor(bus: EventBus = engineEventBus) {
    this.bus = bus;
  }

  /**
   * Open the route for a new worklet (closing any previous one) and return
   * the transport to send it in its init message.
   */
  open(port: EventPort, options: VoiceEventRouteOptions): EventTransport {
    this.close();
    this.rate = options.sampleRate > 0 ? options.sampleRate : 48000;
    const sink = options.voiceRing
      ? new MessageEventSink(port)
      : createEngineEventSink(port, { ring: options.sharedMemory });
    this.route = this.bus.open(sink);
    return sink.transport;
  }

  /**
   * The worklet's ready message: when it offered the voice's own ring
   * (`offer`, a RingTransport), write that ring in place from now on. False
   * when there was no offer, it did not check out, or the route is closed;
   * the route then carries on as it was.
   */
  adopt(offer: unknown): boolean {
    const ring = parseRingTransport(offer);
    if (!ring || !this.bus.rebind(this.route, new RingEventSink(ring))) return false;
    this.adopted = true;
    return true;
  }

  /** Flush what is staged, then stop writing. Before the worklet's voice goes away. */
  close(): void {
    this.bus.close(this.route);
    this.route = 0;
    this.adopted = false;
  }

  get isOpen(): boolean {
    return this.route !== 0;
  }

  /** True once records go straight into the voice's native ring. */
  get inPlace(): boolean {
    return this.adopted;
  }

  /** Frame of `audioTime` on the route's clock. */
  frameAt(audioTime: number | undefined): number {
    return frameAtTime(audioTime, this.rate);
  }

  /**
   * The bus's stage, for a record of the producer's own (a drum hit): fill it
   * at EventField indices, then commit(). Everything runs on the main thread,
   * so nothing else touches it in between.
   */
  get stage(): Float64Array {
    return this.bus.stage;
  }

  /** Queue the stage on this route and clear it. False when it was dropped. */
  commit(): boolean {
    return this.bus.commit(this.route);
  }

  /** NOTE_ON for MIDI `note` on the frame of `audioTime`. */
  noteOn(note: number, velocity: number, audioTime?: number): boolean {
    return this.note(EventType.NoteOn, note, velocity, audioTime);
  }

  /** NOTE_OFF for MIDI `note` on the frame of `audioTime`. */
  noteOff(note: number, audioTime?: number): boolean {
    return this.note(EventType.NoteOff, note, 0, audioTime);
  }

  private note(type: number, note: number, velocity: number, audioTime: number | undefined): boolean {
    const s = this.bus.stage;
    s[EventField.frame] = this.frameAt(audioTime);
    s[EventField.type] = type;
    s[EventField.target] = note;
    s[EventField.value] = velocity;
    return this.bus.commit(this.route);
  }

  /** PARAM_SET of engine param `id` on the frame of `audioTime`. */
  param(id: number, value: number, audioTime?: number): boolean {
    const s = this.bus.stage;
    s[EventField.frame] = this.frameAt(audioTime);
    s[EventField.type] = EventType.Param;
    s[EventField.target] = id;
    s[EventField.value] = value;
    return this.bus.commit(this.route);
  }

  /**
   * Transport stop as records, ordered with the notes around it: CANCEL_NOTES
   * drops every note and trigger queued before it (the clock posts steps up
   * to STEP_LOOKAHEAD_MS ahead), wherever they wait, and leaves alone the
   * ones sent after it. With `release`, an ALL_NOTES_OFF follows on the next
   * block, releasing what sounds; without, ringing hits decay on their own.
   */
  stop(release: boolean): void {
    const s = this.bus.stage;
    s[EventField.type] = EventType.CancelNotes;
    this.bus.commit(this.route);
    if (!release) return;
    s[EventField.type] = EventType.AllNotesOff;
    this.bus.commit(this.route);
  }
}
