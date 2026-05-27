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
/**
 * @swagger
 * /api/empresas:
 *   get:
 *     summary: Obtener listado de empresas disponibles
 *     description: Retorna las empresas disponibles para el usuario autenticado. Puede filtrarse por país mediante paisId.
 *     tags:
 *       - Empresas
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: paisId
 *         required: false
 *         schema:
 *           type: integer
 *           example: 1
 *         description: ID del país para filtrar las empresas. Debe ser un entero positivo.
 *     responses:
 *       200:
 *         description: Listado de empresas obtenido correctamente
 *       400:
 *         description: Parámetro paisId inválido
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
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

/**
 * @swagger
 * /api/empresas/{id}:
 *   get:
 *     summary: Obtener una empresa por ID
 *     description: Retorna la información básica de una empresa según el ID indicado, validando el alcance del usuario autenticado.
 *     tags:
 *       - Empresas
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *           example: 1
 *         description: ID de la empresa a consultar.
 *     responses:
 *       200:
 *         description: Empresa obtenida correctamente
 *       400:
 *         description: ID inválido
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: El usuario no tiene acceso a esta empresa
 *       404:
 *         description: Empresa no encontrada
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
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