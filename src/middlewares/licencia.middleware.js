import { getActiveEmpresaLicense } from "../helpers/licencias.helper.js";

// ==========================================================
// LICENCIAS DE EMPRESA - MIDDLEWARE
// Este middleware protege endpoints que dependen de una empresa.
//
// Regla principal:
// - SUPER_ADMIN puede continuar aunque la empresa no tenga licencia activa.
// - Usuarios de empresa necesitan licencia activa para la empresa solicitada.
//
// Uso esperado:
// router.get(
//   "/dashboard",
//   requireAuth,
//   requireActiveEmpresaLicense((req) => req.query.idEmpresa),
//   controller
// );
//
// O cuando el id venga por params:
// router.get(
//   "/empresa/:idEmpresa/dashboard",
//   requireAuth,
//   requireActiveEmpresaLicense((req) => req.params.idEmpresa),
//   controller
// );
// ==========================================================

function normalizeEmpresaId(value) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return id;
}

export function requireActiveEmpresaLicense(getEmpresaIdFromReq) {
  return async (req, res, next) => {
    try {
      // ======================================================
      // SUPER_ADMIN
      // El administrador global no depende de licencias por empresa.
      // Esto permite entrar al sistema para administrar clientes,
      // renovar licencias, revisar pagos, soporte, etc.
      // ======================================================
      if (req.user?.isGlobalAdmin === true) {
        return next();
      }

      if (typeof getEmpresaIdFromReq !== "function") {
        return res.status(500).json({
          ok: false,
          code: "LICENSE_MIDDLEWARE_CONFIG_ERROR",
          message:
            "Middleware de licencia mal configurado: no se indicó cómo obtener IdEmpresa.",
        });
      }

      const rawEmpresaId = await getEmpresaIdFromReq(req);
      const idEmpresa = normalizeEmpresaId(rawEmpresaId);

      if (!idEmpresa) {
        return res.status(400).json({
          ok: false,
          code: "EMPRESA_REQUIRED",
          message: "No se recibió una empresa válida para validar la licencia.",
        });
      }

      // ======================================================
      // LICENCIA ACTIVA
      // La función valida:
      // - Estado = ACTIVA
      // - FechaInicio <= hoy
      // - FechaFin >= hoy
      // ======================================================
      const licencia = await getActiveEmpresaLicense(idEmpresa);

      if (!licencia) {
        return res.status(403).json({
          ok: false,
          code: "LICENSE_EXPIRED",
          message:
            "La licencia de esta empresa ha vencido. Debe renovar para continuar usando CSI Legal.",
        });
      }

      // Guardamos la licencia en req por si el controller la necesita.
      req.empresaLicense = licencia;
      req.idEmpresaLicenciaValidada = idEmpresa;

      return next();
    } catch (error) {
      console.error("Error validando licencia de empresa:", error);

      return res.status(500).json({
        ok: false,
        code: "LICENSE_VALIDATION_ERROR",
        message: "Error interno validando la licencia de empresa.",
      });
    }
  };
}
