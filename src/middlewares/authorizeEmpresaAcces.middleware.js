import { supabase } from "../lib/supabase.js";

function parseEmpresaId(req, empresaIdParam = "empresaId") {
  const fromParams = req.params?.[empresaIdParam];
  const fromBody = req.body?.IdEmpresa ?? req.body?.idEmpresa;
  const fromQuery = req.query?.empresaId;

  const rawValue = fromParams ?? fromBody ?? fromQuery;

  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return null;
  }

  const empresaId = Number(rawValue);
  return Number.isFinite(empresaId) ? empresaId : null;
}

export function authorizeEmpresaAccess(options = {}) {
  const {
    empresaIdParam = "empresaId",
    requiredPermissions = [],
    resolveEmpresaId = null,
  } = options;

  return async (req, res, next) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          ok: false,
          message: "No autenticado",
        });
      }

      let empresaId = null;

      if (typeof resolveEmpresaId === "function") {
        empresaId = await resolveEmpresaId(req);
      } else {
        empresaId = parseEmpresaId(req, empresaIdParam);
      }

      if (!empresaId) {
        return res.status(400).json({
          ok: false,
          message: "No se pudo determinar la empresa",
        });
      }

      const { data: hasAccess, error: accessError } = await supabase.rpc(
        "fn_usuario_tiene_acceso_empresa",
        {
          p_id_usuario: userId,
          p_id_empresa: empresaId,
        }
      );

      if (accessError) throw accessError;

      if (hasAccess !== true) {
        return res.status(403).json({
          ok: false,
          message: "No tienes acceso a esta empresa",
        });
      }

      if (Array.isArray(requiredPermissions) && requiredPermissions.length > 0) {
        const validations = await Promise.all(
          requiredPermissions.map(async (permissionCode) => {
            const { data, error } = await supabase.rpc(
              "fn_usuario_tiene_permiso_empresa",
              {
                p_id_usuario: userId,
                p_id_empresa: empresaId,
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
            message: "No tienes permisos suficientes para esta empresa",
          });
        }
      }

      const { data: isGlobalAdmin, error: globalAdminError } = await supabase.rpc(
        "fn_es_admin_global",
        {
          p_id_usuario: userId,
        }
      );

      if (globalAdminError) throw globalAdminError;

      req.accessContext = {
        empresaId,
        isGlobalAdmin: isGlobalAdmin === true,
      };

      next();
    } catch (error) {
      console.error("authorizeEmpresaAccess error:", error);

      return res.status(500).json({
        ok: false,
        message: "Error interno validando acceso a empresa",
      });
    }
  };
}