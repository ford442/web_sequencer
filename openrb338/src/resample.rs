// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Hyphon contributors.

//! The rate converter between the 44.1 kHz core and a host at any other rate.
//!
//! A 4-point Catmull-Rom (cubic Hermite) interpolator, two core samples of latency. It is only
//! used off 44.1 kHz, where the output cannot be bit-exact anyway (every ReBirth constant assumes
//! 44.1 kHz). It has no anti-alias low-pass, so it is meant for up-conversion (48, 88.2, 96 kHz);
//! hosts below 44.1 kHz get the core's content above their Nyquist folded back.

pub(crate) struct Resampler {
    /// Core samples per host sample (44100 / host rate).
    step: f64,
    /// Position between `h[1]` and `h[2]`, 0..1 once primed.
    frac: f64,
    /// The last four core samples, oldest first.
    h: [f32; 4],
}

impl Resampler {
    pub(crate) fn new(step: f64) -> Self {
        Resampler {
            step,
            frac: 0.0,
            h: [0.0; 4],
        }
    }

    /// Fill `out` with host-rate samples, pulling core samples from `next` as needed.
    pub(crate) fn process(&mut self, out: &mut [f32], mut next: impl FnMut() -> f32) {
        for o in out.iter_mut() {
            while self.frac >= 1.0 {
                self.h = [self.h[1], self.h[2], self.h[3], next()];
                self.frac -= 1.0;
            }
            let [x0, x1, x2, x3] = self.h;
            let t = self.frac as f32;
            let c1 = 0.5 * (x2 - x0);
            let c2 = x0 - 2.5 * x1 + 2.0 * x2 - 0.5 * x3;
            let c3 = 0.5 * (x3 - x0) + 1.5 * (x1 - x2);
            *o = ((c3 * t + c2) * t + c1) * t + x1;
            self.frac += self.step;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_a_line_through_after_its_latency() {
        // A ramp is reproduced exactly by a cubic Hermite interpolator.
        let mut n = 0.0f32;
        let mut r = Resampler::new(0.5);
        let mut out = [0.0f32; 64];
        r.process(&mut out, || {
            n += 1.0;
            n
        });
        // Core sample m has the value m, and output k sits at core position k/2 - 2: two
        // samples of latency.
        for (k, &y) in out.iter().enumerate().skip(8) {
            let want = k as f32 * 0.5 - 2.0;
            assert!((y - want).abs() < 1e-4, "out[{k}] = {y}, want {want}");
        }
    }

    #[test]
    fn pulls_core_samples_at_the_ratio() {
        let mut pulled = 0usize;
        let mut r = Resampler::new(44_100.0 / 48_000.0);
        let mut out = vec![0.0f32; 48_000];
        r.process(&mut out, || {
            pulled += 1;
            0.0
        });
        assert!((pulled as i64 - 44_100).abs() <= 2, "pulled {pulled}");
    }
}
