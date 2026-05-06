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

async function getPermisoById(idPermiso) {
  const { data, error } = await supabase
    .from("Permisos")
    .select('"IdPermiso", "Codigo", "Nombre", "Modulo", "Descripcion", "Estado", "FechaRegistro"')
    .eq("IdPermiso", idPermiso)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * GET /api/permisos
 */
router.get(
  "/",
  requireAuth,
  authorizeGlobalPermission(["PERMISOS_VER"]),
  async (req, res) => {
    try {
      const page = Math.max(1, toInt(req.query.page) || 1);
      const pageSize = Math.max(1, Math.min(200, toInt(req.query.pageSize) || 10));
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const q = normalizeText(req.query.q);
      const estado = req.query.estado !== undefined ? toInt(req.query.estado) : null;
      const modulo = normalizeText(req.query.modulo);

      let query = supabase
        .from("Permisos")
        .select('"IdPermiso", "Codigo", "Nombre", "Modulo", "Descripcion", "Estado", "FechaRegistro"', {
          count: "exact",
        })
        .order("IdPermiso", { ascending: true })
        .range(from, to);

      if (q) {
        query = query.or(
          `"Codigo".ilike.%${q}%,"Nombre".ilike.%${q}%,"Modulo".ilike.%${q}%,"Descripcion".ilike.%${q}%`
        );
      }

      if (estado !== null) {
        query = query.eq("Estado", estado);
      }

      if (modulo) {
        query = query.eq("Modulo", modulo);
      }

      const { data, error, count } = await query;

      if (error) {
        return res.status(500).json({
          message: "Error consultando permisos",
          detail: error.message,
        });
      }

      return res.json({
        Permisos: data || [],
        Pagination: {
          page,
          pageSize,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / pageSize),
        },
      });
    } catch (error) {
      console.error("GET /permisos error:", error);
      return res.status(500).json({
        message: "Error interno consultando permisos",
        detail: error.message,
      });
    }
  }
);

/**
 * GET /api/permisos/:id
 */
router.get(
  "/:id",
  requireAuth,
  authorizeGlobalPermission(["PERMISOS_VER"]),
  async (req, res) => {
    try {
      const idPermiso = toInt(req.params.id);

      if (!idPermiso || idPermiso <= 0) {
        return res.status(400).json({ message: "id de permiso inválido" });
      }

      const permiso = await getPermisoById(idPermiso);

      if (!permiso) {
        return res.status(404).json({ message: "Permiso no encontrado" });
      }

      return res.json({ Permiso: permiso });
    } catch (error) {
      console.error("GET /permisos/:id error:", error);
      return res.status(500).json({
        message: "Error interno consultando permiso",
        detail: error.message,
      });
    }
  }
);

/**
 * POST /api/permisos
 */
router.post(
  "/",
  requireAuth,
  authorizeGlobalPermission(["PERMISOS_EDITAR"]),
  async (req, res) => {
    try {
      const codigo = normalizeText(req.body?.codigo);
      const nombre = normalizeText(req.body?.nombre);
      const modulo = normalizeText(req.body?.modulo);
      const descripcion = normalizeNullableText(req.body?.descripcion);
      const estado = parseEstado(req.body?.estado, ESTADO_ACTIVO);

      if (!codigo) {
        return res.status(400).json({ message: "codigo es requerido" });
      }

      if (!nombre) {
        return res.status(400).json({ message: "nombre es requerido" });
      }

      if (!modulo) {
        return res.status(400).json({ message: "modulo es requerido" });
      }

      const { data: duplicateCodigo, error: duplicateCodigoError } = await supabase
        .from("Permisos")
        .select('"IdPermiso"')
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
          message: "Ya existe un permiso con ese código",
        });
      }

      const { data, error } = await supabase
        .from("Permisos")
        .insert({
          Codigo: codigo,
          Nombre: nombre,
          Modulo: modulo,
          Descripcion: descripcion,
          Estado: estado,
          FechaRegistro: nowIso(),
        })
        .select('"IdPermiso", "Codigo", "Nombre", "Modulo", "Descripcion", "Estado", "FechaRegistro"')
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error creando permiso",
          detail: error.message,
        });
      }

      return res.status(201).json({
        message: "Permiso creado correctamente",
        Permiso: data,
      });
    } catch (error) {
      console.error("POST /permisos error:", error);
      return res.status(500).json({
        message: "Error interno creando permiso",
        detail: error.message,
      });
    }
  }
);

/**
 * PUT /api/permisos/:id
 */
router.put(
  "/:id",
  requireAuth,
  authorizeGlobalPermission(["PERMISOS_EDITAR"]),
  async (req, res) => {
    try {
      const idPermiso = toInt(req.params.id);

      if (!idPermiso || idPermiso <= 0) {
        return res.status(400).json({ message: "id de permiso inválido" });
      }

      const existing = await getPermisoById(idPermiso);

      if (!existing) {
        return res.status(404).json({ message: "Permiso no encontrado" });
      }

      const codigo = normalizeText(req.body?.codigo) || existing.Codigo;
      const nombre = normalizeText(req.body?.nombre) || existing.Nombre;
      const modulo = normalizeText(req.body?.modulo) || existing.Modulo;
      const descripcion =
        req.body?.descripcion !== undefined
          ? normalizeNullableText(req.body?.descripcion)
          : existing.Descripcion;
      const estado = parseEstado(req.body?.estado, existing.Estado);

      const { data: duplicateCodigo, error: duplicateCodigoError } = await supabase
        .from("Permisos")
        .select('"IdPermiso"')
        .eq("Codigo", codigo)
        .neq("IdPermiso", idPermiso)
        .maybeSingle();

      if (duplicateCodigoError) {
        return res.status(500).json({
          message: "Error validando código duplicado",
          detail: duplicateCodigoError.message,
        });
      }

      if (duplicateCodigo) {
        return res.status(409).json({
          message: "Ya existe otro permiso con ese código",
        });
      }

      const { data, error } = await supabase
        .from("Permisos")
        .update({
          Codigo: codigo,
          Nombre: nombre,
          Modulo: modulo,
          Descripcion: descripcion,
          Estado: estado,
        })
        .eq("IdPermiso", idPermiso)
        .select('"IdPermiso", "Codigo", "Nombre", "Modulo", "Descripcion", "Estado", "FechaRegistro"')
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error actualizando permiso",
          detail: error.message,
        });
      }

      return res.json({
        message: "Permiso actualizado correctamente",
        Permiso: data,
      });
    } catch (error) {
      console.error("PUT /permisos/:id error:", error);
      return res.status(500).json({
        message: "Error interno actualizando permiso",
        detail: error.message,
      });
    }
  }
);

/**
 * DELETE /api/permisos/:id
 * Inactiva permiso
 */
router.delete(
  "/:id",
  requireAuth,
  authorizeGlobalPermission(["PERMISOS_EDITAR"]),
  async (req, res) => {
    try {
      const idPermiso = toInt(req.params.id);

      if (!idPermiso || idPermiso <= 0) {
        return res.status(400).json({ message: "id de permiso inválido" });
      }

      const existing = await getPermisoById(idPermiso);

      if (!existing) {
        return res.status(404).json({ message: "Permiso no encontrado" });
      }

      const { data, error } = await supabase
        .from("Permisos")
        .update({ Estado: ESTADO_INACTIVO })
        .eq("IdPermiso", idPermiso)
        .select('"IdPermiso", "Codigo", "Nombre", "Modulo", "Descripcion", "Estado", "FechaRegistro"')
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error inactivando permiso",
          detail: error.message,
        });
      }

      return res.json({
        message: "Permiso inactivado correctamente",
        Permiso: data,
      });
    } catch (error) {
      console.error("DELETE /permisos/:id error:", error);
      return res.status(500).json({
        message: "Error interno inactivando permiso",
        detail: error.message,
      });
    }
  }
);

export default router;