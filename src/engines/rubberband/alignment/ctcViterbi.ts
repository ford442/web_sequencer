/**
 * CTC forced alignment (Viterbi) over a known token sequence.
 * Token ids must match the acoustic model's output vocabulary.
 */

export interface CtcSpan {
  tokenId: number;
  startFrame: number;
  endFrame: number;
}

/**
 * Align `tokenIds` to CTC log-probs [timeSteps x vocabSize].
 * Returns one span per input token (collapsed repeats; blanks dropped).
 */
export function forcedAlignCtc(
  logProbs: Float32Array,
  timeSteps: number,
  vocabSize: number,
  tokenIds: number[],
  blankId: number,
): CtcSpan[] {
  if (timeSteps <= 0 || tokenIds.length === 0 || vocabSize <= 0) {
    return [];
  }

  const S = tokenIds.length;
  const stateCount = 2 * S + 1;
  const NEG = -1e9;

  const scorePrev = new Float32Array(stateCount).fill(NEG);
  const scoreCur = new Float32Array(stateCount).fill(NEG);
  const backptr = new Int32Array(timeSteps * stateCount).fill(-1);

  const tokenAtState = (s: number): number => (s % 2 === 0 ? blankId : tokenIds[(s - 1) / 2]);

  const logAt = (t: number, id: number): number => {
    const idx = t * vocabSize + id;
    if (id < 0 || id >= vocabSize || idx < 0 || idx >= logProbs.length) return NEG;
    return logProbs[idx];
  };

  scorePrev[0] = logAt(0, blankId);
  if (S > 0) {
    scorePrev[1] = logAt(0, tokenIds[0]);
  }

  for (let t = 1; t < timeSteps; t++) {
    scoreCur.fill(NEG);
    const row = t * stateCount;
    for (let s = 0; s < stateCount; s++) {
      const tok = tokenAtState(s);
      const emit = logAt(t, tok);
      let best = NEG;
      let from = -1;

      const stay = scorePrev[s];
      if (stay > best) {
        best = stay;
        from = s;
      }
      if (s > 0) {
        const step = scorePrev[s - 1];
        if (step > best) {
          best = step;
          from = s - 1;
        }
      }
      // Skip blank when entering a token that is not a repeat of the previous token
      if (s % 2 === 1 && s >= 3) {
        const prevTok = tokenIds[(s - 3) / 2];
        if (prevTok !== tok) {
          const skip = scorePrev[s - 2];
          if (skip > best) {
            best = skip;
            from = s - 2;
          }
        }
      }

      if (from >= 0) {
        scoreCur[s] = best + emit;
        backptr[row + s] = from;
      }
    }
    scorePrev.set(scoreCur);
  }

  let endState = stateCount - 1;
  if (scorePrev[stateCount - 1] < scorePrev[stateCount - 2]) {
    endState = stateCount - 2;
  }

  const statePath = new Int32Array(timeSteps);
  let s = endState;
  for (let t = timeSteps - 1; t >= 0; t--) {
    statePath[t] = s;
    if (t > 0) {
      const prev = backptr[t * stateCount + s];
      s = prev >= 0 ? prev : s;
    }
  }

  const spans: CtcSpan[] = [];
  for (let t = 0; t < timeSteps; t++) {
    const st = statePath[t];
    if (st % 2 === 0) continue;
    const tokenId = tokenIds[(st - 1) / 2];
    const last = spans[spans.length - 1];
    if (last && last.tokenId === tokenId && last.endFrame === t) {
      last.endFrame = t + 1;
    } else {
      spans.push({ tokenId, startFrame: t, endFrame: t + 1 });
    }
  }

  if (spans.length === 0) {
    const even = timeSteps / S;
    for (let i = 0; i < S; i++) {
      spans.push({
        tokenId: tokenIds[i],
        startFrame: Math.floor(i * even),
        endFrame: Math.max(Math.floor(i * even) + 1, Math.floor((i + 1) * even)),
      });
    }
    spans[S - 1].endFrame = timeSteps;
    return spans;
  }

  // Merge consecutive identical tokens (CTC repeats)
  const merged: CtcSpan[] = [];
  let expected = 0;
  for (const span of spans) {
    if (expected < S && span.tokenId === tokenIds[expected]) {
      const prev = merged[merged.length - 1];
      if (prev && prev.tokenId === span.tokenId && expected > 0 && tokenIds[expected - 1] === span.tokenId) {
        // repeated token in target (e.g. "ll") — start a new span
        merged.push({ ...span });
        expected++;
      } else if (prev && prev.tokenId === span.tokenId) {
        prev.endFrame = span.endFrame;
      } else {
        merged.push({ ...span });
        expected++;
      }
    } else if (merged.length > 0 && merged[merged.length - 1].tokenId === span.tokenId) {
      merged[merged.length - 1].endFrame = span.endFrame;
    }
  }

  if (merged.length === S) return merged;

  // If collapse missed tokens, fall back to even split
  const even = timeSteps / S;
  const fallback: CtcSpan[] = [];
  for (let i = 0; i < S; i++) {
    fallback.push({
      tokenId: tokenIds[i],
      startFrame: Math.floor(i * even),
      endFrame: i === S - 1 ? timeSteps : Math.floor((i + 1) * even),
    });
  }
  return fallback;
}

export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = toRate / fromRate;
  const outLen = Math.max(1, Math.round(input.length * ratio));
  const out = new Float32Array(outLen);
  const srcMax = input.length - 1;
  for (let i = 0; i < outLen; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(srcMax, i0 + 1);
    const frac = src - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}
