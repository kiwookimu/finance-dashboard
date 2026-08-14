function average(values) {
  const finite = (values || [])
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number)
    .filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function median(values) {
  const finite = (values || [])
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!finite.length) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2
    ? finite[middle]
    : (finite[middle - 1] + finite[middle]) / 2;
}

function round(value, digits = 1) {
  if (value === null || value === undefined || value === "") return null;
  if (!Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function rate(numerator, denominator, digits = 1) {
  return denominator > 0 ? round((numerator / denominator) * 100, digits) : null;
}

function wilsonPercentInterval(hitRate, observations, z = 1.96) {
  if (!Number.isFinite(hitRate) || !Number.isFinite(observations) || observations <= 0) {
    return null;
  }
  const proportion = hitRate / 100;
  const denominator = 1 + (z ** 2) / observations;
  const center = (proportion + (z ** 2) / (2 * observations)) / denominator;
  const margin =
    (z *
      Math.sqrt(
        (proportion * (1 - proportion)) / observations +
          (z ** 2) / (4 * observations ** 2),
      )) /
    denominator;
  return {
    lower: Math.max(0, round((center - margin) * 100, 1)),
    upper: Math.min(100, round((center + margin) * 100, 1)),
  };
}

module.exports = {
  average,
  median,
  rate,
  round,
  wilsonPercentInterval,
};
