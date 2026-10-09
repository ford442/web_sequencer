const maxGR = 12.0 * 0.5;
const threshold = 0.1;
const ratio = 1.0 + 3.0 * 0.5;
const slope = 1.0 - 1.0 / ratio;

const env = 0.5;
const band = 0.8;

// Old
const over1 = 20 * Math.log10(env) - 20 * Math.log10(threshold);
const grDb1 = Math.min(over1 * slope, maxGR);
const res1 = band * Math.pow(10, -grDb1 / 20);

// New
const maxEnv = threshold * Math.pow(10, maxGR / (20 * slope));
const maxGRMultiplier = Math.pow(10, -maxGR / 20);

let res2;
if (env >= maxEnv) {
  res2 = band * maxGRMultiplier;
} else {
  res2 = band * Math.pow(env / threshold, -slope);
}

console.log({ res1, res2, diff: res1 - res2 });
