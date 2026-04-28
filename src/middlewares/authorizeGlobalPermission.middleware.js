import { supabase } from "../lib/supabase.js";

export function authorizeGlobalPermission(requiredPermissions = []) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          ok: false,
          message: "No autenticado",
        });
      }

      if (!Array.isArray(requiredPermissions) || requiredPermissions.length === 0) {
        return next();
      }

      const validations = await Promise.all(
        requiredPermissions.map(async (permissionCode) => {
          const { data, error } = await supabase.rpc(
            "fn_usuario_tiene_permiso_global",
            {
              p_id_usuario: userId,
              p_codigo_permiso: permissionCode,
            }
          );

          if (error) throw error;

          return data === true;
        })
      );

      const allowed = validations.every(Boolean);

      if (!allowed) {
        return res.status(403).json({
          ok: false,
          message: "No tienes permisos globales suficientes",
        });
      }

      next();
    } catch (error) {
      console.error("authorizeGlobalPermission error:", error);

      return res.status(500).json({
        ok: false,
        message: "Error interno validando permisos globales",
      });
    }
  };
}