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

function parseEstado(value, fallback = 1) {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
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

async function getEmpresaViewById(idEmpresa) {
  const { data, error } = await supabase
    .from("vw_EmpresasPorPais")
    .select("*")
    .eq("IdEmpresa", idEmpresa)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

/**
 * GET /api/empresas?paisId=1
 * Devuelve empresas visibles para el usuario logueado
 */
/**
 * @swagger
 * /api/empresas:
 *   get:
 *     summary: Obtener listado de empresas disponibles que se registran en el sistema
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
 *     summary: Seleccionar una empresa por ID
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
      .from("vw_EmpresasPorPais")
      .select("*")
      .eq("IdEmpresa", id)
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

/**
 * @swagger
 * /api/empresas:
 *   post:
 *     summary: Crear empresa
 *     tags:
 *       - Empresas
 *     security:
 *       - bearerAuth: []
 *     parameters: []
 *     responses:
 *       201:
 *         description: Empresa creada correctamente
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Ya existe una empresa con ese nombre
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  "/",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_EDITAR"]),
  async (req, res) => {
    try {
      const nombre = normalizeText(req.body?.Nombre ?? req.body?.nombre);
      const tipo = normalizeText(req.body?.Tipo ?? req.body?.tipo);
      const descripcion = normalizeNullableText(req.body?.Descripcion ?? req.body?.descripcion);
      const idPais = toInt(req.body?.IdPais ?? req.body?.idPais);
      const estado = parseEstado(req.body?.Estado ?? req.body?.estado, 1);

      if (!nombre) {
        return res.status(400).json({
          ok: false,
          message: "Nombre es requerido",
        });
      }

      if (!tipo) {
        return res.status(400).json({
          ok: false,
          message: "Tipo es requerido",
        });
      }

      if (!idPais || idPais <= 0) {
        return res.status(400).json({
          ok: false,
          message: "IdPais es requerido",
        });
      }

      const { data: pais, error: paisError } = await supabase
        .from("Paises")
        .select("id")
        .eq("id", idPais)
        .maybeSingle();

      if (paisError) {
        return res.status(500).json({
          ok: false,
          message: "Error validando pais",
          detail: paisError.message,
        });
      }

      if (!pais) {
        return res.status(404).json({
          ok: false,
          message: "Pais no encontrado",
        });
      }

      const { data: duplicate, error: duplicateError } = await supabase
        .from("Empresas")
        .select("id")
        .eq("Nombre", nombre)
        .maybeSingle();

      if (duplicateError) {
        return res.status(500).json({
          ok: false,
          message: "Error validando empresa duplicada",
          detail: duplicateError.message,
        });
      }

      if (duplicate) {
        return res.status(409).json({
          ok: false,
          message: "Ya existe una empresa con ese nombre",
        });
      }

      const { data, error } = await supabase
        .from("Empresas")
        .insert({
          Nombre: nombre,
          Tipo: tipo,
          Descripcion: descripcion,
          IdPais: idPais,
          IdUsuario: req.user?.id || null,
          Estado: estado,
        })
        .select('id, "Nombre", "Tipo", "Descripcion", "IdPais", "IdUsuario", "Estado"')
        .single();

      if (error) {
        return res.status(500).json({
          ok: false,
          message: "Error creando empresa",
          detail: error.message,
        });
      }

      const empresaView = await getEmpresaViewById(Number(data.id));

      return res.status(201).json({
        ok: true,
        message: "Empresa creada correctamente",
        Empresa: empresaView || data,
      });
    } catch (error) {
      console.error("POST /api/empresas error:", error);

      return res.status(500).json({
        ok: false,
        message: "Error interno creando empresa",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/empresas/{id}:
 *   put:
 *     summary: Editar empresa
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
 *     responses:
 *       200:
 *         description: Empresa actualizada correctamente
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Ya existe otra empresa con ese nombre
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
      const nombre = normalizeText(req.body?.Nombre ?? req.body?.nombre);
      const tipo = normalizeText(req.body?.Tipo ?? req.body?.tipo);
      const descripcion = normalizeNullableText(req.body?.Descripcion ?? req.body?.descripcion);
      const idPais = toInt(req.body?.IdPais ?? req.body?.idPais);
      const estado = parseEstado(req.body?.Estado ?? req.body?.estado, 1);

      if (!id || id <= 0) {
        return res.status(400).json({
          ok: false,
          message: "id invalido",
        });
      }

      if (!nombre) {
        return res.status(400).json({
          ok: false,
          message: "Nombre es requerido",
        });
      }

      if (!tipo) {
        return res.status(400).json({
          ok: false,
          message: "Tipo es requerido",
        });
      }

      if (!idPais || idPais <= 0) {
        return res.status(400).json({
          ok: false,
          message: "IdPais es requerido",
        });
      }

      const { data: existing, error: existingError } = await supabase
        .from("Empresas")
        .select("id")
        .eq("id", id)
        .maybeSingle();

      if (existingError) {
        return res.status(500).json({
          ok: false,
          message: "Error validando empresa",
          detail: existingError.message,
        });
      }

      if (!existing) {
        return res.status(404).json({
          ok: false,
          message: "Empresa no encontrada",
        });
      }

      const { data: pais, error: paisError } = await supabase
        .from("Paises")
        .select("id")
        .eq("id", idPais)
        .maybeSingle();

      if (paisError) {
        return res.status(500).json({
          ok: false,
          message: "Error validando pais",
          detail: paisError.message,
        });
      }

      if (!pais) {
        return res.status(404).json({
          ok: false,
          message: "Pais no encontrado",
        });
      }

      const { data: duplicate, error: duplicateError } = await supabase
        .from("Empresas")
        .select("id")
        .eq("Nombre", nombre)
        .neq("id", id)
        .maybeSingle();

      if (duplicateError) {
        return res.status(500).json({
          ok: false,
          message: "Error validando empresa duplicada",
          detail: duplicateError.message,
        });
      }

      if (duplicate) {
        return res.status(409).json({
          ok: false,
          message: "Ya existe otra empresa con ese nombre",
        });
      }

      const { data, error } = await supabase
        .from("Empresas")
        .update({
          Nombre: nombre,
          Tipo: tipo,
          Descripcion: descripcion,
          IdPais: idPais,
          Estado: estado,
        })
        .eq("id", id)
        .select('id, "Nombre", "Tipo", "Descripcion", "IdPais", "IdUsuario", "Estado"')
        .single();

      if (error) {
        return res.status(500).json({
          ok: false,
          message: "Error actualizando empresa",
          detail: error.message,
        });
      }

      const empresaView = await getEmpresaViewById(Number(data.id));

      return res.json({
        ok: true,
        message: "Empresa actualizada correctamente",
        Empresa: empresaView || data,
      });
    } catch (error) {
      console.error("PUT /api/empresas/:id error:", error);

      return res.status(500).json({
        ok: false,
        message: "Error interno actualizando empresa",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/empresas/{id}:
 *   delete:
 *     summary: Eliminar empresa
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
 *     responses:
 *       200:
 *         description: Empresa inactivada correctamente
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
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

      const { data, error } = await supabase
        .from("Empresas")
        .update({ Estado: 0 })
        .eq("id", id)
        .select('id, "Nombre", "Tipo", "Descripcion", "IdPais", "IdUsuario", "Estado"')
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          ok: false,
          message: "Error eliminando empresa",
          detail: error.message,
        });
      }

      if (!data) {
        return res.status(404).json({
          ok: false,
          message: "Empresa no encontrada",
        });
      }

      const empresaView = await getEmpresaViewById(Number(data.id));

      return res.json({
        ok: true,
        message: "Empresa inactivada correctamente",
        Empresa: empresaView || data,
      });
    } catch (error) {
      console.error("DELETE /api/empresas/:id error:", error);

      return res.status(500).json({
        ok: false,
        message: "Error interno eliminando empresa",
        detail: error.message,
      });
    }
  }
);

export default router;
