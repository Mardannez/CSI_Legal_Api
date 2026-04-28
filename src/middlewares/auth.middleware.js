import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [type, token] = header.split(" ");

  if (type !== "Bearer" || !token) {
    return res.status(401).json({
      ok: false,
      message: "Token requerido",
    });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const userId = Number(payload.sub ?? payload.id);

    if (!Number.isFinite(userId)) {
      return res.status(401).json({
        ok: false,
        message: "Token inválido: user id no encontrado",
      });
    }

    req.user = {
      ...payload,
      id: userId,
      sub: userId,
      usuario: payload.usuario ?? null,
    };

    next();
  } catch {
    return res.status(401).json({
      ok: false,
      message: "Token inválido o expirado",
    });
  }
}