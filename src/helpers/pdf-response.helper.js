function sanitizePdfFileName(value) {
  return `${value || "documento"}`.replace(/[^\w-]+/g, "_");
}

export function setInlinePdfHeaders(res, fileName) {
  const safeName = sanitizePdfFileName(fileName);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${safeName}.pdf"`);
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-Content-Type-Options", "nosniff");
}
