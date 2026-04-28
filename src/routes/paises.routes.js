import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = Router();

async function getUserScope(userId) {
  const { data: isGlobalAdmin, error: adminError } = await supabase.rpc(
    "fn_es_admin_global",
    { p_id_usuario: userId }
  );

  if (adminError) throw adminError;

  const { data: usuarioEmpresas, error: usuarioEmpresasError } = await supabase
    .from("UsuarioEmpresa")
    .select("IdEmpresa")
    .eq("IdUsuario", userId)
    .eq("Estado", 1);

  if (usuarioEmpresasError) throw usuarioEmpresasError;

  const empresaIds = [
    ...new Set((usuarioEmpresas || []).map((x) => Number(x.IdEmpresa)).filter(Boolean)),
  ];

  if (isGlobalAdmin === true) {
    return {
      isGlobalAdmin: true,
      empresaIds: [],
      paisIds: [],
    };
  }

  if (empresaIds.length === 0) {
    return {
      isGlobalAdmin: false,
      empresaIds: [],
      paisIds: [],
    };
  }

  const { data: empresas, error: empresasError } = await supabase
    .from("Empresas")
    .select("id, IdPais")
    .in("id", empresaIds);

  if (empresasError) throw empresasError;

  const paisIds = [
    ...new Set((empresas || []).map((x) => Number(x.IdPais)).filter(Boolean)),
  ];

  return {
    isGlobalAdmin: false,
    empresaIds,
    paisIds,
  };
}

/**
 * GET /api/paises
 * Lista de países visibles para el usuario logueado
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const scope = await getUserScope(userId);

    if (!scope.isGlobalAdmin && scope.empresaIds.length === 0) {
      return res.json({ Paises: [] });
    }

    let paisesQuery = supabase
      .from("vw_PaisesConCompanyCount")
      .select('id, "Pais", "Bandera", "DescripcionActividades", "CompanyCount"')
      .order("Pais", { ascending: true });

    if (!scope.isGlobalAdmin) {
      paisesQuery = paisesQuery.in("id", scope.paisIds);
    }

    const { data: paisesData, error: paisesError } = await paisesQuery;

    if (paisesError) {
      return res.status(500).json({
        message: "Error consultando países",
        detail: paisesError.message,
      });
    }

    if (scope.isGlobalAdmin) {
      return res.json({ Paises: paisesData || [] });
    }

    const { data: empresasData, error: empresasError } = await supabase
      .from("Empresas")
      .select("id, IdPais")
      .in("id", scope.empresaIds);

    if (empresasError) {
      return res.status(500).json({
        message: "Error consultando empresas asignadas",
        detail: empresasError.message,
      });
    }

    const companyCountByPais = {};
    for (const emp of empresasData || []) {
      const idPais = Number(emp.IdPais);
      if (!idPais) continue;
      companyCountByPais[idPais] = (companyCountByPais[idPais] || 0) + 1;
    }

    const Paises = (paisesData || []).map((p) => ({
      ...p,
      CompanyCount: companyCountByPais[Number(p.id)] || 0,
    }));

    return res.json({ Paises });
  } catch (err) {
    console.error("GET /api/paises error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;