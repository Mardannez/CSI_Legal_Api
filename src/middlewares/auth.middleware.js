import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");

  if (type !== "Bearer" || !token) {
    return res.status(401).json({
      ok: false,
      code: "TOKEN_REQUIRED",
      message: "Token requerido",
    });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const userId = Number(payload.sub ?? payload.id);

    if (!Number.isFinite(userId)) {
      return res.status(401).json({
        ok: false,
        code: "INVALID_TOKEN_PAYLOAD",
        message: "Token inválido: user id no encontrado",
      });
    }

    req.user = {
      ...payload,

      // ======================================================
      // USUARIO AUTENTICADO
      // Normalizamos el id del usuario para que toda la API
      // use siempre req.user.id como número.
      // ======================================================
      id: userId,
      sub: userId,
      usuario: payload.usuario ?? null,

      // ======================================================
      // SUPER_ADMIN
      // Este valor viene firmado desde /api/auth/login.
      // Lo usamos en licencia.middleware.js para permitir que
      // SUPER_ADMIN entre aunque una empresa tenga licencia vencida.
      // ======================================================
      isGlobalAdmin: payload.isGlobalAdmin === true,
    };

    next();
  } catch {
    return res.status(401).json({
      ok: false,
      code: "INVALID_OR_EXPIRED_TOKEN",
      message: "Token inválido o expirado",
    });
  }
}