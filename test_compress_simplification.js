// original
function compress(band, env, threshold, ratio, maxGR) {
    if (env <= threshold) return { res: band, env };
    const over = 20 * Math.log10(env) - 20 * Math.log10(threshold); // 20 * Math.log10(env/threshold)
    const grDb = Math.min(over * (1.0 - 1.0 / ratio), maxGR);
    return { res: band * Math.pow(10, -grDb / 20), env };
}

function compress2(band, env, threshold, ratio, maxGR) {
    if (env <= threshold) return { res: band, env };

    // mathematical simplification
    // grDb = over * slope  => slope = (1 - 1/ratio)
    // over = 20 * log10(env/threshold)
    // grDb = 20 * slope * log10(env/threshold)
    // res = band * 10^(-grDb/20)
    // res = band * 10^(-slope * log10(env/threshold))
    // res = band * (env/threshold)^(-slope)

    const slope = 1.0 - 1.0 / ratio;
    const maxEnv = threshold * Math.pow(10, maxGR / (20 * slope));

    if (env >= maxEnv) {
        return { res: band * Math.pow(10, -maxGR / 20), env };
    }

    return { res: band * Math.pow(env / threshold, -slope), env };
}

const band = 0.8;
let env = 0.5;
const threshold = 0.1;
const maxGR = 12.0;
const ratio = 2.5;

console.log({ o1: compress(band, env, threshold, ratio, maxGR), o2: compress2(band, env, threshold, ratio, maxGR) });

// Check performance
console.time("original");
for(let i=0; i<1000000; i++) {
  compress(band, env, threshold, ratio, maxGR);
}
console.timeEnd("original");

console.time("optimized");
const slope = 1.0 - 1.0 / ratio;
const maxEnv = threshold * Math.pow(10, maxGR / (20 * slope));
const maxGRMultiplier = Math.pow(10, -maxGR / 20);

for(let i=0; i<1000000; i++) {
  if (env <= threshold) { continue; }
  if (env >= maxEnv) {
    // band * maxGRMultiplier
  } else {
    band * Math.pow(env / threshold, -slope);
  }
}
console.timeEnd("optimized");
