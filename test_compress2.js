function compress(band, env, attackCoef, releaseCoef, threshold, ratio, maxGR) {
    const absIn = Math.abs(band);
    if (absIn > env) {
      env = attackCoef * env + (1 - attackCoef) * absIn;
    } else {
      env = releaseCoef * env + (1 - releaseCoef) * absIn;
    }
    if (env <= threshold) return { res: band, env };
    const over = 20 * Math.log10(env) - 20 * Math.log10(threshold);
    const grDb = Math.min(over * (1.0 - 1.0 / ratio), maxGR);
    return { res: band * Math.pow(10, -grDb / 20), env };
}

function compress2(band, env, attackCoef, releaseCoef, threshold, slope, maxEnv, maxGRMultiplier) {
    const absIn = Math.abs(band);
    if (absIn > env) {
      env = attackCoef * env + (1 - attackCoef) * absIn;
    } else {
      env = releaseCoef * env + (1 - releaseCoef) * absIn;
    }

    if (env <= threshold) return { res: band, env };

    if (env >= maxEnv) {
        return { res: band * maxGRMultiplier, env };
    }

    return { res: band * Math.pow(env / threshold, -slope), env };
}

const band = 0.8;
let env = 0.1;
const attackCoef = 0.9;
const releaseCoef = 0.99;
const threshold = 0.1;
const maxGR = 6.0;
const ratio = 2.5;

const slope = 1.0 - 1.0 / ratio;
const maxEnv = threshold * Math.pow(10, maxGR / (20 * slope));
const maxGRMultiplier = Math.pow(10, -maxGR / 20);

for(let i=0; i<10; i++) {
  const o1 = compress(band, env, attackCoef, releaseCoef, threshold, ratio, maxGR);
  const o2 = compress2(band, env, attackCoef, releaseCoef, threshold, slope, maxEnv, maxGRMultiplier);
  console.log({ o1: o1.res, o2: o2.res, diff: o1.res - o2.res });
  env = o1.env;
}
