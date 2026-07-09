// Simpele in-memory rate limiter per IP + naam. Goed genoeg voor één
// Render-instance; bij een herstart begint de telling opnieuw.

const buckets = new Map();

// Ruim oude emmers periodiek op zodat de map niet groeit.
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref();

function rateLimit({ name, max, windowMs }) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    if (b.count > max) {
      const wait = Math.ceil((b.resetAt - now) / 1000);
      res.set('Retry-After', String(wait));
      return res.status(429).json({
        error: `Te veel pogingen. Probeer het over ${Math.ceil(wait / 60)} minuten opnieuw.`,
      });
    }
    next();
  };
}

module.exports = { rateLimit };
