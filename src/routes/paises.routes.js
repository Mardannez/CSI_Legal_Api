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

/**
 * @swagger
 * /api/paises:
 *   get:
 *     summary: Obtener listado de países disponibles
 *     description: >
 *       Retorna el listado de países disponibles para el usuario autenticado.
 *       Si el usuario es SUPER_ADMIN, devuelve todos los países registrados.
 *       Si el usuario pertenece a empresas específicas, devuelve únicamente
 *       los países relacionados a sus empresas asignadas y recalcula el
 *       CompanyCount según su alcance.
 *     tags:
 *       - Paises
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Listado de países obtenido correctamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 Paises:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 1
 *                       Pais:
 *                         type: string
 *                         example: Honduras
 *                       Bandera:
 *                         type: string
 *                         nullable: true
 *                         example: hn
 *                       DescripcionActividades:
 *                         type: string
 *                         nullable: true
 *                         example: Actividades legales y regulatorias aplicables en Honduras
 *                       CompanyCount:
 *                         type: integer
 *                         example: 3
 *             examples:
 *               superAdmin:
 *                 summary: Respuesta para SUPER_ADMIN
 *                 value:
 *                   Paises:
 *                     - id: 1
 *                       Pais: Honduras
 *                       Bandera: hn
 *                       DescripcionActividades: Actividades legales y regulatorias aplicables en Honduras
 *                       CompanyCount: 5
 *                     - id: 2
 *                       Pais: Guatemala
 *                       Bandera: gt
 *                       DescripcionActividades: Actividades legales y regulatorias aplicables en Guatemala
 *                       CompanyCount: 2
 *               usuarioSinEmpresas:
 *                 summary: Usuario sin empresas asignadas
 *                 value:
 *                   Paises: []
 *       401:
 *         description: Token no enviado, inválido o expirado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Token no enviado o inválido
 *       500:
 *         description: Error interno consultando países o empresas asignadas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Error consultando países
 *                 detail:
 *                   type: string
 *                   nullable: true
 *                   example: Error de conexión con Supabase
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