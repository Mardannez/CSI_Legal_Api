import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { authorizeGlobalPermission } from "../middlewares/authorizeGlobalPermission.middleware.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Licencias
 *     description: Administracion de licencias de empresa
 */

// ==========================================================
// LICENCIAS - CONSTANTES
// Estas rutas son administrativas y deben ser usadas solo por
// usuarios globales con permisos de administración.
//
// Importante:
// NO usamos requireActiveEmpresaLicense aquí, porque el propósito
// de este módulo es justamente administrar, renovar, suspender o
// cancelar licencias aunque estén vencidas.
// ==========================================================

const ESTADOS_LICENCIA = ["ACTIVA", "PENDIENTE", "SUSPENDIDA", "CANCELADA"];
const TIPOS_LICENCIA = ["ANUAL", "SEMESTRAL", "MENSUAL", "PRUEBA"];

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

function normalizeMoney(value) {
  if (value === undefined || value === null || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeDateOnly(value) {
  if (!value) return null;

  const raw = value.toString().trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

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
  if (!fechaFin) return 0;

  const today = new Date(`${getTodayDateOnly()}T00:00:00.000Z`);
  const end = new Date(`${fechaFin}T00:00:00.000Z`);

  if (Number.isNaN(end.getTime())) return 0;

  const diffMs = end.getTime() - today.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return Math.max(diffDays, 0);
}

function formatLicencia(licencia) {
  if (!licencia) {
    return null;
  }

  const estadoCalculado = calcularEstadoLicencia(licencia);

  return {
    id: Number(licencia.id),
    idEmpresa: Number(licencia.IdEmpresa),
    fechaInicio: licencia.FechaInicio || null,
    fechaFin: licencia.FechaFin || null,
    estado: licencia.Estado || null,
    estadoCalculado,
    tipoLicencia: licencia.TipoLicencia || null,
    maxUsuarios: licencia.MaxUsuarios ?? null,
    monto: licencia.Monto ?? null,
    moneda: licencia.Moneda || "HNL",
    fechaPago: licencia.FechaPago || null,
    referenciaPago: licencia.ReferenciaPago || null,
    observaciones: licencia.Observaciones || null,
    fechaRegistro: licencia.FechaRegistro || null,
    fechaActualizacion: licencia.FechaActualizacion || null,
    idUsuarioRegistro: licencia.IdUsuarioRegistro ?? null,
    diasRestantes: calcularDiasRestantes(licencia.FechaFin),
    puedeAcceder: estadoCalculado === "ACTIVA",
  };
}

function getLatestLicenseByCompany(licencias = []) {
  const map = new Map();

  for (const licencia of licencias || []) {
    const idEmpresa = Number(licencia.IdEmpresa);

    if (!map.has(idEmpresa)) {
      map.set(idEmpresa, licencia);
    }
  }

  return map;
}

async function getEmpresaById(idEmpresa) {
  const { data, error } = await supabase
    .from("Empresas")
    .select('id, "Nombre", "Estado", "IdPais"')
    .eq("id", idEmpresa)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getLicenciaById(idLicencia) {
  const { data, error } = await supabase
    .from("EmpresaLicencia")
    .select(
      'id, "IdEmpresa", "FechaInicio", "FechaFin", "Estado", "TipoLicencia", "MaxUsuarios", "Monto", "Moneda", "FechaPago", "ReferenciaPago", "Observaciones", "FechaRegistro", "FechaActualizacion", "IdUsuarioRegistro"'
    )
    .eq("id", idLicencia)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getLicenciasByEmpresaIds(idsEmpresa = []) {
  const uniqueIds = [...new Set(idsEmpresa.map(Number).filter(Boolean))];

  if (uniqueIds.length === 0) return [];

  const { data, error } = await supabase
    .from("EmpresaLicencia")
    .select(
      'id, "IdEmpresa", "FechaInicio", "FechaFin", "Estado", "TipoLicencia", "MaxUsuarios", "Monto", "Moneda", "FechaPago", "ReferenciaPago", "Observaciones", "FechaRegistro", "FechaActualizacion", "IdUsuarioRegistro"'
    )
    .in("IdEmpresa", uniqueIds)
    .order("FechaFin", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw error;
  return data || [];
}

function validateLicenciaPayload(body = {}, options = {}) {
  const { partial = false } = options;

  const fechaInicio = normalizeDateOnly(body.fechaInicio);
  const fechaFin = normalizeDateOnly(body.fechaFin);
  const estado = normalizeText(body.estado || "ACTIVA").toUpperCase();
  const tipoLicencia = normalizeText(body.tipoLicencia || "ANUAL").toUpperCase();
  const maxUsuarios = body.maxUsuarios !== undefined && body.maxUsuarios !== null && body.maxUsuarios !== ""
    ? toInt(body.maxUsuarios)
    : null;
  const monto = normalizeMoney(body.monto);
  const moneda = normalizeText(body.moneda || "HNL").toUpperCase();
  const fechaPago = body.fechaPago ? normalizeDateOnly(body.fechaPago) : null;

  if (!partial || body.fechaInicio !== undefined) {
    if (!fechaInicio) {
      return { ok: false, message: "fechaInicio es requerida y debe tener formato válido yyyy-MM-dd" };
    }
  }

  if (!partial || body.fechaFin !== undefined) {
    if (!fechaFin) {
      return { ok: false, message: "fechaFin es requerida y debe tener formato válido yyyy-MM-dd" };
    }
  }

  if (fechaInicio && fechaFin && fechaFin < fechaInicio) {
    return { ok: false, message: "fechaFin no puede ser menor que fechaInicio" };
  }

  if (body.estado !== undefined || !partial) {
    if (!ESTADOS_LICENCIA.includes(estado)) {
      return {
        ok: false,
        message: `estado inválido. Valores permitidos: ${ESTADOS_LICENCIA.join(", ")}`,
      };
    }
  }

  if (body.tipoLicencia !== undefined || !partial) {
    if (!TIPOS_LICENCIA.includes(tipoLicencia)) {
      return {
        ok: false,
        message: `tipoLicencia inválido. Valores permitidos: ${TIPOS_LICENCIA.join(", ")}`,
      };
    }
  }

  if (maxUsuarios !== null && (!Number.isInteger(maxUsuarios) || maxUsuarios <= 0)) {
    return { ok: false, message: "maxUsuarios debe ser un entero positivo" };
  }

  if (monto !== null && monto < 0) {
    return { ok: false, message: "monto no puede ser negativo" };
  }

  if (!moneda || moneda.length > 3) {
    return { ok: false, message: "moneda debe tener máximo 3 caracteres. Ejemplo: HNL, USD" };
  }

  return {
    ok: true,
    data: {
      ...(body.fechaInicio !== undefined || !partial ? { FechaInicio: fechaInicio } : {}),
      ...(body.fechaFin !== undefined || !partial ? { FechaFin: fechaFin } : {}),
      ...(body.estado !== undefined || !partial ? { Estado: estado } : {}),
      ...(body.tipoLicencia !== undefined || !partial ? { TipoLicencia: tipoLicencia } : {}),
      ...(body.maxUsuarios !== undefined ? { MaxUsuarios: maxUsuarios } : {}),
      ...(body.monto !== undefined ? { Monto: monto } : {}),
      ...(body.moneda !== undefined || !partial ? { Moneda: moneda } : {}),
      ...(body.fechaPago !== undefined ? { FechaPago: fechaPago } : {}),
      ...(body.referenciaPago !== undefined
        ? { ReferenciaPago: normalizeNullableText(body.referenciaPago) }
        : {}),
      ...(body.observaciones !== undefined
        ? { Observaciones: normalizeNullableText(body.observaciones) }
        : {}),
    },
  };
}

// ============================================================
// GET /api/licencias/catalogos
// Catálogos simples para combos del frontend.
// ============================================================
/**
 * @swagger
 * /api/licencias/catalogos:
 *   get:
 *     summary: Obtener catalogos de licencias
 *     tags: [Licencias]
 *     security:
 *       - bearerAuth: []
 *     parameters: []
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
router.get(
  "/catalogos",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_VER"]),
  async (req, res) => {
    return res.json({
      EstadosLicencia: ESTADOS_LICENCIA,
      TiposLicencia: TIPOS_LICENCIA,
      Monedas: ["HNL", "USD"],
    });
  }
);

// ============================================================
// GET /api/licencias
// Lista empresas con su licencia más reciente.
// Query params:
// - q: filtro por nombre de empresa
// - estadoLicencia: ACTIVA | VENCIDA | SIN_LICENCIA | SUSPENDIDA | CANCELADA | PENDIENTE
// - page
// - pageSize
// ============================================================
/**
 * @swagger
 * /api/licencias:
 *   get:
 *     summary: Listar empresas con su licencia mas reciente
 *     tags: [Licencias]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: estadoLicencia
 *         required: false
 *         schema:
 *           type: string
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
 *     responses:
 *       200:
 *         description: Licencias consultadas
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
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
      const estadoLicencia = normalizeText(req.query.estadoLicencia).toUpperCase();

      let empresasQuery = supabase
        .from("Empresas")
        .select('id, "Nombre", "Estado", "IdPais"', { count: "exact" })
        .order("Nombre", { ascending: true })
        .range(from, to);

      if (q) {
        empresasQuery = empresasQuery.ilike("Nombre", `%${q}%`);
      }

      const { data: empresas, error: empresasError, count } = await empresasQuery;

      if (empresasError) {
        return res.status(500).json({
          message: "Error consultando empresas",
          detail: empresasError.message,
        });
      }

      const empresaIds = (empresas || []).map((e) => Number(e.id)).filter(Boolean);
      const licencias = await getLicenciasByEmpresaIds(empresaIds);
      const latestLicenciasMap = getLatestLicenseByCompany(licencias);

      let rows = (empresas || []).map((empresa) => {
        const licencia = latestLicenciasMap.get(Number(empresa.id)) || null;
        const licenciaInfo = formatLicencia(licencia);

        return {
          Empresa: {
            id: Number(empresa.id),
            nombre: empresa.Nombre,
            estado: Number(empresa.Estado),
            idPais: empresa.IdPais ? Number(empresa.IdPais) : null,
          },
          Licencia: licenciaInfo || {
            id: null,
            idEmpresa: Number(empresa.id),
            fechaInicio: null,
            fechaFin: null,
            estado: "SIN_LICENCIA",
            estadoCalculado: "SIN_LICENCIA",
            tipoLicencia: null,
            maxUsuarios: null,
            monto: null,
            moneda: "HNL",
            fechaPago: null,
            referenciaPago: null,
            observaciones: null,
            fechaRegistro: null,
            fechaActualizacion: null,
            idUsuarioRegistro: null,
            diasRestantes: 0,
            puedeAcceder: false,
          },
        };
      });

      if (estadoLicencia) {
        rows = rows.filter((row) => row.Licencia?.estadoCalculado === estadoLicencia);
      }

      return res.json({
        Licencias: rows,
        Pagination: {
          page,
          pageSize,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / pageSize),
        },
      });
    } catch (error) {
      console.error("GET /licencias error:", error);

      return res.status(500).json({
        message: "Error interno consultando licencias",
        detail: error.message,
      });
    }
  }
);

// ============================================================
// GET /api/licencias/empresa/:idEmpresa
// Devuelve detalle de empresa e historial completo de licencias.
// ============================================================
/**
 * @swagger
 * /api/licencias/empresa/{idEmpresa}:
 *   get:
 *     summary: Obtener historial de licencias de una empresa
 *     tags: [Licencias]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: idEmpresa
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Licencia de empresa consultada
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
router.get(
  "/empresa/:idEmpresa",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_VER"]),
  async (req, res) => {
    try {
      const idEmpresa = toInt(req.params.idEmpresa);

      if (!idEmpresa || idEmpresa <= 0) {
        return res.status(400).json({ message: "idEmpresa inválido" });
      }

      const empresa = await getEmpresaById(idEmpresa);

      if (!empresa) {
        return res.status(404).json({ message: "Empresa no encontrada" });
      }

      const licencias = await getLicenciasByEmpresaIds([idEmpresa]);
      const licenciaActual = licencias?.[0] || null;

      return res.json({
        Empresa: {
          id: Number(empresa.id),
          nombre: empresa.Nombre,
          estado: Number(empresa.Estado),
          idPais: empresa.IdPais ? Number(empresa.IdPais) : null,
        },
        LicenciaActual: formatLicencia(licenciaActual),
        Historial: (licencias || []).map(formatLicencia),
      });
    } catch (error) {
      console.error("GET /licencias/empresa/:idEmpresa error:", error);

      return res.status(500).json({
        message: "Error interno consultando licencia de empresa",
        detail: error.message,
      });
    }
  }
);

// ============================================================
// POST /api/licencias/empresa/:idEmpresa
// Crea una nueva licencia para una empresa.
// Se usa para crear primera licencia o renovar generando un nuevo registro.
// ============================================================
/**
 * @swagger
 * /api/licencias/empresa/{idEmpresa}:
 *   post:
 *     summary: Crear una licencia para una empresa
 *     tags: [Licencias]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: idEmpresa
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       201:
 *         description: Licencia creada
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  "/empresa/:idEmpresa",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_EDITAR"]),
  async (req, res) => {
    try {
      const idEmpresa = toInt(req.params.idEmpresa);

      if (!idEmpresa || idEmpresa <= 0) {
        return res.status(400).json({ message: "idEmpresa inválido" });
      }

      const empresa = await getEmpresaById(idEmpresa);

      if (!empresa) {
        return res.status(404).json({ message: "Empresa no encontrada" });
      }

      const validation = validateLicenciaPayload(req.body, { partial: false });

      if (!validation.ok) {
        return res.status(400).json({ message: validation.message });
      }

      const { data, error } = await supabase
        .from("EmpresaLicencia")
        .insert({
          IdEmpresa: idEmpresa,
          ...validation.data,
          FechaRegistro: new Date().toISOString(),
          FechaActualizacion: null,
          IdUsuarioRegistro: req.user?.id || null,
        })
        .select(
          'id, "IdEmpresa", "FechaInicio", "FechaFin", "Estado", "TipoLicencia", "MaxUsuarios", "Monto", "Moneda", "FechaPago", "ReferenciaPago", "Observaciones", "FechaRegistro", "FechaActualizacion", "IdUsuarioRegistro"'
        )
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error creando licencia",
          detail: error.message,
        });
      }

      return res.status(201).json({
        message: "Licencia creada correctamente",
        Empresa: {
          id: Number(empresa.id),
          nombre: empresa.Nombre,
        },
        Licencia: formatLicencia(data),
      });
    } catch (error) {
      console.error("POST /licencias/empresa/:idEmpresa error:", error);

      return res.status(500).json({
        message: "Error interno creando licencia",
        detail: error.message,
      });
    }
  }
);

// ============================================================
// PUT /api/licencias/:id
// Edita una licencia existente.
// Útil para corregir fechas, monto, maxUsuarios o referencia de pago.
// ============================================================
/**
 * @swagger
 * /api/licencias/{id}:
 *   put:
 *     summary: Actualizar una licencia
 *     tags: [Licencias]
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
 *         description: Licencia actualizada
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.put(
  "/:id",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_EDITAR"]),
  async (req, res) => {
    try {
      const idLicencia = toInt(req.params.id);

      if (!idLicencia || idLicencia <= 0) {
        return res.status(400).json({ message: "id de licencia inválido" });
      }

      const licencia = await getLicenciaById(idLicencia);

      if (!licencia) {
        return res.status(404).json({ message: "Licencia no encontrada" });
      }

      const validation = validateLicenciaPayload(req.body, { partial: true });

      if (!validation.ok) {
        return res.status(400).json({ message: validation.message });
      }

      const payload = {
        ...validation.data,
        FechaActualizacion: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("EmpresaLicencia")
        .update(payload)
        .eq("id", idLicencia)
        .select(
          'id, "IdEmpresa", "FechaInicio", "FechaFin", "Estado", "TipoLicencia", "MaxUsuarios", "Monto", "Moneda", "FechaPago", "ReferenciaPago", "Observaciones", "FechaRegistro", "FechaActualizacion", "IdUsuarioRegistro"'
        )
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error actualizando licencia",
          detail: error.message,
        });
      }

      return res.json({
        message: "Licencia actualizada correctamente",
        Licencia: formatLicencia(data),
      });
    } catch (error) {
      console.error("PUT /licencias/:id error:", error);

      return res.status(500).json({
        message: "Error interno actualizando licencia",
        detail: error.message,
      });
    }
  }
);

// ============================================================
// PATCH /api/licencias/:id/suspender
// Suspende una licencia manualmente.
// ============================================================
/**
 * @swagger
 * /api/licencias/{id}/suspender:
 *   patch:
 *     summary: Suspender una licencia
 *     tags: [Licencias]
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
 *         description: Licencia suspendida
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
router.patch(
  "/:id/suspender",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_EDITAR"]),
  async (req, res) => {
    try {
      const idLicencia = toInt(req.params.id);

      if (!idLicencia || idLicencia <= 0) {
        return res.status(400).json({ message: "id de licencia inválido" });
      }

      const licencia = await getLicenciaById(idLicencia);

      if (!licencia) {
        return res.status(404).json({ message: "Licencia no encontrada" });
      }

      const observaciones = normalizeNullableText(req.body?.observaciones);

      const { data, error } = await supabase
        .from("EmpresaLicencia")
        .update({
          Estado: "SUSPENDIDA",
          Observaciones: observaciones || licencia.Observaciones || null,
          FechaActualizacion: new Date().toISOString(),
        })
        .eq("id", idLicencia)
        .select(
          'id, "IdEmpresa", "FechaInicio", "FechaFin", "Estado", "TipoLicencia", "MaxUsuarios", "Monto", "Moneda", "FechaPago", "ReferenciaPago", "Observaciones", "FechaRegistro", "FechaActualizacion", "IdUsuarioRegistro"'
        )
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error suspendiendo licencia",
          detail: error.message,
        });
      }

      return res.json({
        message: "Licencia suspendida correctamente",
        Licencia: formatLicencia(data),
      });
    } catch (error) {
      console.error("PATCH /licencias/:id/suspender error:", error);

      return res.status(500).json({
        message: "Error interno suspendiendo licencia",
        detail: error.message,
      });
    }
  }
);

// ============================================================
// PATCH /api/licencias/:id/cancelar
// Cancela una licencia manualmente.
// ============================================================
/**
 * @swagger
 * /api/licencias/{id}/cancelar:
 *   patch:
 *     summary: Cancelar una licencia
 *     tags: [Licencias]
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
 *         description: Licencia cancelada
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
router.patch(
  "/:id/cancelar",
  requireAuth,
  authorizeGlobalPermission(["USUARIOS_EDITAR"]),
  async (req, res) => {
    try {
      const idLicencia = toInt(req.params.id);

      if (!idLicencia || idLicencia <= 0) {
        return res.status(400).json({ message: "id de licencia inválido" });
      }

      const licencia = await getLicenciaById(idLicencia);

      if (!licencia) {
        return res.status(404).json({ message: "Licencia no encontrada" });
      }

      const observaciones = normalizeNullableText(req.body?.observaciones);

      const { data, error } = await supabase
        .from("EmpresaLicencia")
        .update({
          Estado: "CANCELADA",
          Observaciones: observaciones || licencia.Observaciones || null,
          FechaActualizacion: new Date().toISOString(),
        })
        .eq("id", idLicencia)
        .select(
          'id, "IdEmpresa", "FechaInicio", "FechaFin", "Estado", "TipoLicencia", "MaxUsuarios", "Monto", "Moneda", "FechaPago", "ReferenciaPago", "Observaciones", "FechaRegistro", "FechaActualizacion", "IdUsuarioRegistro"'
        )
        .single();

      if (error) {
        return res.status(500).json({
          message: "Error cancelando licencia",
          detail: error.message,
        });
      }

      return res.json({
        message: "Licencia cancelada correctamente",
        Licencia: formatLicencia(data),
      });
    } catch (error) {
      console.error("PATCH /licencias/:id/cancelar error:", error);

      return res.status(500).json({
        message: "Error interno cancelando licencia",
        detail: error.message,
      });
    }
  }
);

export default router;
