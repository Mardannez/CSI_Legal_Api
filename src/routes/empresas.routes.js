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
 * GET /api/empresas?paisId=1
 * Devuelve empresas visibles para el usuario logueado
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const scope = await getUserScope(userId);

    const paisIdRaw = req.query.paisId;

    let paisId = null;
    if (paisIdRaw !== undefined) {
      const n = Number(paisIdRaw);
      if (!Number.isInteger(n) || n <= 0) {
        return res.status(400).json({
          message: "paisId debe ser un entero positivo",
        });
      }
      paisId = n;
    }

    if (!scope.isGlobalAdmin && scope.empresaIds.length === 0) {
      return res.json({ Empresas: [] });
    }

    if (!scope.isGlobalAdmin && paisId && !scope.paisIds.includes(paisId)) {
      return res.json({ Empresas: [] });
    }

    let query = supabase
      .from("vw_EmpresasPorPais")
      .select("*")
      .order("Empresa", { ascending: true });

    if (paisId) {
      query = query.eq("IdPais", paisId);
    }

    if (!scope.isGlobalAdmin) {
      query = query.in("IdEmpresa", scope.empresaIds);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({
        message: "Error consultando empresas",
        detail: error.message,
      });
    }

    return res.json({ Empresas: data || [] });
  } catch (err) {
    console.error("GET /api/empresas error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

/**
 * GET /api/empresas/:id
 * Devuelve datos de una empresa por id, validando acceso
 */
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const scope = await getUserScope(userId);

    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "id inválido" });
    }

    if (!scope.isGlobalAdmin && !scope.empresaIds.includes(id)) {
      return res.status(403).json({
        message: "No tienes acceso a esta empresa",
      });
    }

    const { data, error } = await supabase
      .from("Empresas")
      .select('id, "Nombre", "Tipo", "Descripcion", "IdPais"')
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        message: "Error consultando empresa",
        detail: error.message,
      });
    }

    if (!data) {
      return res.status(404).json({ message: "Empresa no encontrada" });
    }

    return res.json({ Empresa: data });
  } catch (err) {
    console.error("GET /api/empresas/:id error:", err);
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;