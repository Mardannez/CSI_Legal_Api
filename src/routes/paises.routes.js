import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { authorizeGlobalPermission } from "../middlewares/authorizeGlobalPermission.middleware.js";

const router = Router();

function toInt(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function normalizeText(value) {
  return (value || "").toString().trim();
}

function normalizeNullableText(value) {
  const text = normalizeText(value);
  return text ? text : null;
}

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

/**
 * @swagger
 * /api/paises:
 *   post:
 *     summary: Crear pais
 *     tags:
 *       - Paises
 *     security:
 *       - bearerAuth: []
 *     parameters: []
 *     responses:
 *       201:
 *         description: Pais creado correctamente
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       409:
 *         description: Ya existe un pais con ese nombre
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  "/",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_EDITAR"]),
  async (req, res) => {
    try {
      const pais = normalizeText(req.body?.Pais ?? req.body?.pais);
      const bandera = normalizeNullableText(req.body?.Bandera ?? req.body?.bandera);
      const descripcionActividades = normalizeNullableText(
        req.body?.DescripcionActividades ?? req.body?.descripcionActividades
      );

      if (!pais) {
        return res.status(400).json({
          ok: false,
          message: "Pais es requerido",
        });
      }

      const { data: duplicate, error: duplicateError } = await supabase
        .from("Paises")
        .select("id")
        .eq("Pais", pais)
        .maybeSingle();

      if (duplicateError) {
        return res.status(500).json({
          ok: false,
          message: "Error validando pais duplicado",
          detail: duplicateError.message,
        });
      }

      if (duplicate) {
        return res.status(409).json({
          ok: false,
          message: "Ya existe un pais con ese nombre",
        });
      }

      const { data, error } = await supabase
        .from("Paises")
        .insert({
          Pais: pais,
          Bandera: bandera,
          DescripcionActividades: descripcionActividades,
          FechaRegistro: new Date().toISOString(),
        })
        .select('id, "Pais", "Bandera", "DescripcionActividades", "FechaRegistro"')
        .single();

      if (error) {
        return res.status(500).json({
          ok: false,
          message: "Error creando pais",
          detail: error.message,
        });
      }

      return res.status(201).json({
        ok: true,
        message: "Pais creado correctamente",
        Pais: data,
      });
    } catch (error) {
      console.error("POST /api/paises error:", error);

      return res.status(500).json({
        ok: false,
        message: "Error interno creando pais",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/paises/{id}:
 *   put:
 *     summary: Editar pais
 *     tags:
 *       - Paises
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Pais actualizado correctamente
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Ya existe otro pais con ese nombre
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.put(
  "/:id",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_EDITAR"]),
  async (req, res) => {
    try {
      const id = toInt(req.params.id);
      const pais = normalizeText(req.body?.Pais ?? req.body?.pais);
      const bandera = normalizeNullableText(req.body?.Bandera ?? req.body?.bandera);
      const descripcionActividades = normalizeNullableText(
        req.body?.DescripcionActividades ?? req.body?.descripcionActividades
      );

      if (!id || id <= 0) {
        return res.status(400).json({
          ok: false,
          message: "id invalido",
        });
      }

      if (!pais) {
        return res.status(400).json({
          ok: false,
          message: "Pais es requerido",
        });
      }

      const { data: existing, error: existingError } = await supabase
        .from("Paises")
        .select("id")
        .eq("id", id)
        .maybeSingle();

      if (existingError) {
        return res.status(500).json({
          ok: false,
          message: "Error validando pais",
          detail: existingError.message,
        });
      }

      if (!existing) {
        return res.status(404).json({
          ok: false,
          message: "Pais no encontrado",
        });
      }

      const { data: duplicate, error: duplicateError } = await supabase
        .from("Paises")
        .select("id")
        .eq("Pais", pais)
        .neq("id", id)
        .maybeSingle();

      if (duplicateError) {
        return res.status(500).json({
          ok: false,
          message: "Error validando pais duplicado",
          detail: duplicateError.message,
        });
      }

      if (duplicate) {
        return res.status(409).json({
          ok: false,
          message: "Ya existe otro pais con ese nombre",
        });
      }

      const { data, error } = await supabase
        .from("Paises")
        .update({
          Pais: pais,
          Bandera: bandera,
          DescripcionActividades: descripcionActividades,
        })
        .eq("id", id)
        .select('id, "Pais", "Bandera", "DescripcionActividades", "FechaRegistro"')
        .single();

      if (error) {
        return res.status(500).json({
          ok: false,
          message: "Error actualizando pais",
          detail: error.message,
        });
      }

      return res.json({
        ok: true,
        message: "Pais actualizado correctamente",
        Pais: data,
      });
    } catch (error) {
      console.error("PUT /api/paises/:id error:", error);

      return res.status(500).json({
        ok: false,
        message: "Error interno actualizando pais",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/paises/{id}:
 *   delete:
 *     summary: Eliminar pais
 *     tags:
 *       - Paises
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Pais eliminado correctamente
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: El pais tiene empresas relacionadas
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.delete(
  "/:id",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_EDITAR"]),
  async (req, res) => {
    try {
      const id = toInt(req.params.id);

      if (!id || id <= 0) {
        return res.status(400).json({
          ok: false,
          message: "id invalido",
        });
      }

      const { data: empresas, error: empresasError } = await supabase
        .from("Empresas")
        .select("id")
        .eq("IdPais", id)
        .limit(1);

      if (empresasError) {
        return res.status(500).json({
          ok: false,
          message: "Error validando empresas relacionadas",
          detail: empresasError.message,
        });
      }

      if ((empresas || []).length > 0) {
        return res.status(409).json({
          ok: false,
          message: "No se puede eliminar el pais porque tiene empresas relacionadas",
        });
      }

      const { data, error } = await supabase
        .from("Paises")
        .delete()
        .eq("id", id)
        .select('id, "Pais", "Bandera", "DescripcionActividades", "FechaRegistro"')
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          ok: false,
          message: "Error eliminando pais",
          detail: error.message,
        });
      }

      if (!data) {
        return res.status(404).json({
          ok: false,
          message: "Pais no encontrado",
        });
      }

      return res.json({
        ok: true,
        message: "Pais eliminado correctamente",
        Pais: data,
      });
    } catch (error) {
      console.error("DELETE /api/paises/:id error:", error);

      return res.status(500).json({
        ok: false,
        message: "Error interno eliminando pais",
        detail: error.message,
      });
    }
  }
);

export default router;
