export const logRequest = (req, res) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[api] ${req.method} ${req.url} -> ${res.statusCode} ${ms}ms`);
  });
};
