import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { authorizeGlobalPermission } from "../middlewares/authorizeGlobalPermission.middleware.js";

const router = Router();

const ESTADO_ACTIVO = 1;
const ESTADO_INACTIVO = 0;

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

function parseEstado(value, fallback = ESTADO_ACTIVO) {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
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

async function getPermisoById(idPermiso) {
  const { data, error } = await supabase
    .from("Permisos")
    .select('"IdPermiso", "Codigo", "Nombre", "Modulo", "Descripcion", "Estado", "FechaRegistro"')
    .eq("IdPermiso", idPermiso)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getPermisosMapByIds(idsPermiso) {
  const uniqueIds = [...new Set((idsPermiso || []).filter(Boolean).map(Number))];

  if (uniqueIds.length === 0) return {};

  const { data, error } = await supabase
    .from("Permisos")
    .select('"IdPermiso", "Codigo", "Nombre", "Modulo", "Descripcion", "Estado", "FechaRegistro"')
    .in("IdPermiso", uniqueIds);

  if (error) throw error;

  return Object.fromEntries((data || []).map((row) => [Number(row.IdPermiso), row]));
}

/**
 * GET /api/roles
 */
router.get(
  "/",
  requireAuth,
  authorizeGlobalPermission(["ROLES_VER"]),
  async (req, res) => {
    try {
      const page = Math.max(1, toInt(req.query.page) || 1);
      const pageSize = Math.max(1, Math.min(100, toInt(req.query.pageSize) || 10));
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const q = normalizeText(req.query.q);
      const estado = req.query.estado !== undefined ? toInt(req.query.estado) : null;
      const ambito = normalizeText(req.query.ambito).toUpperCase();

      let query = supabase
        .from("Roles")
        .select(
          '"IdRol", "Codigo", "Nombre", "Ambito", "Descripcion", "Estado", "FechaRegistro"',
          { count: "exact" }
        )
        .order("IdRol", { ascending: true })
        .range(from, to);

      if (q) {
        query = query.or(
          `"Codigo".ilike.%${q}%,"Nombre".ilike.%${q}%,"Descripcion".ilike.%${q}%`
        );
      }

      if (estado !== null) {
        query = query.eq("Estado", estado);
      }

      if (ambito && ["GLOBAL", "EMPRESA"].includes(ambito)) {
        query = query.eq("Ambito", ambito);
      }

      const { data, error, count } = await query;

      if (error) {
        return res.status(500).json({
          message: "Error consultando roles",
          detail: error.message,
        });
      }

      return res.json({
        Roles: data || [],
        Pagination: {
          page,
          pageSize,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / pageSize),
        },
      });
    } catch (error) {
      console.error("GET /roles error:", error);
      return res.status(500).json({
        message: "Error interno consultando roles",
        detail: error.message,
      });
    }
  }
);

/**
 * GET /api/roles/:id
 */
router.get(
  "/:id",
  requireAuth,
  authorizeGlobalPermission(["ROLES_VER"]),
  async (req, res) => {
    try {
      const idRol = toInt(req.params.id);

      if (!idRol || idRol <= 0) {
        return res.status(400).json({ message: "id de rol inválido" });
      }

      const rol = await getRolById(idRol);

      if (!rol) {
        return res.status(404).json({ message: "Rol no encontrado" });
      }

      return res.json({ Rol: rol });
    } catch (error) {
      console.error("GET /roles/:id error:", error);
      return res.status(500).json({
        message: "Error interno consultando rol",
        detail: error.message,
      });
    }
  }
);

/**
 * POST /api/roles
 */
router.post(
  "/",
  requireAuth,
  authorizeGlobalPermission(["ROLES_EDITAR"]),
  async (req, res) => {
    try {
      const codigo = normalizeText(req.body?.codigo);
      const nombre = normalizeText(req.body?.nombre);
      const ambito = normalizeText(req.body?.ambito).toUpperCase();
      const descripcion = normalizeNullableText(req.body?.descripcion);
      const estado = parseEstado(req.body?.estado, ESTADO_ACTIVO);

      if (!codigo) {
        return res.status(400).json({ message: "codigo es requerido" });
      }

      if (!nombre) {
        return res.status(400).json({ message: "nombre es requerido" });
      }

      if (!ambito || !["GLOBAL", "EMPRESA"].includes(ambito)) {
        return res.status(400).json({
          message: "ambito es requerido y debe ser GLOBAL o EMPRESA",
        });
      }

      const { data: duplicateCodigo, error: duplicateCodigoError } = await supabase
        .from("Roles")
        .select('"IdRol"')
        .eq("Codigo", codigo)
        .maybeSingle();

      if (duplicateCodigoError) {
        return res.status(500).json({
          message: "Error validando código duplicado",
          detail: duplicateCodigoError.message,
        });
      }

      if (duplicateCodigo) {
        return res.status(409).json({
          message: "Ya existe un rol con ese código",
        });
      }

      const { data, error } = await supabase
        .from("Roles")
        .insert({
          Codigo: codigo,
          Nombre: nombre,
          Ambito: ambito,
          Descripcion: descripcion,
          Estado: estado,
          FechaRegistro: nowIso(),
        })
        .select('"IdRol", "Codigo", "Nombre", "Ambito", "Descripcion", "Estado", "FechaRegistro"')
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error creando rol",
          detail: error.message,
        });
      }

      return res.status(201).json({
        message: "Rol creado correctamente",
        Rol: data,
      });
    } catch (error) {
      console.error("POST /roles error:", error);
      return res.status(500).json({
        message: "Error interno creando rol",
        detail: error.message,
      });
    }
  }
);

/**
 * PUT /api/roles/:id
 */
router.put(
  "/:id",
  requireAuth,
  authorizeGlobalPermission(["ROLES_EDITAR"]),
  async (req, res) => {
    try {
      const idRol = toInt(req.params.id);

      if (!idRol || idRol <= 0) {
        return res.status(400).json({ message: "id de rol inválido" });
      }

      const existing = await getRolById(idRol);

      if (!existing) {
        return res.status(404).json({ message: "Rol no encontrado" });
      }

      const codigo = normalizeText(req.body?.codigo) || existing.Codigo;
      const nombre = normalizeText(req.body?.nombre) || existing.Nombre;
      const ambito = normalizeText(req.body?.ambito).toUpperCase() || existing.Ambito;
      const descripcion =
        req.body?.descripcion !== undefined
          ? normalizeNullableText(req.body?.descripcion)
          : existing.Descripcion;
      const estado = parseEstado(req.body?.estado, existing.Estado);

      if (!["GLOBAL", "EMPRESA"].includes(ambito)) {
        return res.status(400).json({
          message: "ambito debe ser GLOBAL o EMPRESA",
        });
      }

      const { data: duplicateCodigo, error: duplicateCodigoError } = await supabase
        .from("Roles")
        .select('"IdRol"')
        .eq("Codigo", codigo)
        .neq("IdRol", idRol)
        .maybeSingle();

      if (duplicateCodigoError) {
        return res.status(500).json({
          message: "Error validando código duplicado",
          detail: duplicateCodigoError.message,
        });
      }

      if (duplicateCodigo) {
        return res.status(409).json({
          message: "Ya existe otro rol con ese código",
        });
      }

      const { data, error } = await supabase
        .from("Roles")
        .update({
          Codigo: codigo,
          Nombre: nombre,
          Ambito: ambito,
          Descripcion: descripcion,
          Estado: estado,
        })
        .eq("IdRol", idRol)
        .select('"IdRol", "Codigo", "Nombre", "Ambito", "Descripcion", "Estado", "FechaRegistro"')
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error actualizando rol",
          detail: error.message,
        });
      }

      return res.json({
        message: "Rol actualizado correctamente",
        Rol: data,
      });
    } catch (error) {
      console.error("PUT /roles/:id error:", error);
      return res.status(500).json({
        message: "Error interno actualizando rol",
        detail: error.message,
      });
    }
  }
);

/**
 * DELETE /api/roles/:id
 * Inactiva rol
 */
router.delete(
  "/:id",
  requireAuth,
  authorizeGlobalPermission(["ROLES_EDITAR"]),
  async (req, res) => {
    try {
      const idRol = toInt(req.params.id);

      if (!idRol || idRol <= 0) {
        return res.status(400).json({ message: "id de rol inválido" });
      }

      const existing = await getRolById(idRol);

      if (!existing) {
        return res.status(404).json({ message: "Rol no encontrado" });
      }

      const { data, error } = await supabase
        .from("Roles")
        .update({ Estado: ESTADO_INACTIVO })
        .eq("IdRol", idRol)
        .select('"IdRol", "Codigo", "Nombre", "Ambito", "Descripcion", "Estado", "FechaRegistro"')
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error inactivando rol",
          detail: error.message,
        });
      }

      return res.json({
        message: "Rol inactivado correctamente",
        Rol: data,
      });
    } catch (error) {
      console.error("DELETE /roles/:id error:", error);
      return res.status(500).json({
        message: "Error interno inactivando rol",
        detail: error.message,
      });
    }
  }
);

/**
 * GET /api/roles/:id/permisos
 */
router.get(
  "/:id/permisos",
  requireAuth,
  authorizeGlobalPermission(["ROLES_VER"]),
  async (req, res) => {
    try {
      const idRol = toInt(req.params.id);

      if (!idRol || idRol <= 0) {
        return res.status(400).json({ message: "id de rol inválido" });
      }

      const rol = await getRolById(idRol);

      if (!rol) {
        return res.status(404).json({ message: "Rol no encontrado" });
      }

      const { data: rows, error } = await supabase
        .from("RolPermiso")
        .select('"IdRolPermiso", "IdRol", "IdPermiso", "Estado", "FechaRegistro"')
        .eq("IdRol", idRol)
        .order("FechaRegistro", { ascending: false });

      if (error) {
        return res.status(500).json({
          message: "Error consultando permisos del rol",
          detail: error.message,
        });
      }

      const permisosMap = await getPermisosMapByIds((rows || []).map((x) => x.IdPermiso));

      return res.json({
        Rol: rol,
        PermisosAsignados: (rows || []).map((row) => ({
          ...row,
          Permiso: permisosMap[Number(row.IdPermiso)] || null,
        })),
      });
    } catch (error) {
      console.error("GET /roles/:id/permisos error:", error);
      return res.status(500).json({
        message: "Error interno consultando permisos del rol",
        detail: error.message,
      });
    }
  }
);

/**
 * POST /api/roles/:id/permisos
 */
router.post(
  "/:id/permisos",
  requireAuth,
  authorizeGlobalPermission(["ROLES_EDITAR"]),
  async (req, res) => {
    try {
      const idRol = toInt(req.params.id);
      const idPermiso = toInt(req.body?.idPermiso);
      const estado = parseEstado(req.body?.estado, ESTADO_ACTIVO);

      if (!idRol || idRol <= 0) {
        return res.status(400).json({ message: "id de rol inválido" });
      }

      if (!idPermiso || idPermiso <= 0) {
        return res.status(400).json({ message: "idPermiso es requerido" });
      }

      const rol = await getRolById(idRol);
      if (!rol) {
        return res.status(404).json({ message: "Rol no encontrado" });
      }

      const permiso = await getPermisoById(idPermiso);
      if (!permiso) {
        return res.status(404).json({ message: "Permiso no encontrado" });
      }

      const { data: existing, error: existingError } = await supabase
        .from("RolPermiso")
        .select('"IdRolPermiso", "IdRol", "IdPermiso", "Estado", "FechaRegistro"')
        .eq("IdRol", idRol)
        .eq("IdPermiso", idPermiso)
        .maybeSingle();

      if (existingError) {
        return res.status(500).json({
          message: "Error validando permiso del rol",
          detail: existingError.message,
        });
      }

      let savedRow = null;

      if (existing) {
        const { data: updated, error: updateError } = await supabase
          .from("RolPermiso")
          .update({
            Estado: estado,
            FechaRegistro: nowIso(),
          })
          .eq("IdRolPermiso", existing.IdRolPermiso)
          .select('"IdRolPermiso", "IdRol", "IdPermiso", "Estado", "FechaRegistro"')
          .single();

        if (updateError) {
          return res.status(500).json({
            message: "Error actualizando permiso del rol",
            detail: updateError.message,
          });
        }

        savedRow = updated;
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from("RolPermiso")
          .insert({
            IdRol: idRol,
            IdPermiso: idPermiso,
            Estado: estado,
            FechaRegistro: nowIso(),
          })
          .select('"IdRolPermiso", "IdRol", "IdPermiso", "Estado", "FechaRegistro"')
          .single();

        if (insertError) {
          return res.status(500).json({
            message: "Error asignando permiso al rol",
            detail: insertError.message,
          });
        }

        savedRow = inserted;
      }

      return res.status(201).json({
        message: "Permiso asignado correctamente",
        RolPermiso: {
          ...savedRow,
          Permiso: permiso,
        },
      });
    } catch (error) {
      console.error("POST /roles/:id/permisos error:", error);
      return res.status(500).json({
        message: "Error interno asignando permiso al rol",
        detail: error.message,
      });
    }
  }
);

/**
 * DELETE /api/roles/:id/rol-permisos/:idRolPermiso
 * Inactiva relación rol-permiso
 */
router.delete(
  "/:id/rol-permisos/:idRolPermiso",
  requireAuth,
  authorizeGlobalPermission(["ROLES_EDITAR"]),
  async (req, res) => {
    try {
      const idRol = toInt(req.params.id);
      const idRolPermiso = toInt(req.params.idRolPermiso);

      if (!idRol || idRol <= 0 || !idRolPermiso || idRolPermiso <= 0) {
        return res.status(400).json({ message: "Parámetros inválidos" });
      }

      const { data: existing, error: existingError } = await supabase
        .from("RolPermiso")
        .select('"IdRolPermiso", "IdRol", "IdPermiso", "Estado", "FechaRegistro"')
        .eq("IdRolPermiso", idRolPermiso)
        .eq("IdRol", idRol)
        .maybeSingle();

      if (existingError) {
        return res.status(500).json({
          message: "Error validando relación rol-permiso",
          detail: existingError.message,
        });
      }

      if (!existing) {
        return res.status(404).json({
          message: "Relación rol-permiso no encontrada",
        });
      }

      const { data, error } = await supabase
        .from("RolPermiso")
        .update({
          Estado: ESTADO_INACTIVO,
        })
        .eq("IdRolPermiso", idRolPermiso)
        .select('"IdRolPermiso", "IdRol", "IdPermiso", "Estado", "FechaRegistro"')
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error inactivando permiso del rol",
          detail: error.message,
        });
      }

      return res.json({
        message: "Permiso del rol inactivado correctamente",
        RolPermiso: data,
      });
    } catch (error) {
      console.error("DELETE /roles/:id/rol-permisos/:idRolPermiso error:", error);
      return res.status(500).json({
        message: "Error interno inactivando permiso del rol",
        detail: error.message,
      });
    }
  }
);

export default router;