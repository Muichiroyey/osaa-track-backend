export function notFound(req, res) {
  res.status(404).json({ error: "NOT_FOUND", message: `No route for ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.code || "SERVER_ERROR",
    message: status === 500 ? "Something went wrong on our end. Please try again." : err.message,
  });
}
