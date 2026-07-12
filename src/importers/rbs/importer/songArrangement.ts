import type { RawRbsData, HyphonSong, RbsSongData } from '../types';
import { TICKS_PER_BAR, TRAK_TRACK_INDEX } from '../types';
import { MAX_TRACK_PATTERN_SLOTS } from '../../../constants';
import { deriveActiveTrackSlotsFromStructure } from '../../../utils/trackStorageUtils';
import { isTrakParamAutomationEvent, isTrakPatternSelectEvent } from '../trakControllers';
import type { Pattern } from '../../../types';
import {
  convertTb303ToPartSequence,
  expandPattern16To32,
  convertDrumPattern,
} from './patternConversion';
import { buildTrackParamSlots } from './synthParams';
import type { ImporterContext } from './importerContext';

/** Find the active pattern index at a given tick position for a track. */
export function findActivePatternAtTick(
  track: RbsSongData['tracks'][number] | undefined,
  tick: number,
  maxSlots: number,
): number | null {
  if (!track || track.events.length === 0) return 0;

  let activePattern = 0;
  for (const evt of track.events) {
    if (evt.absoluteTicks > tick) break;
    if (isTrakPatternSelectEvent(evt.trackIndex, evt.controllerId, evt.eventKind)) {
      activePattern = evt.value;
    }
  }

  if (activePattern >= maxSlots) {
    return maxSlots - 1;
  }
  return activePattern;
}

/** Build songArrangement data from parsed IFF song data. */
export function buildSongArrangement(
  ctx: ImporterContext,
  raw: RawRbsData,
  warnings: string[],
): HyphonSong['songArrangement'] {
  const songData = raw.songData!;
  const numSteps = ctx.options.expandTo32Steps ? 32 : raw.project.patternLength;
  const isExpansion = numSteps === 32 && raw.project.patternLength === 16;

  const maxSlots = MAX_TRACK_PATTERN_SLOTS;
  const partASlots: (Pattern['partA'] | null)[] = Array(maxSlots).fill(null);
  const partBSlots: (Pattern['partB'] | null)[] = Array(maxSlots).fill(null);
  const bass2Slots: (Pattern['bass2'] | null)[] = Array(maxSlots).fill(null);
  const kickSlots: (Pattern['kick'] | null)[] = Array(maxSlots).fill(null);
  const snareSlots: (Pattern['snare'] | null)[] = Array(maxSlots).fill(null);
  const closedHatSlots: (Pattern['closedHat'] | null)[] = Array(maxSlots).fill(null);
  const openHatSlots: (Pattern['openHat'] | null)[] = Array(maxSlots).fill(null);

  const numA = Math.min(maxSlots, songData.patternBanks.tb303A.length);
  for (let i = 0; i < numA; i++) {
    const pat = songData.patternBanks.tb303A[i];
    if (isExpansion) {
      partASlots[i] = expandPattern16To32(ctx, pat.steps, false);
    } else {
      partASlots[i] = convertTb303ToPartSequence(ctx, pat, numSteps, false);
    }
  }

  const numB = Math.min(maxSlots, songData.patternBanks.tb303B.length);
  for (let i = 0; i < numB; i++) {
    const pat = songData.patternBanks.tb303B[i];
    if (isExpansion) {
      partBSlots[i] = expandPattern16To32(ctx, pat.steps, false);
    } else {
      partBSlots[i] = convertTb303ToPartSequence(ctx, pat, numSteps, false);
    }
    if (ctx.options.tb303BTarget === 'bass2') {
      if (isExpansion) {
        bass2Slots[i] = expandPattern16To32(ctx, pat.steps, true);
      } else {
        bass2Slots[i] = convertTb303ToPartSequence(ctx, pat, numSteps, true);
      }
    }
  }

  const drumBank = songData.patternBanks.drums808.length > 0
    ? songData.patternBanks.drums808
    : songData.patternBanks.drums909;
  const numDrums = Math.min(maxSlots, drumBank.length);
  for (let i = 0; i < numDrums; i++) {
    const dp = drumBank[i];
    kickSlots[i] = convertDrumPattern(dp.kick, numSteps, 'kick');
    snareSlots[i] = convertDrumPattern(dp.snare, numSteps, 'snare');
    closedHatSlots[i] = convertDrumPattern(dp.closedHat, numSteps, 'closedHat');
    openHatSlots[i] = convertDrumPattern(dp.openHat, numSteps, 'openHat');
  }

  const songStructure: Array<Record<string, number | null>> = [];
  const totalBars = Math.max(1, songData.totalLengthBars);

  const tb303_1Track = songData.tracks.find(t => t.trackIndex === TRAK_TRACK_INDEX.TB303_1);
  const tb303_2Track = songData.tracks.find(t => t.trackIndex === TRAK_TRACK_INDEX.TB303_2);
  const drumsTrack = songData.tracks.find(t => t.trackIndex === TRAK_TRACK_INDEX.TR808)
    || songData.tracks.find(t => t.trackIndex === TRAK_TRACK_INDEX.TR909);

  for (let bar = 0; bar < totalBars; bar++) {
    const barStart = bar * TICKS_PER_BAR;
    const barEnd = barStart + TICKS_PER_BAR;

    const partAIdx = findActivePatternAtTick(tb303_1Track, barStart, maxSlots);
    const partBIdx = findActivePatternAtTick(tb303_2Track, barStart, maxSlots);
    const drumIdx = findActivePatternAtTick(drumsTrack, barStart, maxSlots);

    songStructure.push({
      partA: partAIdx,
      partB: partBIdx,
      bass2: ctx.options.tb303BTarget === 'bass2' ? partBIdx : null,
      kick: drumIdx,
      snare: drumIdx,
      closedHat: drumIdx,
      openHat: drumIdx,
      sampler: null,
    });
  }

  const allTrakEvents = songData.tracks.flatMap((t) => t.events);
  const trakParamEvents = allTrakEvents.filter((ev) =>
    isTrakParamAutomationEvent(ev.trackIndex, ev.controllerId, ev.eventKind),
  );

  if (songData.usedPatternCount > maxSlots) {
    warnings.push(
      `Song uses ${songData.usedPatternCount} patterns but Hyphon supports ${maxSlots} slots. Excess patterns truncated.`,
    );
  }

  return {
    mode: songData.glob.playMode === 1 ? 'song' : 'pattern',
    trackStorage: {
      partA: partASlots,
      partB: partBSlots,
      bass2: bass2Slots,
      kick: kickSlots,
      snare: snareSlots,
      closedHat: closedHatSlots,
      openHat: openHatSlots,
    },
    trackParamStorage: {
      synthA: buildTrackParamSlots(songData.patternBanks.tb303A, maxSlots, false),
      synthB: buildTrackParamSlots(songData.patternBanks.tb303B, maxSlots, false),
      bass2: ctx.options.tb303BTarget === 'bass2'
        ? buildTrackParamSlots(songData.patternBanks.tb303B, maxSlots, true)
        : Array(maxSlots).fill(null),
    },
    songStructure,
    activeTrackSlots: deriveActiveTrackSlotsFromStructure(songStructure),
    loopStart: songData.glob.loopStart || undefined,
    loopEnd: songData.glob.loopEnd || undefined,
    trakEvents: allTrakEvents.length > 0 ? allTrakEvents : undefined,
    trakParamEvents: trakParamEvents.length > 0 ? trakParamEvents : undefined,
  };
}
