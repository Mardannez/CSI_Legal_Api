import { Router } from "express";
import bcrypt from "bcryptjs";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { authorizeGlobalPermission } from "../middlewares/authorizeGlobalPermission.middleware.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Usuarios
 *     description: Mantenimiento de usuarios, empresas y roles asignados
 */

const ESTADO_ACTIVO = 1;
const ESTADO_INACTIVO = 0;
const SALT_ROUNDS = 10;

/**
 * Helpers
 */
function toInt(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function normalizeText(value) {
  return (value || "").toString().trim();
}

function normalizeNullableText(value) {
  const text = (value || "").toString().trim();
  return text ? text : null;
}

function parseBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "1";
  }
  if (typeof value === "number") {
    return value === 1;
  }
  return false;
}

function parseEstado(value, fallback = ESTADO_ACTIVO) {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Validaciones base
 */
async function getUsuarioById(idUsuario) {
  const { data, error } = await supabase
    .from("Usuarios")
    .select('id, "Usuario", "Password", "FechaRegistro", "Estado", "NombreCompleto", "Correo"')
    .eq("id", idUsuario)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getEmpresaById(idEmpresa) {
  const { data, error } = await supabase
    .from("Empresas")
    .select('id, "Nombre", "Estado"')
    .eq("id", idEmpresa)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getRolById(idRol) {
  const { data, error } = await supabase
    .from("Roles")
    .select('"IdRol", "Codigo", "Nombre", "Ambito", "Descripcion", "Estado", "FechaRegistro"')
    .eq("IdRol", idRol)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getUsuarioEmpresaById(idUsuarioEmpresa) {
  const { data, error } = await supabase
    .from("UsuarioEmpresa")
    .select('"IdUsuarioEmpresa", "IdUsuario", "IdEmpresa", "EsPrincipal", "Estado", "FechaAsignacion"')
    .eq("IdUsuarioEmpresa", idUsuarioEmpresa)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getUsuarioEmpresaRolById(idUsuarioEmpresaRol) {
  const { data, error } = await supabase
    .from("UsuarioEmpresaRol")
    .select('"IdUsuarioEmpresaRol", "IdUsuarioEmpresa", "IdRol", "Estado", "FechaAsignacion"')
    .eq("IdUsuarioEmpresaRol", idUsuarioEmpresaRol)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getUsuarioRolGlobalById(idUsuarioRolGlobal) {
  const { data, error } = await supabase
    .from("UsuarioRolGlobal")
    .select('"IdUsuarioRolGlobal", "IdUsuario", "IdRol", "Estado", "FechaAsignacion"')
    .eq("IdUsuarioRolGlobal", idUsuarioRolGlobal)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Catálogos auxiliares para responder más rico en listados
 */
async function getEmpresasMapByIds(idsEmpresa) {
  const uniqueIds = [...new Set((idsEmpresa || []).filter(Boolean).map(Number))];

  if (uniqueIds.length === 0) return {};

  const [{ data, error }, licenciasMap] = await Promise.all([
    supabase
      .from("Empresas")
      .select('id, "Nombre", "Estado"')
      .in("id", uniqueIds),

    getLicenciasMapByEmpresaIds(uniqueIds),
  ]);

  if (error) throw error;

  return Object.fromEntries(
    (data || []).map((row) => {
      const idEmpresa = Number(row.id);
      const licencia = licenciasMap[idEmpresa] || null;

      return [
        idEmpresa,
        {
          ...row,

          // ==================================================
          // LICENCIAS DE EMPRESA
          // Se agrega al objeto Empresa para que el frontend
          // pueda mostrar si el usuario podrá ingresar o no.
          // ==================================================
          Licencia: buildLicenciaInfo(licencia),
        },
      ];
    })
  );
}


async function getRolesMapByIds(idsRol) {
  const uniqueIds = [...new Set((idsRol || []).filter(Boolean).map(Number))];

  if (uniqueIds.length === 0) return {};

  const { data, error } = await supabase
    .from("Roles")
    .select('"IdRol", "Codigo", "Nombre", "Ambito", "Descripcion", "Estado", "FechaRegistro"')
    .in("IdRol", uniqueIds);

  if (error) throw error;

  return Object.fromEntries((data || []).map((row) => [Number(row.IdRol), row]));
}


/**
 * ============================================================
 * LICENCIAS DE EMPRESA
 * Helpers para mostrar el estado de licencia dentro del
 * mantenimiento de usuarios.
 *
 * Importante:
 * - La licencia pertenece a la empresa, no al usuario.
 * - Aquí solo enriquecemos la respuesta para administración.
 * - No bloqueamos estas rutas por licencia, porque SUPER_ADMIN
 *   necesita administrar empresas aunque estén vencidas.
 * ============================================================
 */

function getTodayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function calcularEstadoLicencia(licencia) {
  if (!licencia) return "SIN_LICENCIA";

  const today = getTodayDateOnly();

  if (licencia.Estado !== "ACTIVA") {
    return licencia.Estado || "SIN_LICENCIA";
  }

  if (licencia.FechaInicio && licencia.FechaInicio > today) {
    return "PENDIENTE";
  }

  if (licencia.FechaFin && licencia.FechaFin < today) {
    return "VENCIDA";
  }

  return "ACTIVA";
}

function calcularDiasRestantes(fechaFin) {
  if (!fechaFin) return null;

  const today = new Date(`${getTodayDateOnly()}T00:00:00.000Z`);
  const end = new Date(`${fechaFin}T00:00:00.000Z`);

  if (Number.isNaN(end.getTime())) return null;

  const diffMs = end.getTime() - today.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return Math.max(diffDays, 0);
}

function buildLicenciaInfo(licencia) {
  const estadoCalculado = calcularEstadoLicencia(licencia);

  if (!licencia) {
    return {
      id: null,
      idEmpresa: null,
      fechaInicio: null,
      fechaFin: null,
      estado: "SIN_LICENCIA",
      estadoCalculado,
      tipoLicencia: null,
      maxUsuarios: null,
      diasRestantes: 0,
      puedeAcceder: false,
    };
  }

  return {
    id: Number(licencia.id),
    idEmpresa: Number(licencia.IdEmpresa),
    fechaInicio: licencia.FechaInicio || null,
    fechaFin: licencia.FechaFin || null,
    estado: licencia.Estado || null,
    estadoCalculado,
    tipoLicencia: licencia.TipoLicencia || null,
    maxUsuarios: licencia.MaxUsuarios ?? null,
    diasRestantes: calcularDiasRestantes(licencia.FechaFin),
    puedeAcceder: estadoCalculado === "ACTIVA",
  };
}

async function getLicenciasMapByEmpresaIds(idsEmpresa) {
  const uniqueIds = [...new Set((idsEmpresa || []).filter(Boolean).map(Number))];

  if (uniqueIds.length === 0) return {};

  const { data, error } = await supabase
    .from("EmpresaLicencia")
    .select(
      'id, "IdEmpresa", "FechaInicio", "FechaFin", "Estado", "TipoLicencia", "MaxUsuarios"'
    )
    .in("IdEmpresa", uniqueIds)
    .order("FechaFin", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw error;

  const map = {};

  for (const licencia of data || []) {
    const idEmpresa = Number(licencia.IdEmpresa);

    // Tomamos solo la licencia más reciente por empresa.
    if (!map[idEmpresa]) {
      map[idEmpresa] = licencia;
    }
  }

  return map;
}



/**
 * @swagger
 * /api/usuarios/catalogos:
 *   get:
 *     summary: Obtener catalogos para usuarios
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Catalogos consultados
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * ============================================================
 * GET /api/usuarios/catalogos
 * Devuelve empresas y roles disponibles para poblar combos
 * ============================================================
 */
router.get(
  "/catalogos",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_VER"]),
  async (req, res) => {
    try {
      const { data: empresas, error: empresasError } = await supabase
        .from("Empresas")
        .select('id, "Nombre", "Estado"')
        .eq("Estado", ESTADO_ACTIVO)
        .order("Nombre", { ascending: true });

      if (empresasError) {
        return res.status(500).json({
          message: "Error consultando empresas",
          detail: empresasError.message,
        });
      }

      const { data: roles, error: rolesError } = await supabase
        .from("Roles")
        .select('"IdRol", "Codigo", "Nombre", "Ambito", "Descripcion", "Estado"')
        .eq("Estado", ESTADO_ACTIVO)
        .order("Nombre", { ascending: true });

      if (rolesError) {
        return res.status(500).json({
          message: "Error consultando roles",
          detail: rolesError.message,
        });
      }

      return res.json({
        Empresas: empresas || [],
        RolesGlobales: (roles || []).filter((r) => r.Ambito === "GLOBAL"),
        RolesEmpresa: (roles || []).filter((r) => r.Ambito === "EMPRESA"),
      });
    } catch (error) {
      console.error("GET /usuarios/catalogos error:", error);
      return res.status(500).json({
        message: "Error interno consultando catálogos",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/usuarios:
 *   get:
 *     summary: Listar usuarios
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         required: false
 *         schema:
 *           type: integer
 *       - in: query
 *         name: pageSize
 *         required: false
 *         schema:
 *           type: integer
 *       - in: query
 *         name: q
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: estado
 *         required: false
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Usuarios consultados
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * ============================================================
 * GET /api/usuarios
 * Lista paginada de usuarios
 * ============================================================
 */
router.get(
  "/",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_VER"]),
  async (req, res) => {
    try {
      const page = Math.max(1, toInt(req.query.page) || 1);
      const pageSize = Math.max(1, Math.min(100, toInt(req.query.pageSize) || 10));
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const q = normalizeText(req.query.q);
      const estado = req.query.estado !== undefined ? toInt(req.query.estado) : null;

      let query = supabase
        .from("Usuarios")
        .select(
          'id, "Usuario", "FechaRegistro", "Estado", "NombreCompleto", "Correo"',
          { count: "exact" }
        )
        .order("id", { ascending: true })
        .range(from, to);

      if (q) {
        query = query.or(
          `"Usuario".ilike.%${q}%,"NombreCompleto".ilike.%${q}%,"Correo".ilike.%${q}%`
        );
      }

      if (estado !== null) {
        query = query.eq("Estado", estado);
      }

      const { data: usuarios, error, count } = await query;

      if (error) {
        return res.status(500).json({
          message: "Error consultando usuarios",
          detail: error.message,
        });
      }

      const userIds = (usuarios || []).map((u) => Number(u.id));

      let empresasByUsuario = {};
      let rolesGlobalesByUsuario = {};

      if (userIds.length > 0) {
        // UsuarioEmpresa
        const { data: usuarioEmpresas, error: usuarioEmpresasError } = await supabase
          .from("UsuarioEmpresa")
          .select('"IdUsuarioEmpresa", "IdUsuario", "IdEmpresa", "EsPrincipal", "Estado", "FechaAsignacion"')
          .in("IdUsuario", userIds);

        if (usuarioEmpresasError) {
          return res.status(500).json({
            message: "Error consultando empresas asignadas",
            detail: usuarioEmpresasError.message,
          });
        }

        const empresasMap = await getEmpresasMapByIds(
          (usuarioEmpresas || []).map((x) => x.IdEmpresa)
        );

        empresasByUsuario = (usuarioEmpresas || []).reduce((acc, row) => {
          const key = Number(row.IdUsuario);
          if (!acc[key]) acc[key] = [];

          acc[key].push({
            ...row,
            Empresa: empresasMap[Number(row.IdEmpresa)] || null,
          });

          return acc;
        }, {});

        // UsuarioRolGlobal
        const { data: usuarioRolesGlobal, error: usuarioRolesGlobalError } = await supabase
          .from("UsuarioRolGlobal")
          .select('"IdUsuarioRolGlobal", "IdUsuario", "IdRol", "Estado", "FechaAsignacion"')
          .in("IdUsuario", userIds);

        if (usuarioRolesGlobalError) {
          return res.status(500).json({
            message: "Error consultando roles globales",
            detail: usuarioRolesGlobalError.message,
          });
        }

        const rolesMap = await getRolesMapByIds(
          (usuarioRolesGlobal || []).map((x) => x.IdRol)
        );

        rolesGlobalesByUsuario = (usuarioRolesGlobal || []).reduce((acc, row) => {
          const key = Number(row.IdUsuario);
          if (!acc[key]) acc[key] = [];

          acc[key].push({
            ...row,
            Rol: rolesMap[Number(row.IdRol)] || null,
          });

          return acc;
        }, {});
      }

      const result = (usuarios || []).map((user) => ({
        ...user,
        EmpresasAsignadas: empresasByUsuario[Number(user.id)] || [],
        RolesGlobales: rolesGlobalesByUsuario[Number(user.id)] || [],
      }));

      return res.json({
        Usuarios: result,
        Pagination: {
          page,
          pageSize,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / pageSize),
        },
      });
    } catch (error) {
      console.error("GET /usuarios error:", error);
      return res.status(500).json({
        message: "Error interno consultando usuarios",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/usuarios/{id}/empresas:
 *   get:
 *     summary: Listar empresas asignadas a usuario
 *     tags: [Usuarios]
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
 *         description: Empresas del usuario consultadas
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

/**
 * ============================================================
 * GET /api/usuarios/:id/empresas
 * Lista empresas asignadas a un usuario
 * ============================================================
 */
router.get(
  "/:id/empresas",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_VER"]),
  async (req, res) => {
    try {
      const idUsuario = toInt(req.params.id);

      if (!idUsuario || idUsuario <= 0) {
        return res.status(400).json({ message: "id de usuario inválido" });
      }

      const usuario = await getUsuarioById(idUsuario);
      if (!usuario) {
        return res.status(404).json({ message: "Usuario no encontrado" });
      }

      const { data: rows, error } = await supabase
        .from("UsuarioEmpresa")
        .select('"IdUsuarioEmpresa", "IdUsuario", "IdEmpresa", "EsPrincipal", "Estado", "FechaAsignacion"')
        .eq("IdUsuario", idUsuario)
        .order("FechaAsignacion", { ascending: false });

      if (error) {
        return res.status(500).json({
          message: "Error consultando empresas del usuario",
          detail: error.message,
        });
      }

      const empresasMap = await getEmpresasMapByIds((rows || []).map((x) => x.IdEmpresa));

      return res.json({
        Usuario: {
          id: usuario.id,
          Usuario: usuario.Usuario,
          NombreCompleto: usuario.NombreCompleto,
          Correo: usuario.Correo,
          Estado: usuario.Estado,
        },
        EmpresasAsignadas: (rows || []).map((row) => ({
          ...row,
          Empresa: empresasMap[Number(row.IdEmpresa)] || null,
        })),
      });
    } catch (error) {
      console.error("GET /usuarios/:id/empresas error:", error);
      return res.status(500).json({
        message: "Error interno consultando empresas del usuario",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/usuarios/{id}/empresas:
 *   post:
 *     summary: Asignar empresa a usuario
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       201:
 *         description: Empresa asignada
 *       400:
 *         description: Parametros o datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * ============================================================
 * POST /api/usuarios/:id/empresas
 * Asigna empresa a usuario
 * ============================================================
 */
router.post(
  "/:id/empresas",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_EDITAR"]),
  async (req, res) => {
    try {
      const idUsuario = toInt(req.params.id);
      const idEmpresa = toInt(req.body?.idEmpresa);
      const esPrincipal = parseBool(req.body?.esPrincipal);
      const estado = parseEstado(req.body?.estado, ESTADO_ACTIVO);

      if (!idUsuario || idUsuario <= 0) {
        return res.status(400).json({ message: "id de usuario inválido" });
      }

      if (!idEmpresa || idEmpresa <= 0) {
        return res.status(400).json({ message: "idEmpresa es requerido" });
      }

      const usuario = await getUsuarioById(idUsuario);
      if (!usuario) {
        return res.status(404).json({ message: "Usuario no encontrado" });
      }

      const empresa = await getEmpresaById(idEmpresa);
      if (!empresa) {
        return res.status(404).json({ message: "Empresa no encontrada" });
      }

      // Buscar si ya existe relación
      const { data: existing, error: existingError } = await supabase
        .from("UsuarioEmpresa")
        .select('"IdUsuarioEmpresa", "IdUsuario", "IdEmpresa", "EsPrincipal", "Estado", "FechaAsignacion"')
        .eq("IdUsuario", idUsuario)
        .eq("IdEmpresa", idEmpresa)
        .maybeSingle();

      if (existingError) {
        return res.status(500).json({
          message: "Error validando empresa asignada",
          detail: existingError.message,
        });
      }

      let savedRow = null;

      if (existing) {
        const { data: updated, error: updateError } = await supabase
          .from("UsuarioEmpresa")
          .update({
            EsPrincipal: esPrincipal,
            Estado: estado,
            FechaAsignacion: nowIso(),
          })
          .eq("IdUsuarioEmpresa", existing.IdUsuarioEmpresa)
          .select('"IdUsuarioEmpresa", "IdUsuario", "IdEmpresa", "EsPrincipal", "Estado", "FechaAsignacion"')
          .single();

        if (updateError) {
          return res.status(500).json({
            message: "Error actualizando empresa asignada",
            detail: updateError.message,
          });
        }

        savedRow = updated;
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from("UsuarioEmpresa")
          .insert({
            IdUsuario: idUsuario,
            IdEmpresa: idEmpresa,
            EsPrincipal: esPrincipal,
            Estado: estado,
            FechaAsignacion: nowIso(),
          })
          .select('"IdUsuarioEmpresa", "IdUsuario", "IdEmpresa", "EsPrincipal", "Estado", "FechaAsignacion"')
          .single();

        if (insertError) {
          return res.status(500).json({
            message: "Error asignando empresa al usuario",
            detail: insertError.message,
          });
        }

        savedRow = inserted;
      }

      // Si es principal, bajar las demás a false
      if (esPrincipal) {
        await supabase
          .from("UsuarioEmpresa")
          .update({ EsPrincipal: false })
          .eq("IdUsuario", idUsuario)
          .neq("IdUsuarioEmpresa", savedRow.IdUsuarioEmpresa);
      }

      return res.status(201).json({
        message: "Empresa asignada correctamente",
        UsuarioEmpresa: {
          ...savedRow,
          Empresa: empresa,
        },
      });
    } catch (error) {
      console.error("POST /usuarios/:id/empresas error:", error);
      return res.status(500).json({
        message: "Error interno asignando empresa",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/usuarios/{id}/empresas/{usuarioEmpresaId}:
 *   put:
 *     summary: Actualizar empresa asignada a usuario
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: usuarioEmpresaId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Empresa del usuario actualizada
 *       400:
 *         description: Parametros o datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * ============================================================
 * PUT /api/usuarios/:id/empresas/:usuarioEmpresaId
 * Edita relación usuario-empresa
 * ============================================================
 */
router.put(
  "/:id/empresas/:usuarioEmpresaId",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_EDITAR"]),
  async (req, res) => {
    try {
      const idUsuario = toInt(req.params.id);
      const idUsuarioEmpresa = toInt(req.params.usuarioEmpresaId);

      if (!idUsuario || idUsuario <= 0 || !idUsuarioEmpresa || idUsuarioEmpresa <= 0) {
        return res.status(400).json({ message: "Parámetros inválidos" });
      }

      const relation = await getUsuarioEmpresaById(idUsuarioEmpresa);
      if (!relation || Number(relation.IdUsuario) !== idUsuario) {
        return res.status(404).json({ message: "Relación usuario-empresa no encontrada" });
      }

      const esPrincipal = parseBool(req.body?.esPrincipal ?? relation.EsPrincipal);
      const estado = parseEstado(req.body?.estado, relation.Estado);

      const { data: updated, error } = await supabase
        .from("UsuarioEmpresa")
        .update({
          EsPrincipal: esPrincipal,
          Estado: estado,
        })
        .eq("IdUsuarioEmpresa", idUsuarioEmpresa)
        .select('"IdUsuarioEmpresa", "IdUsuario", "IdEmpresa", "EsPrincipal", "Estado", "FechaAsignacion"')
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error actualizando empresa del usuario",
          detail: error.message,
        });
      }

      if (esPrincipal) {
        await supabase
          .from("UsuarioEmpresa")
          .update({ EsPrincipal: false })
          .eq("IdUsuario", idUsuario)
          .neq("IdUsuarioEmpresa", idUsuarioEmpresa);
      }

      const empresa = await getEmpresaById(updated.IdEmpresa);

      return res.json({
        message: "Empresa del usuario actualizada correctamente",
        UsuarioEmpresa: {
          ...updated,
          Empresa: empresa,
        },
      });
    } catch (error) {
      console.error("PUT /usuarios/:id/empresas/:usuarioEmpresaId error:", error);
      return res.status(500).json({
        message: "Error interno actualizando empresa del usuario",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/usuarios/{id}/empresas/{usuarioEmpresaId}:
 *   delete:
 *     summary: Inactivar empresa asignada a usuario
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: usuarioEmpresaId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Empresa del usuario inactivada
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

/**
 * ============================================================
 * DELETE /api/usuarios/:id/empresas/:usuarioEmpresaId
 * Inactiva relación usuario-empresa y sus roles empresa
 * ============================================================
 */
router.delete(
  "/:id/empresas/:usuarioEmpresaId",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_EDITAR"]),
  async (req, res) => {
    try {
      const idUsuario = toInt(req.params.id);
      const idUsuarioEmpresa = toInt(req.params.usuarioEmpresaId);

      if (!idUsuario || idUsuario <= 0 || !idUsuarioEmpresa || idUsuarioEmpresa <= 0) {
        return res.status(400).json({ message: "Parámetros inválidos" });
      }

      const relation = await getUsuarioEmpresaById(idUsuarioEmpresa);
      if (!relation || Number(relation.IdUsuario) !== idUsuario) {
        return res.status(404).json({ message: "Relación usuario-empresa no encontrada" });
      }

      const { data: updated, error } = await supabase
        .from("UsuarioEmpresa")
        .update({ Estado: ESTADO_INACTIVO, EsPrincipal: false })
        .eq("IdUsuarioEmpresa", idUsuarioEmpresa)
        .select('"IdUsuarioEmpresa", "IdUsuario", "IdEmpresa", "EsPrincipal", "Estado", "FechaAsignacion"')
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error inactivando empresa del usuario",
          detail: error.message,
        });
      }

      // También inactivamos roles por empresa de esa relación
      await supabase
        .from("UsuarioEmpresaRol")
        .update({ Estado: ESTADO_INACTIVO })
        .eq("IdUsuarioEmpresa", idUsuarioEmpresa);

      const empresa = await getEmpresaById(updated.IdEmpresa);

      return res.json({
        message: "Empresa del usuario inactivada correctamente",
        UsuarioEmpresa: {
          ...updated,
          Empresa: empresa,
        },
      });
    } catch (error) {
      console.error("DELETE /usuarios/:id/empresas/:usuarioEmpresaId error:", error);
      return res.status(500).json({
        message: "Error interno inactivando empresa del usuario",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/usuarios/{id}/empresas/{usuarioEmpresaId}/roles:
 *   get:
 *     summary: Listar roles por empresa del usuario
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: usuarioEmpresaId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Roles por empresa consultados
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

/**
 * ============================================================
 * GET /api/usuarios/:id/empresas/:usuarioEmpresaId/roles
 * Lista roles por empresa asignados a esa relación
 * ============================================================
 */
router.get(
  "/:id/empresas/:usuarioEmpresaId/roles",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_VER"]),
  async (req, res) => {
    try {
      const idUsuario = toInt(req.params.id);
      const idUsuarioEmpresa = toInt(req.params.usuarioEmpresaId);

      if (!idUsuario || idUsuario <= 0 || !idUsuarioEmpresa || idUsuarioEmpresa <= 0) {
        return res.status(400).json({ message: "Parámetros inválidos" });
      }

      const relation = await getUsuarioEmpresaById(idUsuarioEmpresa);
      if (!relation || Number(relation.IdUsuario) !== idUsuario) {
        return res.status(404).json({ message: "Relación usuario-empresa no encontrada" });
      }

      const { data: rows, error } = await supabase
        .from("UsuarioEmpresaRol")
        .select('"IdUsuarioEmpresaRol", "IdUsuarioEmpresa", "IdRol", "Estado", "FechaAsignacion"')
        .eq("IdUsuarioEmpresa", idUsuarioEmpresa)
        .order("FechaAsignacion", { ascending: false });

      if (error) {
        return res.status(500).json({
          message: "Error consultando roles por empresa",
          detail: error.message,
        });
      }

      const rolesMap = await getRolesMapByIds((rows || []).map((x) => x.IdRol));

      return res.json({
        UsuarioEmpresa: relation,
        RolesAsignados: (rows || []).map((row) => ({
          ...row,
          Rol: rolesMap[Number(row.IdRol)] || null,
        })),
      });
    } catch (error) {
      console.error("GET /usuarios/:id/empresas/:usuarioEmpresaId/roles error:", error);
      return res.status(500).json({
        message: "Error interno consultando roles por empresa",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/usuarios/{id}/empresas/{usuarioEmpresaId}/roles:
 *   post:
 *     summary: Asignar rol por empresa al usuario
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: usuarioEmpresaId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       201:
 *         description: Rol por empresa asignado
 *       400:
 *         description: Parametros o datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * ============================================================
 * POST /api/usuarios/:id/empresas/:usuarioEmpresaId/roles
 * Asigna rol empresa a relación usuario-empresa
 * ============================================================
 */
router.post(
  "/:id/empresas/:usuarioEmpresaId/roles",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_EDITAR"]),
  async (req, res) => {
    try {
      const idUsuario = toInt(req.params.id);
      const idUsuarioEmpresa = toInt(req.params.usuarioEmpresaId);
      const idRol = toInt(req.body?.idRol);
      const estado = parseEstado(req.body?.estado, ESTADO_ACTIVO);

      if (!idUsuario || idUsuario <= 0 || !idUsuarioEmpresa || idUsuarioEmpresa <= 0) {
        return res.status(400).json({ message: "Parámetros inválidos" });
      }

      if (!idRol || idRol <= 0) {
        return res.status(400).json({ message: "idRol es requerido" });
      }

      const relation = await getUsuarioEmpresaById(idUsuarioEmpresa);
      if (!relation || Number(relation.IdUsuario) !== idUsuario) {
        return res.status(404).json({ message: "Relación usuario-empresa no encontrada" });
      }

      const rol = await getRolById(idRol);
      if (!rol) {
        return res.status(404).json({ message: "Rol no encontrado" });
      }

      if (rol.Ambito !== "EMPRESA") {
        return res.status(400).json({
          message: "Solo se pueden asignar roles de ámbito EMPRESA en esta ruta",
        });
      }

      const { data: existing, error: existingError } = await supabase
        .from("UsuarioEmpresaRol")
        .select('"IdUsuarioEmpresaRol", "IdUsuarioEmpresa", "IdRol", "Estado", "FechaAsignacion"')
        .eq("IdUsuarioEmpresa", idUsuarioEmpresa)
        .eq("IdRol", idRol)
        .maybeSingle();

      if (existingError) {
        return res.status(500).json({
          message: "Error validando rol empresa existente",
          detail: existingError.message,
        });
      }

      let savedRow = null;

      if (existing) {
        const { data: updated, error: updateError } = await supabase
          .from("UsuarioEmpresaRol")
          .update({
            Estado: estado,
            FechaAsignacion: nowIso(),
          })
          .eq("IdUsuarioEmpresaRol", existing.IdUsuarioEmpresaRol)
          .select('"IdUsuarioEmpresaRol", "IdUsuarioEmpresa", "IdRol", "Estado", "FechaAsignacion"')
          .single();

        if (updateError) {
          return res.status(500).json({
            message: "Error actualizando rol empresa",
            detail: updateError.message,
          });
        }

        savedRow = updated;
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from("UsuarioEmpresaRol")
          .insert({
            IdUsuarioEmpresa: idUsuarioEmpresa,
            IdRol: idRol,
            Estado: estado,
            FechaAsignacion: nowIso(),
          })
          .select('"IdUsuarioEmpresaRol", "IdUsuarioEmpresa", "IdRol", "Estado", "FechaAsignacion"')
          .single();

        if (insertError) {
          return res.status(500).json({
            message: "Error asignando rol empresa",
            detail: insertError.message,
          });
        }

        savedRow = inserted;
      }

      return res.status(201).json({
        message: "Rol empresa asignado correctamente",
        UsuarioEmpresaRol: {
          ...savedRow,
          Rol: rol,
        },
      });
    } catch (error) {
      console.error("POST /usuarios/:id/empresas/:usuarioEmpresaId/roles error:", error);
      return res.status(500).json({
        message: "Error interno asignando rol empresa",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/usuarios/{id}/empresas/{usuarioEmpresaId}/roles/{usuarioEmpresaRolId}:
 *   put:
 *     summary: Actualizar rol por empresa del usuario
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: usuarioEmpresaId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: usuarioEmpresaRolId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Rol por empresa actualizado
 *       400:
 *         description: Parametros o datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Rol duplicado
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * ============================================================
 * PUT /api/usuarios/:id/empresas/:usuarioEmpresaId/roles/:usuarioEmpresaRolId
 * Edita relación de rol empresa
 * ============================================================
 */
router.put(
  "/:id/empresas/:usuarioEmpresaId/roles/:usuarioEmpresaRolId",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_EDITAR"]),
  async (req, res) => {
    try {
      const idUsuario = toInt(req.params.id);
      const idUsuarioEmpresa = toInt(req.params.usuarioEmpresaId);
      const idUsuarioEmpresaRol = toInt(req.params.usuarioEmpresaRolId);
      const idRol = toInt(req.body?.idRol);
      const estado = parseEstado(req.body?.estado, ESTADO_ACTIVO);

      if (
        !idUsuario || idUsuario <= 0 ||
        !idUsuarioEmpresa || idUsuarioEmpresa <= 0 ||
        !idUsuarioEmpresaRol || idUsuarioEmpresaRol <= 0
      ) {
        return res.status(400).json({ message: "Parámetros inválidos" });
      }

      const relation = await getUsuarioEmpresaById(idUsuarioEmpresa);
      if (!relation || Number(relation.IdUsuario) !== idUsuario) {
        return res.status(404).json({ message: "Relación usuario-empresa no encontrada" });
      }

      const empresaRol = await getUsuarioEmpresaRolById(idUsuarioEmpresaRol);
      if (!empresaRol || Number(empresaRol.IdUsuarioEmpresa) !== idUsuarioEmpresa) {
        return res.status(404).json({ message: "Rol empresa no encontrado" });
      }

      let finalIdRol = empresaRol.IdRol;
      if (idRol) {
        const rol = await getRolById(idRol);
        if (!rol) {
          return res.status(404).json({ message: "Rol no encontrado" });
        }
        if (rol.Ambito !== "EMPRESA") {
          return res.status(400).json({
            message: "Solo se pueden asignar roles de ámbito EMPRESA en esta ruta",
          });
        }

        const { data: duplicated, error: duplicatedError } = await supabase
          .from("UsuarioEmpresaRol")
          .select('"IdUsuarioEmpresaRol"')
          .eq("IdUsuarioEmpresa", idUsuarioEmpresa)
          .eq("IdRol", idRol)
          .neq("IdUsuarioEmpresaRol", idUsuarioEmpresaRol)
          .maybeSingle();

        if (duplicatedError) {
          return res.status(500).json({
            message: "Error validando duplicado de rol empresa",
            detail: duplicatedError.message,
          });
        }

        if (duplicated) {
          return res.status(409).json({
            message: "Ese rol ya está asignado a la empresa del usuario",
          });
        }

        finalIdRol = idRol;
      }

      const { data: updated, error } = await supabase
        .from("UsuarioEmpresaRol")
        .update({
          IdRol: finalIdRol,
          Estado: estado,
        })
        .eq("IdUsuarioEmpresaRol", idUsuarioEmpresaRol)
        .select('"IdUsuarioEmpresaRol", "IdUsuarioEmpresa", "IdRol", "Estado", "FechaAsignacion"')
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error actualizando rol empresa",
          detail: error.message,
        });
      }

      const rol = await getRolById(updated.IdRol);

      return res.json({
        message: "Rol empresa actualizado correctamente",
        UsuarioEmpresaRol: {
          ...updated,
          Rol: rol,
        },
      });
    } catch (error) {
      console.error("PUT /usuarios/:id/empresas/:usuarioEmpresaId/roles/:usuarioEmpresaRolId error:", error);
      return res.status(500).json({
        message: "Error interno actualizando rol empresa",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/usuarios/{id}/empresas/{usuarioEmpresaId}/roles/{usuarioEmpresaRolId}:
 *   delete:
 *     summary: Inactivar rol por empresa del usuario
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: usuarioEmpresaId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: usuarioEmpresaRolId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Rol por empresa inactivado
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

/**
 * ============================================================
 * DELETE /api/usuarios/:id/empresas/:usuarioEmpresaId/roles/:usuarioEmpresaRolId
 * Inactiva relación rol empresa
 * ============================================================
 */
router.delete(
  "/:id/empresas/:usuarioEmpresaId/roles/:usuarioEmpresaRolId",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_EDITAR"]),
  async (req, res) => {
    try {
      const idUsuario = toInt(req.params.id);
      const idUsuarioEmpresa = toInt(req.params.usuarioEmpresaId);
      const idUsuarioEmpresaRol = toInt(req.params.usuarioEmpresaRolId);

      if (
        !idUsuario || idUsuario <= 0 ||
        !idUsuarioEmpresa || idUsuarioEmpresa <= 0 ||
        !idUsuarioEmpresaRol || idUsuarioEmpresaRol <= 0
      ) {
        return res.status(400).json({ message: "Parámetros inválidos" });
      }

      const relation = await getUsuarioEmpresaById(idUsuarioEmpresa);
      if (!relation || Number(relation.IdUsuario) !== idUsuario) {
        return res.status(404).json({ message: "Relación usuario-empresa no encontrada" });
      }

      const empresaRol = await getUsuarioEmpresaRolById(idUsuarioEmpresaRol);
      if (!empresaRol || Number(empresaRol.IdUsuarioEmpresa) !== idUsuarioEmpresa) {
        return res.status(404).json({ message: "Rol empresa no encontrado" });
      }

      const { data: updated, error } = await supabase
        .from("UsuarioEmpresaRol")
        .update({ Estado: ESTADO_INACTIVO })
        .eq("IdUsuarioEmpresaRol", idUsuarioEmpresaRol)
        .select('"IdUsuarioEmpresaRol", "IdUsuarioEmpresa", "IdRol", "Estado", "FechaAsignacion"')
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error inactivando rol empresa",
          detail: error.message,
        });
      }

      const rol = await getRolById(updated.IdRol);

      return res.json({
        message: "Rol empresa inactivado correctamente",
        UsuarioEmpresaRol: {
          ...updated,
          Rol: rol,
        },
      });
    } catch (error) {
      console.error("DELETE /usuarios/:id/empresas/:usuarioEmpresaId/roles/:usuarioEmpresaRolId error:", error);
      return res.status(500).json({
        message: "Error interno inactivando rol empresa",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/usuarios/{id}/roles-global:
 *   get:
 *     summary: Listar roles globales del usuario
 *     tags: [Usuarios]
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
 *         description: Roles globales consultados
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

/**
 * ============================================================
 * GET /api/usuarios/:id/roles-global
 * Lista roles globales del usuario
 * ============================================================
 */
router.get(
  "/:id/roles-global",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_VER"]),
  async (req, res) => {
    try {
      const idUsuario = toInt(req.params.id);

      if (!idUsuario || idUsuario <= 0) {
        return res.status(400).json({ message: "id de usuario inválido" });
      }

      const usuario = await getUsuarioById(idUsuario);
      if (!usuario) {
        return res.status(404).json({ message: "Usuario no encontrado" });
      }

      const { data: rows, error } = await supabase
        .from("UsuarioRolGlobal")
        .select('"IdUsuarioRolGlobal", "IdUsuario", "IdRol", "Estado", "FechaAsignacion"')
        .eq("IdUsuario", idUsuario)
        .order("FechaAsignacion", { ascending: false });

      if (error) {
        return res.status(500).json({
          message: "Error consultando roles globales",
          detail: error.message,
        });
      }

      const rolesMap = await getRolesMapByIds((rows || []).map((x) => x.IdRol));

      return res.json({
        Usuario: {
          id: usuario.id,
          Usuario: usuario.Usuario,
          NombreCompleto: usuario.NombreCompleto,
          Correo: usuario.Correo,
          Estado: usuario.Estado,
        },
        RolesGlobales: (rows || []).map((row) => ({
          ...row,
          Rol: rolesMap[Number(row.IdRol)] || null,
        })),
      });
    } catch (error) {
      console.error("GET /usuarios/:id/roles-global error:", error);
      return res.status(500).json({
        message: "Error interno consultando roles globales",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/usuarios/{id}/roles-global:
 *   post:
 *     summary: Asignar rol global a usuario
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       201:
 *         description: Rol global asignado
 *       400:
 *         description: Parametros o datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * ============================================================
 * POST /api/usuarios/:id/roles-global
 * Asigna rol global a usuario
 * ============================================================
 */
router.post(
  "/:id/roles-global",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_EDITAR"]),
  async (req, res) => {
    try {
      const idUsuario = toInt(req.params.id);
      const idRol = toInt(req.body?.idRol);
      const estado = parseEstado(req.body?.estado, ESTADO_ACTIVO);

      if (!idUsuario || idUsuario <= 0) {
        return res.status(400).json({ message: "id de usuario inválido" });
      }

      if (!idRol || idRol <= 0) {
        return res.status(400).json({ message: "idRol es requerido" });
      }

      const usuario = await getUsuarioById(idUsuario);
      if (!usuario) {
        return res.status(404).json({ message: "Usuario no encontrado" });
      }

      const rol = await getRolById(idRol);
      if (!rol) {
        return res.status(404).json({ message: "Rol no encontrado" });
      }

      if (rol.Ambito !== "GLOBAL") {
        return res.status(400).json({
          message: "Solo se pueden asignar roles de ámbito GLOBAL en esta ruta",
        });
      }

      const { data: existing, error: existingError } = await supabase
        .from("UsuarioRolGlobal")
        .select('"IdUsuarioRolGlobal", "IdUsuario", "IdRol", "Estado", "FechaAsignacion"')
        .eq("IdUsuario", idUsuario)
        .eq("IdRol", idRol)
        .maybeSingle();

      if (existingError) {
        return res.status(500).json({
          message: "Error validando rol global existente",
          detail: existingError.message,
        });
      }

      let savedRow = null;

      if (existing) {
        const { data: updated, error: updateError } = await supabase
          .from("UsuarioRolGlobal")
          .update({
            Estado: estado,
            FechaAsignacion: nowIso(),
          })
          .eq("IdUsuarioRolGlobal", existing.IdUsuarioRolGlobal)
          .select('"IdUsuarioRolGlobal", "IdUsuario", "IdRol", "Estado", "FechaAsignacion"')
          .single();

        if (updateError) {
          return res.status(500).json({
            message: "Error actualizando rol global",
            detail: updateError.message,
          });
        }

        savedRow = updated;
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from("UsuarioRolGlobal")
          .insert({
            IdUsuario: idUsuario,
            IdRol: idRol,
            Estado: estado,
            FechaAsignacion: nowIso(),
          })
          .select('"IdUsuarioRolGlobal", "IdUsuario", "IdRol", "Estado", "FechaAsignacion"')
          .single();

        if (insertError) {
          return res.status(500).json({
            message: "Error asignando rol global",
            detail: insertError.message,
          });
        }

        savedRow = inserted;
      }

      return res.status(201).json({
        message: "Rol global asignado correctamente",
        UsuarioRolGlobal: {
          ...savedRow,
          Rol: rol,
        },
      });
    } catch (error) {
      console.error("POST /usuarios/:id/roles-global error:", error);
      return res.status(500).json({
        message: "Error interno asignando rol global",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/usuarios/{id}/roles-global/{usuarioRolGlobalId}:
 *   put:
 *     summary: Actualizar rol global del usuario
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: usuarioRolGlobalId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Rol global actualizado
 *       400:
 *         description: Parametros o datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Rol duplicado
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * ============================================================
 * PUT /api/usuarios/:id/roles-global/:usuarioRolGlobalId
 * Edita relación rol global
 * ============================================================
 */
router.put(
  "/:id/roles-global/:usuarioRolGlobalId",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_EDITAR"]),
  async (req, res) => {
    try {
      const idUsuario = toInt(req.params.id);
      const idUsuarioRolGlobal = toInt(req.params.usuarioRolGlobalId);
      const idRol = toInt(req.body?.idRol);
      const estado = parseEstado(req.body?.estado, ESTADO_ACTIVO);

      if (
        !idUsuario || idUsuario <= 0 ||
        !idUsuarioRolGlobal || idUsuarioRolGlobal <= 0
      ) {
        return res.status(400).json({ message: "Parámetros inválidos" });
      }

      const relation = await getUsuarioRolGlobalById(idUsuarioRolGlobal);
      if (!relation || Number(relation.IdUsuario) !== idUsuario) {
        return res.status(404).json({ message: "Rol global no encontrado" });
      }

      let finalIdRol = relation.IdRol;

      if (idRol) {
        const rol = await getRolById(idRol);
        if (!rol) {
          return res.status(404).json({ message: "Rol no encontrado" });
        }

        if (rol.Ambito !== "GLOBAL") {
          return res.status(400).json({
            message: "Solo se pueden asignar roles de ámbito GLOBAL en esta ruta",
          });
        }

        const { data: duplicated, error: duplicatedError } = await supabase
          .from("UsuarioRolGlobal")
          .select('"IdUsuarioRolGlobal"')
          .eq("IdUsuario", idUsuario)
          .eq("IdRol", idRol)
          .neq("IdUsuarioRolGlobal", idUsuarioRolGlobal)
          .maybeSingle();

        if (duplicatedError) {
          return res.status(500).json({
            message: "Error validando duplicado de rol global",
            detail: duplicatedError.message,
          });
        }

        if (duplicated) {
          return res.status(409).json({
            message: "Ese rol global ya está asignado al usuario",
          });
        }

        finalIdRol = idRol;
      }

      const { data: updated, error } = await supabase
        .from("UsuarioRolGlobal")
        .update({
          IdRol: finalIdRol,
          Estado: estado,
        })
        .eq("IdUsuarioRolGlobal", idUsuarioRolGlobal)
        .select('"IdUsuarioRolGlobal", "IdUsuario", "IdRol", "Estado", "FechaAsignacion"')
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error actualizando rol global",
          detail: error.message,
        });
      }

      const rol = await getRolById(updated.IdRol);

      return res.json({
        message: "Rol global actualizado correctamente",
        UsuarioRolGlobal: {
          ...updated,
          Rol: rol,
        },
      });
    } catch (error) {
      console.error("PUT /usuarios/:id/roles-global/:usuarioRolGlobalId error:", error);
      return res.status(500).json({
        message: "Error interno actualizando rol global",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/usuarios/{id}/roles-global/{usuarioRolGlobalId}:
 *   delete:
 *     summary: Inactivar rol global del usuario
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: usuarioRolGlobalId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Rol global inactivado
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

/**
 * ============================================================
 * DELETE /api/usuarios/:id/roles-global/:usuarioRolGlobalId
 * Inactiva rol global de usuario
 * ============================================================
 */
router.delete(
  "/:id/roles-global/:usuarioRolGlobalId",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_EDITAR"]),
  async (req, res) => {
    try {
      const idUsuario = toInt(req.params.id);
      const idUsuarioRolGlobal = toInt(req.params.usuarioRolGlobalId);

      if (
        !idUsuario || idUsuario <= 0 ||
        !idUsuarioRolGlobal || idUsuarioRolGlobal <= 0
      ) {
        return res.status(400).json({ message: "Parámetros inválidos" });
      }

      const relation = await getUsuarioRolGlobalById(idUsuarioRolGlobal);
      if (!relation || Number(relation.IdUsuario) !== idUsuario) {
        return res.status(404).json({ message: "Rol global no encontrado" });
      }

      const { data: updated, error } = await supabase
        .from("UsuarioRolGlobal")
        .update({ Estado: ESTADO_INACTIVO })
        .eq("IdUsuarioRolGlobal", idUsuarioRolGlobal)
        .select('"IdUsuarioRolGlobal", "IdUsuario", "IdRol", "Estado", "FechaAsignacion"')
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error inactivando rol global",
          detail: error.message,
        });
      }

      const rol = await getRolById(updated.IdRol);

      return res.json({
        message: "Rol global inactivado correctamente",
        UsuarioRolGlobal: {
          ...updated,
          Rol: rol,
        },
      });
    } catch (error) {
      console.error("DELETE /usuarios/:id/roles-global/:usuarioRolGlobalId error:", error);
      return res.status(500).json({
        message: "Error interno inactivando rol global",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/usuarios/{id}:
 *   get:
 *     summary: Obtener detalle de usuario
 *     tags: [Usuarios]
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
 *         description: Usuario consultado
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

/**
 * ============================================================
 * GET /api/usuarios/:id
 * Detalle de usuario
 * ============================================================
 */
router.get(
  "/:id",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_VER"]),
  async (req, res) => {
    try {
      const idUsuario = toInt(req.params.id);

      if (!idUsuario || idUsuario <= 0) {
        return res.status(400).json({ message: "id de usuario inválido" });
      }

      const usuario = await getUsuarioById(idUsuario);
      if (!usuario) {
        return res.status(404).json({ message: "Usuario no encontrado" });
      }

      const { data: empresasRows, error: empresasError } = await supabase
        .from("UsuarioEmpresa")
        .select('"IdUsuarioEmpresa", "IdUsuario", "IdEmpresa", "EsPrincipal", "Estado", "FechaAsignacion"')
        .eq("IdUsuario", idUsuario);

      if (empresasError) {
        return res.status(500).json({
          message: "Error consultando empresas del usuario",
          detail: empresasError.message,
        });
      }

      const empresasMap = await getEmpresasMapByIds(
        (empresasRows || []).map((x) => x.IdEmpresa)
      );

      const { data: rolesGlobalRows, error: rolesGlobalError } = await supabase
        .from("UsuarioRolGlobal")
        .select('"IdUsuarioRolGlobal", "IdUsuario", "IdRol", "Estado", "FechaAsignacion"')
        .eq("IdUsuario", idUsuario);

      if (rolesGlobalError) {
        return res.status(500).json({
          message: "Error consultando roles globales del usuario",
          detail: rolesGlobalError.message,
        });
      }

      const rolesMap = await getRolesMapByIds(
        (rolesGlobalRows || []).map((x) => x.IdRol)
      );

      return res.json({
        Usuario: {
          id: usuario.id,
          Usuario: usuario.Usuario,
          FechaRegistro: usuario.FechaRegistro,
          Estado: usuario.Estado,
          NombreCompleto: usuario.NombreCompleto,
          Correo: usuario.Correo,
        },
        EmpresasAsignadas: (empresasRows || []).map((row) => ({
          ...row,
          Empresa: empresasMap[Number(row.IdEmpresa)] || null,
        })),
        RolesGlobales: (rolesGlobalRows || []).map((row) => ({
          ...row,
          Rol: rolesMap[Number(row.IdRol)] || null,
        })),
      });
    } catch (error) {
      console.error("GET /usuarios/:id error:", error);
      return res.status(500).json({
        message: "Error interno consultando detalle de usuario",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/usuarios:
 *   post:
 *     summary: Crear usuario
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Usuario creado
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       409:
 *         description: Usuario duplicado
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * ============================================================
 * POST /api/usuarios
 * Crea usuario
 * ============================================================
 */
router.post(
  "/",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_EDITAR"]),
  async (req, res) => {
    try {
      const usuario = normalizeText(req.body?.usuario);
      const password = normalizeText(req.body?.password);
      const nombreCompleto = normalizeText(req.body?.nombreCompleto);
      const correo = normalizeNullableText(req.body?.correo);
      const estado = parseEstado(req.body?.estado, ESTADO_ACTIVO);

      if (!usuario) {
        return res.status(400).json({ message: "usuario es requerido" });
      }

      if (!password) {
        return res.status(400).json({ message: "password es requerido" });
      }

      if (!nombreCompleto) {
        return res.status(400).json({ message: "nombreCompleto es requerido" });
      }

      const { data: duplicateUser, error: duplicateUserError } = await supabase
        .from("Usuarios")
        .select("id")
        .eq("Usuario", usuario)
        .maybeSingle();

      if (duplicateUserError) {
        return res.status(500).json({
          message: "Error validando usuario duplicado",
          detail: duplicateUserError.message,
        });
      }

      if (duplicateUser) {
        return res.status(409).json({
          message: "Ya existe un usuario con ese nombre",
        });
      }

      if (correo) {
        const { data: duplicateCorreo, error: duplicateCorreoError } = await supabase
          .from("Usuarios")
          .select("id")
          .eq("Correo", correo)
          .maybeSingle();

        if (duplicateCorreoError) {
          return res.status(500).json({
            message: "Error validando correo duplicado",
            detail: duplicateCorreoError.message,
          });
        }

        if (duplicateCorreo) {
          return res.status(409).json({
            message: "Ya existe un usuario con ese correo",
          });
        }
      }

      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

      const { data, error } = await supabase
        .from("Usuarios")
        .insert({
          Usuario: usuario,
          Password: hashedPassword,
          FechaRegistro: new Date().toISOString().slice(0, 10),
          Estado: estado,
          NombreCompleto: nombreCompleto,
          Correo: correo,
        })
        .select('id, "Usuario", "FechaRegistro", "Estado", "NombreCompleto", "Correo"')
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error creando usuario",
          detail: error.message,
        });
      }

      return res.status(201).json({
        message: "Usuario creado correctamente",
        Usuario: data,
      });
    } catch (error) {
      console.error("POST /usuarios error:", error);
      return res.status(500).json({
        message: "Error interno creando usuario",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/usuarios/{id}:
 *   put:
 *     summary: Actualizar usuario
 *     tags: [Usuarios]
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
 *         description: Usuario actualizado
 *       400:
 *         description: Parametros o datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Usuario duplicado
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * ============================================================
 * PUT /api/usuarios/:id
 * Actualiza usuario
 * ============================================================
 */
router.put(
  "/:id",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_EDITAR"]),
  async (req, res) => {
    try {
      const idUsuario = toInt(req.params.id);

      if (!idUsuario || idUsuario <= 0) {
        return res.status(400).json({ message: "id de usuario inválido" });
      }

      const existingUser = await getUsuarioById(idUsuario);
      if (!existingUser) {
        return res.status(404).json({ message: "Usuario no encontrado" });
      }

      const usuario = normalizeText(req.body?.usuario) || existingUser.Usuario;
      const password = normalizeText(req.body?.password);
      const nombreCompleto =
        normalizeText(req.body?.nombreCompleto) || existingUser.NombreCompleto;
      const correo =
        req.body?.correo !== undefined
          ? normalizeNullableText(req.body?.correo)
          : existingUser.Correo;
      const estado = parseEstado(req.body?.estado, existingUser.Estado);

      if (!usuario) {
        return res.status(400).json({ message: "usuario es requerido" });
      }

      if (!nombreCompleto) {
        return res.status(400).json({ message: "nombreCompleto es requerido" });
      }

      const { data: duplicateUser, error: duplicateUserError } = await supabase
        .from("Usuarios")
        .select("id")
        .eq("Usuario", usuario)
        .neq("id", idUsuario)
        .maybeSingle();

      if (duplicateUserError) {
        return res.status(500).json({
          message: "Error validando usuario duplicado",
          detail: duplicateUserError.message,
        });
      }

      if (duplicateUser) {
        return res.status(409).json({
          message: "Ya existe otro usuario con ese nombre",
        });
      }

      if (correo) {
        const { data: duplicateCorreo, error: duplicateCorreoError } = await supabase
          .from("Usuarios")
          .select("id")
          .eq("Correo", correo)
          .neq("id", idUsuario)
          .maybeSingle();

        if (duplicateCorreoError) {
          return res.status(500).json({
            message: "Error validando correo duplicado",
            detail: duplicateCorreoError.message,
          });
        }

        if (duplicateCorreo) {
          return res.status(409).json({
            message: "Ya existe otro usuario con ese correo",
          });
        }
      }

      const payload = {
        Usuario: usuario,
        Estado: estado,
        NombreCompleto: nombreCompleto,
        Correo: correo,
      };

      if (password) {
        payload.Password = await bcrypt.hash(password, SALT_ROUNDS);
      }

      const { data, error } = await supabase
        .from("Usuarios")
        .update(payload)
        .eq("id", idUsuario)
        .select('id, "Usuario", "FechaRegistro", "Estado", "NombreCompleto", "Correo"')
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error actualizando usuario",
          detail: error.message,
        });
      }

      return res.json({
        message: "Usuario actualizado correctamente",
        Usuario: data,
      });
    } catch (error) {
      console.error("PUT /usuarios/:id error:", error);
      return res.status(500).json({
        message: "Error interno actualizando usuario",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/usuarios/{id}:
 *   delete:
 *     summary: Inactivar usuario
 *     tags: [Usuarios]
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
 *         description: Usuario inactivado
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

/**
 * ============================================================
 * DELETE /api/usuarios/:id
 * Inactiva usuario
 * ============================================================
 */
router.delete(
  "/:id",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_EDITAR"]),
  async (req, res) => {
    try {
      const idUsuario = toInt(req.params.id);

      if (!idUsuario || idUsuario <= 0) {
        return res.status(400).json({ message: "id de usuario inválido" });
      }

      const existingUser = await getUsuarioById(idUsuario);
      if (!existingUser) {
        return res.status(404).json({ message: "Usuario no encontrado" });
      }

      const { data, error } = await supabase
        .from("Usuarios")
        .update({ Estado: ESTADO_INACTIVO })
        .eq("id", idUsuario)
        .select('id, "Usuario", "FechaRegistro", "Estado", "NombreCompleto", "Correo"')
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error inactivando usuario",
          detail: error.message,
        });
      }

      return res.json({
        message: "Usuario inactivado correctamente",
        Usuario: data,
      });
    } catch (error) {
      console.error("DELETE /usuarios/:id error:", error);
      return res.status(500).json({
        message: "Error interno inactivando usuario",
        detail: error.message,
      });
    }
  }
);

export default router;
