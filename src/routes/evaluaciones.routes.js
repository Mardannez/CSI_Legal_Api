import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { authorizeEmpresaAccess } from "../middlewares/authorizeEmpresaAcces.middleware.js";
import multer from 'multer';
import { requireActiveEmpresaLicense } from "../middlewares/licencia.middleware.js";


const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Evaluaciones
 *     description: Endpoints para evaluaciones, detalles, evidencias, eventos y responsables
 *
 * components:
 *   schemas:
 *     EvaluacionDashboardItem:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 10
 *         evaluacionId:
 *           type: integer
 *           example: 3
 *         requisitoId:
 *           type: integer
 *           example: 25
 *         name:
 *           type: string
 *           example: Licencia ambiental vigente
 *         description:
 *           type: string
 *           example: Requisito legal aplicable a la empresa
 *         estadoId:
 *           type: integer
 *           example: 1
 *         status:
 *           type: string
 *           example: Cumplido
 *         responsible:
 *           type: string
 *           example: Maria Lopez
 *         responsable:
 *           type: string
 *           nullable: true
 *           example: Maria Lopez
 *         plannedDate:
 *           type: string
 *           format: date
 *           nullable: true
 *           example: "2026-06-15"
 *         fechaPlanificada:
 *           type: string
 *           format: date
 *           nullable: true
 *           example: "2026-06-15"
 *         idPeriocidad:
 *           type: integer
 *           nullable: true
 *           example: 2
 *         periodicity:
 *           type: string
 *           example: Anual
 *         periocidad:
 *           type: string
 *           nullable: true
 *           example: Anual
 *         lastUpdate:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         ultimaActualizacion:
 *           type: string
 *           format: date-time
 *           nullable: true
 *     EvaluacionDashboardResponse:
 *       type: object
 *       properties:
 *         hasEvaluation:
 *           type: boolean
 *           example: true
 *         Evaluacion:
 *           type: object
 *           nullable: true
 *         Chart:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id:
 *                 type: integer
 *                 example: 1
 *               name:
 *                 type: string
 *                 example: Cumplido
 *               value:
 *                 type: integer
 *                 example: 12
 *         Items:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/EvaluacionDashboardItem'
 *         Totals:
 *           type: object
 *           properties:
 *             total:
 *               type: integer
 *               example: 42
 *     EvaluacionDetalleInformacion:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 10
 *         evaluacionId:
 *           type: integer
 *           example: 3
 *         requisitoId:
 *           type: integer
 *           example: 25
 *         name:
 *           type: string
 *           example: Licencia ambiental vigente
 *         description:
 *           type: string
 *           example: Requisito legal aplicable a la empresa
 *         estadoId:
 *           type: integer
 *           example: 1
 *         status:
 *           type: string
 *           example: Cumplido
 *         fechaPlanificada:
 *           type: string
 *           format: date
 *           nullable: true
 *           example: "2026-06-15"
 *         responsible:
 *           type: string
 *           example: Maria Lopez
 *         idPeriocidad:
 *           type: integer
 *           nullable: true
 *           example: 2
 *         periodicity:
 *           type: string
 *           example: Anual
 *         fechaRegistro:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         UltimaActualizacion:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         lastUpdate:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         responsableCatalogo:
 *           type: string
 *           nullable: true
 *           example: Encargado legal
 *     EvaluacionDetalleInformacionResponse:
 *       type: object
 *       properties:
 *         Informacion:
 *           $ref: '#/components/schemas/EvaluacionDetalleInformacion'
 */

function toInt(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}
/*#################### HELPERS Y FUNCIONES GENERALES DE EVALUACIONES ##################### */



/* Helpers para subir archivos y documentos */
const uploadEvidence = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB por archivo
    files: 10,
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "image/jpeg",
      "image/png",
    ];

    const fileName = file.originalname.toLowerCase();
    const allowedExtensions = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"];
    const hasValidExtension = allowedExtensions.some((ext) =>
      fileName.endsWith(ext)
    );

    if (!allowedMimeTypes.includes(file.mimetype) && !hasValidExtension) {
      return cb(
        new Error("Solo se permiten archivos PDF, DOC, DOCX, JPG o PNG")
      );
    }

    cb(null, true);
  },
});

function bufferToPostgresByteaHex(buffer) {
  return `\\x${buffer.toString("hex")}`;
}

function postgresByteaToBuffer(value) {
  if (!value) return Buffer.alloc(0);

  if (Buffer.isBuffer(value)) return value;

  if (typeof value === "string") {
    if (value.startsWith("\\x")) {
      return Buffer.from(value.slice(2), "hex");
    }

    if (value.startsWith("\\\\x")) {
      return Buffer.from(value.slice(3), "hex");
    }

    return Buffer.from(value, "base64");
  }

  throw new Error("Formato bytea no soportado");
}

function guessFileTypeFromBuffer(buffer) {
  if (!buffer || buffer.length < 4) {
    return {
      mime: "application/octet-stream",
      extension: "bin",
    };
  }

  // PDF
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return {
      mime: "application/pdf",
      extension: "pdf",
    };
  }

  // PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return {
      mime: "image/png",
      extension: "png",
    };
  }

  // JPG
  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return {
      mime: "image/jpeg",
      extension: "jpg",
    };
  }

  // DOCX (zip)
  if (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    return {
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      extension: "docx",
    };
  }

  // DOC clásico
  if (
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0
  ) {
    return {
      mime: "application/msword",
      extension: "doc",
    };
  }

  return {
    mime: "application/octet-stream",
    extension: "bin",
  };
}

function getExtensionFromFileName(fileName = "") {
  const match = fileName.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function sanitizeFileName(fileName = "") {
  return fileName
    .replace(/[^\w\s.-]/g, "_")
    .replace(/\s+/g, "_")
    .trim();
}

async function resolveCompanyIdByEvidenceId(evidenceId) {
  const { data: evidence, error: evidenceError } = await supabase
    .from("Evidencias")
    .select("id, IdEvaluacionDetalle")
    .eq("id", evidenceId)
    .maybeSingle();

  if (evidenceError) throw evidenceError;
  if (!evidence) return null;

  return resolveCompanyIdByDetalleId(Number(evidence.IdEvaluacionDetalle));
}

/* Fin Helpers para subir archivos y documentos */

function getEvaluacionId(row) {
  return Number(row?.id ?? row?.IdEvaluacionEncabezado) || null;
}

async function resolveCompanyIdByDetalleId(detalleId) {
  const { data: detalle, error: detErr } = await supabase
    .from("EvaluacionDetalle")
    .select('id, "IdEvaluacionEncabezado"')
    .eq("id", detalleId)
    .maybeSingle();

  if (detErr) throw detErr;
  if (!detalle) return null;

  const evaluacionId = getEvaluacionId({
    id: detalle.IdEvaluacionEncabezado,
  });

  if (!evaluacionId) return null;

  const { data: encabezado, error: encErr } = await supabase
    .from("EvaluacionEncabezado")
    .select('id, "IdEmpresa"')
    .eq("id", evaluacionId)
    .maybeSingle();

  if (encErr) throw encErr;
  if (!encabezado) return null;

  return Number(encabezado.IdEmpresa) || null;
}

/*################ Helper para agregar eventos ################### */
const TABLA_EVENTOS = "Eventos"; 
async function resolveCompanyIdByEventoId(eventoId) {
  const { data: evento, error: eventoError } = await supabase
    .from(TABLA_EVENTOS)
    .select("id, IdEvaluacionDetalle")
    .eq("id", eventoId)
    .maybeSingle();

  if (eventoError) throw eventoError;
  if (!evento) return null;

  return resolveCompanyIdByDetalleId(Number(evento.IdEvaluacionDetalle));
}

/*############### Helpers para agregar responsables *#####################*/

const TABLA_RESPONSABLES = "Responsables";
const TABLA_REQUISITO_RESPONSABLES = "RequisitoResponsables"; 
const TABLA_PERIOCIDAD = "Periocidad";

async function resolveCompanyIdByRequisitoResponsableId(relacionId) {
  const { data: relacion, error: relacionError } = await supabase
    .from(TABLA_REQUISITO_RESPONSABLES)
    .select("id, IdEvaluacionDetalle")
    .eq("id", relacionId)
    .maybeSingle();

  if (relacionError) throw relacionError;
  if (!relacion) return null;

  return resolveCompanyIdByDetalleId(Number(relacion.IdEvaluacionDetalle));
}

async function resolveEmpresaIdFromDetalleId(detalleId) {
  const empresaId = await resolveCompanyIdByDetalleId(detalleId);

  if (!empresaId || !Number.isInteger(Number(empresaId))) {
    return null;
  }

  return Number(empresaId);
}


/*############### Helpers para editar informacion del requisito *#####################*/

function getPeriocidadNombre(row) {
  if (!row) return "";

  return (
    row.Periocidad ||
    row.Nombre ||
    row.Descripcion ||
    row.NombrePeriocidad ||
    `Periodicidad #${row.id}`
  );
}

function normalizeDateOnly(value) {
  if (!value) return null;

  const raw = value.toString().trim();

  // Ya viene como yyyy-MM-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function normalizeStrictDateOnly(value) {
  if (!value) return null;

  const raw = value.toString().trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }

  const date = new Date(`${raw}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10) === raw ? raw : null;
}

function getProximoEventoFromBody(body = {}) {
  const hasPascal = Object.prototype.hasOwnProperty.call(body, "ProximoEvento");
  const hasCamel = Object.prototype.hasOwnProperty.call(body, "proximoEvento");

  if (hasPascal && hasCamel && body.ProximoEvento !== body.proximoEvento) {
    return {
      value: null,
      error: "ProximoEvento y proximoEvento deben tener el mismo valor",
    };
  }

  const rawValue = hasPascal ? body.ProximoEvento : body.proximoEvento;
  const value = normalizeStrictDateOnly(rawValue);

  if (!value) {
    return {
      value: null,
      error: "ProximoEvento es requerido y debe tener formato YYYY-MM-DD",
    };
  }

  return { value, error: null };
}

function requireSuperOrAdminGlobal(req, res, next) {
  const userId = toInt(req.user?.id);

  if (!userId || userId <= 0) {
    return res.status(401).json({
      ok: false,
      message: "No autenticado",
    });
  }

  return supabase
    .from("vw_UsuarioRolesGlobales")
    .select("RolCodigo")
    .eq("IdUsuario", userId)
    .in("RolCodigo", ["SUPER_ADMIN", "ADMIN_GLOBAL"])
    .limit(1)
    .then(({ data, error }) => {
      if (error) throw error;

      if (!data || data.length === 0) {
        return res.status(403).json({
          ok: false,
          message:
            "Solo usuarios SUPER_ADMIN o ADMIN_GLOBAL pueden actualizar ProximoEvento",
        });
      }

      return next();
    })
    .catch((error) => {
      console.error("requireSuperOrAdminGlobal error:", error);

      return res.status(500).json({
        ok: false,
        message: "Error interno validando rol global",
      });
    });
}

async function buildDetalleInformacionResponse(detalle) {
  const { data: requisito, error: requisitoError } = await supabase
    .from("vw_RequisitoListado")
    .select(
      'id, "Titulo", "DescripcionRequisito", "ResponsableEjecucion", "IdPais", "IdSubCategoria", "IdPeriocidad"'
    )
    .eq("id", detalle.IdRequisito)
    .maybeSingle();

  if (requisitoError) {
    const error = new Error("Error consultando información del requisito");
    error.detail = requisitoError.message;
    throw error;
  }

  const { data: estado, error: estadoError } = await supabase
    .from("EstadoRequisito")
    .select('id, "Estado"')
    .eq("id", detalle.IdEstadoRequisito)
    .maybeSingle();

  if (estadoError) {
    const error = new Error("Error consultando estado del requisito");
    error.detail = estadoError.message;
    throw error;
  }

  let periocidad = null;

  if (detalle.IdPeriocidad) {
    const { data: periocidadRow, error: periocidadError } = await supabase
      .from(TABLA_PERIOCIDAD)
      .select("*")
      .eq("id", detalle.IdPeriocidad)
      .maybeSingle();

    if (periocidadError) {
      const error = new Error("Error consultando periodicidad");
      error.detail = periocidadError.message;
      throw error;
    }

    periocidad = periocidadRow;
  }

  return {
    id: detalle.id,
    evaluacionId: detalle.IdEvaluacionEncabezado,
    requisitoId: detalle.IdRequisito,

    name: requisito?.Titulo || `Requisito #${detalle.IdRequisito}`,
    description: requisito?.DescripcionRequisito || "",

    estadoId: detalle.IdEstadoRequisito,
    status: estado?.Estado || "Desconocido",

    // Campos propios del detalle por empresa
    fechaPlanificada: detalle.FechaPlanificada || null,
    responsible: detalle.Responsable || "",
    idPeriocidad: detalle.IdPeriocidad || null,
    periodicity: getPeriocidadNombre(periocidad),

    fechaRegistro: detalle.FechaRegistro || null,
    UltimaActualizacion: detalle.UltimaActualizacion || null,
    lastUpdate: detalle.UltimaActualizacion || detalle.FechaRegistro || null,

    // Solo como referencia del catálogo, no editable en Información
    responsableCatalogo: requisito?.ResponsableEjecucion || null,
  };
}

/*############# Helper para resolver empresa por evaluacion ################*/

async function resolveCompanyIdByEvaluacionId(evaluacionId) {
  const { data: evaluacion, error } = await supabase
    .from("EvaluacionEncabezado")
    .select('id, "IdEmpresa"')
    .eq("id", evaluacionId)
    .maybeSingle();

  if (error) throw error;
  if (!evaluacion) return null;

  return Number(evaluacion.IdEmpresa) || null;
}

/*#################### HELPERS DE LICENCIA POR EMPRESA #####################

  Estos middlewares NO cambian la lógica de los endpoints.
  Solo validan que la empresa tenga licencia activa antes de permitir
  consultar/editar información de evaluación.

  Regla:
  - SUPER_ADMIN pasa siempre, aunque la licencia esté vencida.
  - Usuarios de empresa necesitan licencia activa.

######################################################################*/

const licenciaByCompanyIdQuery = requireActiveEmpresaLicense((req) =>
  toInt(req.query.companyId)
);

const licenciaByCompanyIdBody = requireActiveEmpresaLicense((req) =>
  toInt(req.body?.companyId)
);

const licenciaByDetalleId = requireActiveEmpresaLicense(async (req) => {
  const detalleId = toInt(req.params.detalleId);
  if (!detalleId || detalleId <= 0) return null;

  return resolveCompanyIdByDetalleId(detalleId);
});

const licenciaByEvidenceId = requireActiveEmpresaLicense(async (req) => {
  const evidenceId = toInt(req.params.id);
  if (!evidenceId || evidenceId <= 0) return null;

  return resolveCompanyIdByEvidenceId(evidenceId);
});

const licenciaByEventoId = requireActiveEmpresaLicense(async (req) => {
  const eventoId = toInt(req.params.id);
  if (!eventoId || eventoId <= 0) return null;

  return resolveCompanyIdByEventoId(eventoId);
});

const licenciaByRequisitoResponsableId = requireActiveEmpresaLicense(
  async (req) => {
    const relacionId = toInt(req.params.id);
    if (!relacionId || relacionId <= 0) return null;

    return resolveCompanyIdByRequisitoResponsableId(relacionId);
  }
);

const licenciaByEvaluacionId = requireActiveEmpresaLicense(async (req) => {
  const evaluacionId = toInt(req.params.evaluacionId);
  if (!evaluacionId || evaluacionId <= 0) return null;

  return resolveCompanyIdByEvaluacionId(evaluacionId);
});

/*#################### FIN HELPERS DE LICENCIA POR EMPRESA #####################*/


/*#################### FIN HELPERS Y FUNCIONES GENERALES DE EVALUACIONES ##################### */


/**
 * GET /api/evaluaciones/actual?companyId=1
 * Devuelve la evaluación más reciente de la empresa o null
 */
/**
 * @swagger
 * /api/evaluaciones/actual:
 *   get:
 *     summary: Obtener la evaluacion mas reciente de una empresa
 *     tags: [Evaluaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: companyId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Evaluacion encontrada o null
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get("/actual",requireAuth,authorizeEmpresaAccess({requiredPermissions: ["EVALUACIONES_VER"], resolveEmpresaId: async (req) => toInt(req.query.companyId),}),
licenciaByCompanyIdQuery,
async (req, res) => {
    try {
      const companyId = toInt(req.query.companyId);

      if (!companyId || companyId <= 0) {
        return res.status(400).json({
          message: "companyId debe ser un entero positivo",
        });
      }

      const { data, error } = await supabase
        .from("EvaluacionEncabezado")
        .select("*")
        .eq("IdEmpresa", companyId)
        .order("FechaRegistro", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("GET /evaluaciones/actual error:", error);
        return res.status(500).json({
          message: "Error consultando evaluación",
          detail: error.message,
        });
      }

      return res.json({ Evaluacion: data ?? null });
    } catch (err) {
      console.error("GET /evaluaciones/actual catch:", err);
      return res.status(500).json({ message: "Error interno" });
    }
  }
);

/**
 * POST /api/evaluaciones/iniciar
 * body:
 * {
 *   companyId: 1,
 *   mode: "all" | "selected",
 *   requisitosIds?: number[]
 * }
 */
/**
 * @swagger
 * /api/evaluaciones/iniciar:
 *   post:
 *     summary: Iniciar una evaluacion para una empresa
 *     tags: [Evaluaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters: []
 *     responses:
 *       201:
 *         description: Evaluacion iniciada
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       409:
 *         description: Ya existe una evaluacion activa
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  "/iniciar",
  requireAuth,
  authorizeEmpresaAccess({
  requiredPermissions: ["EVALUACIONES_EDITAR"],
  resolveEmpresaId: async (req) => toInt(req.body?.companyId),
  }),
  licenciaByCompanyIdBody,
  async (req, res) => {
    try {
      const { companyId, mode, requisitosIds } = req.body || {};

      const cId = toInt(companyId);
      if (!cId || cId <= 0) {
        return res.status(400).json({ message: "companyId inválido" });
      }

      const m = mode || "all";
      if (!["all", "selected"].includes(m)) {
        return res.status(400).json({
          message: "mode debe ser 'all' o 'selected'",
        });
      }

      const userId = toInt(req.user?.id);
      if (!userId || userId <= 0) {
        return res.status(401).json({
          message: "Token inválido: user id no encontrado",
        });
      }

      const { data: activa, error: actErr } = await supabase
        .from("EvaluacionEncabezado")
        .select("*")
        .eq("IdEmpresa", cId)
        .eq("Estado", 1)
        .order("FechaRegistro", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (actErr) {
        console.error("Check activa error:", actErr);
        return res.status(500).json({
          message: "Error validando evaluación activa",
          detail: actErr.message,
        });
      }

      if (activa) {
        return res.status(409).json({
          message: "Ya existe una evaluación activa para esta empresa",
          Evaluacion: activa,
        });
      }

      let reqList = [];

      if (m === "selected") {
        if (!Array.isArray(requisitosIds) || requisitosIds.length === 0) {
          return res.status(400).json({
            message: "requisitosIds es requerido en modo 'selected'",
          });
        }

        const ids = requisitosIds
          .map((x) => toInt(x))
          .filter((n) => n && n > 0);

        if (ids.length === 0) {
          return res.status(400).json({ message: "requisitosIds inválidos" });
        }

        const { data: requisitos, error: reqErr } = await supabase
          .from("Requisito")
          .select("id, IdPeriocidad")
          .in("id", ids);

        if (reqErr) {
          console.error("Requisitos selected error:", reqErr);
          return res.status(500).json({
            message: "Error consultando requisitos seleccionados",
            detail: reqErr.message,
          });
        }

        reqList = requisitos || [];

        if (reqList.length !== ids.length) {
          const found = new Set(reqList.map((r) => r.id));
          const missing = ids.filter((id) => !found.has(id));

          return res.status(400).json({
            message: "Uno o más requisitos no existen",
            missingIds: missing,
          });
        }
      } else {
        const { data: requisitos, error: reqErr } = await supabase
          .from("Requisito")
          .select("id, IdPeriocidad")
          .order("id", { ascending: true });

        if (reqErr) {
          console.error("Requisitos all error:", reqErr);
          return res.status(500).json({
            message: "Error consultando requisitos",
            detail: reqErr.message,
          });
        }

        reqList = requisitos || [];

        if (reqList.length === 0) {
          return res.status(400).json({
            message: "No hay requisitos para iniciar evaluación",
          });
        }
      }

      let estadoInicialId = 5;

      const { data: estadoRow, error: estErr } = await supabase
        .from("EstadoRequisito")
        .select("id")
        .eq("Estado", "No ha sucedido")
        .maybeSingle();

      if (estErr) {
        console.error("EstadoRequisito lookup error:", estErr);
        return res.status(500).json({
          message: "Error consultando EstadoRequisito",
          detail: estErr.message,
        });
      }

      if (estadoRow?.id) estadoInicialId = estadoRow.id;

      const now = new Date().toISOString();

      const { data: header, error: headerError } = await supabase
        .from("EvaluacionEncabezado")
        .insert({
          IdEmpresa: cId,
          FechaRegistro: now,
          UltimaVerificacion: null,
          UltimoHistorico: null,
          ProximoEvento: null,
          IdUsuarioRegistro: userId,
          Estado: 1,
        })
        .select("*")
        .single();

      if (headerError) {
        console.error("Insert encabezado error:", headerError);
        return res.status(500).json({
          message: "Error creando encabezado",
          detail: headerError.message,
        });
      }

      const headerId = getEvaluacionId(header);

      if (!headerId) {
        return res.status(500).json({
          message: "No se pudo determinar el id de la evaluación creada",
        });
      }

      const detalles = reqList.map((r) => ({
        FechaRegistro: now,
        IdEvaluacionEncabezado: headerId,
        IdRequisito: r.id,
        IdEstadoRequisito: estadoInicialId,
        IdPeriocidad: r.IdPeriocidad ?? null,
      }));

      const { error: detError } = await supabase
        .from("EvaluacionDetalle")
        .insert(detalles);

      if (detError) {
        console.error("Insert detalle error:", detError);

        await supabase
          .from("EvaluacionDetalle")
          .delete()
          .eq("IdEvaluacionEncabezado", headerId);

        await supabase
          .from("EvaluacionEncabezado")
          .delete()
          .eq("id", headerId);

        return res.status(500).json({
          message: "Error creando detalle",
          detail: detError.message,
          debug: {
            ejemploFila: detalles[0],
            totalFilas: detalles.length,
            estadoInicialId,
          },
        });
      }

      return res.status(201).json({
        message: "Evaluación iniciada",
        Evaluacion: header,
        RequisitosAsignados: detalles.length,
        EstadoInicial: { id: estadoInicialId, nombre: "No ha sucedido" },
      });
    } catch (err) {
      console.error("POST /evaluaciones/iniciar catch:", err);
      return res.status(500).json({
        message: "Error interno",
        detail: String(err),
      });
    }
  }
);

/**
 * GET /api/evaluaciones/dashboard?companyId=1
 */
/**
 * @swagger
 * /api/evaluaciones/dashboard:
 *   get:
 *     summary: Obtener dashboard de evaluacion por empresa
 *     tags: [Evaluaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: companyId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Dashboard de evaluacion
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EvaluacionDashboardResponse'
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  "/dashboard",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_VER"],
    resolveEmpresaId: async (req) => toInt(req.query.companyId),
  }),
  licenciaByCompanyIdQuery,
  async (req, res) => {
    const requestId = `dash-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    try {
      console.log(`[${requestId}] GET /api/evaluaciones/dashboard START`);
      console.log(`[${requestId}] query=`, req.query);
      console.log(`[${requestId}] user(id)=`, req.user?.id);

      const companyId = Number(req.query.companyId);
      if (!Number.isInteger(companyId) || companyId <= 0) {
        console.log(`[${requestId}] BAD companyId=`, req.query.companyId);
        return res.status(400).json({
          message: "companyId debe ser un entero positivo",
        });
      }

      let { data: evalHeader, error: headerErr } = await supabase
        .from("EvaluacionEncabezado")
        .select("*")
        .eq("IdEmpresa", companyId)
        .eq("Estado", 1)
        .order("FechaRegistro", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (headerErr) {
        console.error(
          `[${requestId}] ERROR EvaluacionEncabezado active`,
          headerErr
        );
        return res.status(500).json({
          message: "Error consultando EvaluacionEncabezado (active)",
          detail: headerErr.message,
        });
      }

      if (!evalHeader) {
        const alt = await supabase
          .from("EvaluacionEncabezado")
          .select("*")
          .eq("IdEmpresa", companyId)
          .order("FechaRegistro", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (alt.error) {
          console.error(
            `[${requestId}] ERROR EvaluacionEncabezado latest`,
            alt.error
          );
          return res.status(500).json({
            message: "Error consultando EvaluacionEncabezado (latest)",
            detail: alt.error.message,
          });
        }

        evalHeader = alt.data || null;
      }

      if (!evalHeader) {
        return res.json({
          hasEvaluation: false,
          Evaluacion: null,
          Chart: [],
          Items: [],
          Totals: { total: 0 },
        });
      }

      const evaluacionId = getEvaluacionId(evalHeader);

      if (!evaluacionId) {
        return res.status(500).json({
          message: "No se pudo determinar el id de la evaluación",
        });
      }

      const { data: detalles, error: detErr } = await supabase
        .from("EvaluacionDetalle")
        .select(
         'id, "FechaRegistro", "FechaPlanificada", "Responsable", "UltimaActualizacion", "IdEvaluacionEncabezado", "IdRequisito", "IdEstadoRequisito", "IdPeriocidad"'
        )
        .eq("IdEvaluacionEncabezado", evaluacionId)
        .order("id", { ascending: true });

      if (detErr) {
        console.error(`[${requestId}] ERROR EvaluacionDetalle`, detErr);
        return res.status(500).json({
          message: "Error consultando EvaluacionDetalle",
          detail: detErr.message,
        });
      }

      const detallesSafe = detalles || [];
      const reqIds = [
        ...new Set(detallesSafe.map((d) => d.IdRequisito).filter(Boolean)),
      ];

      const { data: requisitos, error: reqErr } = await supabase
        .from("vw_RequisitoListado")
        .select(
          'id, "Titulo", "DescripcionRequisito", "ResponsableEjecucion", "IdPais", "IdSubCategoria", "IdPeriocidad"'
        )
        .in("id", reqIds.length ? reqIds : [0]);

      if (reqErr) {
        console.error(`[${requestId}] ERROR Requisito`, reqErr);
        return res.status(500).json({
          message: "Error consultando Requisito",
          detail: reqErr.message,
        });
      }

      const { data: estados, error: estErr } = await supabase
        .from("EstadoRequisito")
        .select('id, "Estado"')
        .order("id", { ascending: true });

      if (estErr) {
        console.error(`[${requestId}] ERROR EstadoRequisito`, estErr);
        return res.status(500).json({
          message: "Error consultando EstadoRequisito",
          detail: estErr.message,
        });
      }

              const periocidadIds = [
          ...new Set(
            detallesSafe
              .map((d) => Number(d.IdPeriocidad))
              .filter((id) => Number.isInteger(id) && id > 0)
          ),
        ];

        let periocidadMap = new Map();

        if (periocidadIds.length > 0) {
          const { data: periocidades, error: periocidadErr } = await supabase
            .from(TABLA_PERIOCIDAD)
            .select("*")
            .in("id", periocidadIds);

          if (periocidadErr) {
            console.error(`[${requestId}] ERROR Periocidad`, periocidadErr);
            return res.status(500).json({
              message: "Error consultando Periocidad",
              detail: periocidadErr.message,
            });
          }

          periocidadMap = new Map(
            (periocidades || []).map((p) => [
              Number(p.id),
              p.Periocidad ||
                p.Nombre ||
                p.Descripcion ||
                p.NombrePeriocidad ||
                "No definido",
            ])
          );
        }



      const reqMap = new Map((requisitos || []).map((r) => [r.id, r]));
      const estadoMap = new Map((estados || []).map((e) => [e.id, e.Estado]));

          const items = detallesSafe.map((d) => {
          const r = reqMap.get(d.IdRequisito);
          const estadoNombre = estadoMap.get(d.IdEstadoRequisito) || "Desconocido";

          const idPeriocidad = d.IdPeriocidad ? Number(d.IdPeriocidad) : null;
          const nombrePeriocidad = idPeriocidad
            ? periocidadMap.get(idPeriocidad)
            : null;

          return {
            id: d.id,
            evaluacionId: d.IdEvaluacionEncabezado,
            requisitoId: d.IdRequisito,
            name: r?.Titulo || `Requisito #${d.IdRequisito}`,
            description: r?.DescripcionRequisito || "",
            estadoId: d.IdEstadoRequisito,
            status: estadoNombre,

            // Campos propios de EvaluacionDetalle
            responsible: d.Responsable || "No definido",
            responsable: d.Responsable || null,

            plannedDate: d.FechaPlanificada || null,
            fechaPlanificada: d.FechaPlanificada || null,

            idPeriocidad,
            periodicity: nombrePeriocidad || "No definido",
            periocidad: nombrePeriocidad || null,

            lastUpdate: d.UltimaActualizacion || d.FechaRegistro || null,
            ultimaActualizacion: d.UltimaActualizacion || null,
          };
        });
      const total = detallesSafe.length;
      const countsByEstadoId = new Map();

      for (const d of detallesSafe) {
        countsByEstadoId.set(
          d.IdEstadoRequisito,
          (countsByEstadoId.get(d.IdEstadoRequisito) || 0) + 1
        );
      }

      const chart = (estados || []).map((e) => ({
        id: e.id,
        name: e.Estado,
        value: countsByEstadoId.get(e.id) || 0,
      }));

      return res.json({
        hasEvaluation: true,
        Evaluacion: evalHeader,
        Chart: chart,
        Items: items,
        Totals: { total },
        Debug: { requestId },
      });
    } catch (err) {
      console.error(`[${requestId}] CATCH /dashboard`, err);
      return res.status(500).json({
        message: "Error interno",
        detail: String(err),
        Debug: { requestId },
      });
    }
  }
);

/**
 * PUT /api/evaluaciones/detalle/:detalleId/estado
 */
/**
 * @swagger
 * /api/evaluaciones/detalle/{detalleId}/estado:
 *   put:
 *     summary: Actualizar estado de un detalle de evaluacion
 *     tags: [Evaluaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: detalleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Estado actualizado
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: La evaluacion no esta activa
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.put(
  "/detalle/:detalleId/estado",
  requireAuth,
  authorizeEmpresaAccess({
  requiredPermissions: ["REQUISITOS_ESTADO_EDITAR"],
    resolveEmpresaId: async (req) => {
      const detalleId = toInt(req.params.detalleId);
      if (!detalleId || detalleId <= 0) return null;
      return resolveCompanyIdByDetalleId(detalleId);
    },
  }),
  licenciaByDetalleId,
  async (req, res) => {
    try {
      const detalleId = toInt(req.params.detalleId);
      const { estadoId } = req.body || {};
      const newEstadoId = toInt(estadoId);

      if (!detalleId || detalleId <= 0) {
        return res.status(400).json({ message: "detalleId inválido" });
      }

      if (!newEstadoId || newEstadoId <= 0) {
        return res.status(400).json({ message: "estadoId inválido" });
      }

      const { data: estadoRow, error: estErr } = await supabase
        .from("EstadoRequisito")
        .select('id, "Estado"')
        .eq("id", newEstadoId)
        .maybeSingle();

      if (estErr) {
        return res.status(500).json({
          message: "Error consultando EstadoRequisito",
          detail: estErr.message,
        });
      }

      if (!estadoRow) {
        return res.status(404).json({
          message: "EstadoRequisito no existe",
        });
      }

      const { data: detalle, error: detErr } = await supabase
        .from("EvaluacionDetalle")
        .select('id, "IdEvaluacionEncabezado", "IdEstadoRequisito"')
        .eq("id", detalleId)
        .maybeSingle();

      if (detErr) {
        return res.status(500).json({
          message: "Error consultando EvaluacionDetalle",
          detail: detErr.message,
        });
      }

      if (!detalle) {
        return res.status(404).json({
          message: "EvaluacionDetalle no existe",
        });
      }

      const { data: encabezado, error: encErr } = await supabase
        .from("EvaluacionEncabezado")
        .select('id, "Estado"')
        .eq("id", detalle.IdEvaluacionEncabezado)
        .maybeSingle();

      if (encErr) {
        return res.status(500).json({
          message: "Error consultando EvaluacionEncabezado",
          detail: encErr.message,
        });
      }

      if (!encabezado) {
        return res.status(404).json({
          message: "EvaluacionEncabezado no existe para este detalle",
        });
      }

      if (encabezado.Estado !== 1) {
        return res.status(409).json({
          message: "La evaluación no está activa (Estado != 1)",
        });
      }

      const { data: updated, error: updErr } = await supabase
        .from("EvaluacionDetalle")
        .update({ IdEstadoRequisito: newEstadoId })
        .eq("id", detalleId)
        .select('id, "IdEstadoRequisito"')
        .single();

      if (updErr) {
        return res.status(500).json({
          message: "Error actualizando estado",
          detail: updErr.message,
        });
      }

      return res.json({
        message: "Estado actualizado",
        Detalle: updated,
        Estado: estadoRow,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Error interno" });
    }
  }
);


/* #################### Subir evidencias a una evaluacion de una empresa ######################### */

/**
 * @swagger
 * /api/evaluaciones/detalle/{detalleId}/evidencias:
 *   get:
 *     summary: Listar evidencias de un detalle de evaluacion
 *     tags: [Evaluaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: detalleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Evidencias consultadas
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  "/detalle/:detalleId/evidencias",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_VER"],
    resolveEmpresaId: async (req) => {
      const detalleId = toInt(req.params.detalleId);
      if (!detalleId || detalleId <= 0) return null;
      return resolveCompanyIdByDetalleId(detalleId);
    },
  }),
  licenciaByDetalleId,
  async (req, res) => {
    try {
      const detalleId = toInt(req.params.detalleId);

      if (!detalleId || detalleId <= 0) {
        return res.status(400).json({
          message: "detalleId inválido",
        });
      }

      const { data, error } = await supabase
        .from("Evidencias")
        .select(
          "id, IdEvaluacionDetalle, Nombre, Descripcion, FechaRegistro, NombreArchivoOriginal, TipoMime"
        )
        .eq("IdEvaluacionDetalle", detalleId)
        .order("FechaRegistro", { ascending: false });

      if (error) {
        return res.status(500).json({
          message: "Error consultando evidencias",
          detail: error.message,
        });
      }

      return res.json({
        Evidencias: data || [],
      });
    } catch (error) {
      console.error("GET /detalle/:detalleId/evidencias error:", error);

      return res.status(500).json({
        message: "Error interno consultando evidencias",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/evaluaciones/detalle/{detalleId}/evidencias:
 *   post:
 *     summary: Subir evidencias a un detalle de evaluacion
 *     tags: [Evaluaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: detalleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       201:
 *         description: Evidencias cargadas
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
  "/detalle/:detalleId/evidencias",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_EDITAR"],
    resolveEmpresaId: async (req) => {
      const detalleId = toInt(req.params.detalleId);
      if (!detalleId || detalleId <= 0) return null;
      return resolveCompanyIdByDetalleId(detalleId);
    },
  }),
  licenciaByDetalleId,
  uploadEvidence.array("documentos", 10),
  async (req, res) => {
    try {
      const detalleId = toInt(req.params.detalleId);
      const nombre = (req.body?.nombre || "").toString().trim();
      const descripcion = (req.body?.descripcion || "").toString().trim();
      const fechaRegistro = (req.body?.fechaRegistro || "").toString().trim();

      const files = req.files || [];

      if (!detalleId || detalleId <= 0) {
        return res.status(400).json({
          message: "detalleId inválido",
        });
      }

      if (!nombre) {
        return res.status(400).json({
          message: "nombre es requerido",
        });
      }

      if (!fechaRegistro) {
        return res.status(400).json({
          message: "fechaRegistro es requerido",
        });
      }

      if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({
          message: 'Debe adjuntar al menos un archivo en el campo "documentos"',
        });
      }

      const { data: detalle, error: detalleError } = await supabase
        .from("EvaluacionDetalle")
        .select("id")
        .eq("id", detalleId)
        .maybeSingle();

      if (detalleError) {
        return res.status(500).json({
          message: "Error validando el detalle de evaluación",
          detail: detalleError.message,
        });
      }

      if (!detalle) {
        return res.status(404).json({
          message: "EvaluacionDetalle no encontrado",
        });
      }

      const fechaIso = new Date(`${fechaRegistro}T00:00:00`).toISOString();

      const payload = files.map((file, index) => {
        const finalNombre =
          files.length === 1
            ? nombre
            : `${nombre} - ${file.originalname || `archivo_${index + 1}`}`;

        return {
          IdEvaluacionDetalle: detalleId,
          Nombre: finalNombre,
          Descripcion: descripcion || null,
          FechaRegistro: fechaIso,
          Documento: bufferToPostgresByteaHex(file.buffer),
          NombreArchivoOriginal: file.originalname || null,
          TipoMime: file.mimetype || null,
        };
      });

      const { data, error } = await supabase
        .from("Evidencias")
        .insert(payload)
        .select(
          "id, IdEvaluacionDetalle, Nombre, Descripcion, FechaRegistro, NombreArchivoOriginal, TipoMime"
        );

      if (error) {
        return res.status(500).json({
          message: "Error guardando evidencia(s)",
          detail: error.message,
        });
      }

      return res.status(201).json({
        message: "Evidencia(s) cargada(s) correctamente",
        Evidencias: data || [],
      });
    } catch (error) {
      console.error("POST /detalle/:detalleId/evidencias error:", error);

      if (
        error?.message ===
        "Solo se permiten archivos PDF, DOC, DOCX, JPG o PNG"
      ) {
        return res.status(400).json({
          message: error.message,
        });
      }

      return res.status(500).json({
        message: "Error interno cargando evidencia(s)",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/evaluaciones/evidencias/{id}/download:
 *   get:
 *     summary: Descargar una evidencia
 *     tags: [Evaluaciones]
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
 *         description: Archivo de evidencia
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
  "/evidencias/:id/download",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_VER"],
    resolveEmpresaId: async (req) => {
      const evidenceId = toInt(req.params.id);
      if (!evidenceId || evidenceId <= 0) return null;
      return resolveCompanyIdByEvidenceId(evidenceId);
    },
  }),
  licenciaByEvidenceId,
  async (req, res) => {
    try {
      const id = toInt(req.params.id);

      if (!id || id <= 0) {
        return res.status(400).json({
          message: "id inválido",
        });
      }

      const { data: evidencia, error } = await supabase
        .from("Evidencias")
        .select("id, Nombre, Documento, NombreArchivoOriginal, TipoMime")
        .eq("id", id)
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          message: "Error consultando evidencia",
          detail: error.message,
        });
      }

      if (!evidencia) {
        return res.status(404).json({
          message: "Evidencia no encontrada",
        });
      }

      const fileBuffer = postgresByteaToBuffer(evidencia.Documento);

      // 1. Tomamos MIME real si existe; si no, lo inferimos del binario
      const guessed = guessFileTypeFromBuffer(fileBuffer);
      const mime = evidencia.TipoMime || guessed.mime;

      // 2. Tomamos nombre original si existe
      const originalName = evidencia.NombreArchivoOriginal
        ? sanitizeFileName(evidencia.NombreArchivoOriginal)
        : "";

      // 3. Si no hay nombre original, construimos uno con extensión real
      const ext =
        getExtensionFromFileName(originalName) ||
        guessed.extension ||
        "bin";

      const fallbackBaseName = sanitizeFileName(evidencia.Nombre || "evidencia");
      const finalFileName =
        originalName || `${fallbackBaseName}.${ext}`;

      res.setHeader("Content-Type", mime);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${finalFileName}"`
      );

      return res.send(fileBuffer);
    } catch (error) {
      console.error("GET /evidencias/:id/download error:", error);

      return res.status(500).json({
        message: "Error interno descargando evidencia",
        detail: error.message,
      });
    }
  }
);


/**
 * @swagger
 * /api/evaluaciones/evidencias/{id}:
 *   delete:
 *     summary: Eliminar una evidencia
 *     tags: [Evaluaciones]
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
 *         description: Evidencia eliminada
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
  "/evidencias/:id",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_EDITAR"],
    resolveEmpresaId: async (req) => {
      const evidenceId = toInt(req.params.id);
      if (!evidenceId || evidenceId <= 0) return null;
      return resolveCompanyIdByEvidenceId(evidenceId);
    },
  }),
  licenciaByEvidenceId,
  async (req, res) => {
    try {
      const id = toInt(req.params.id);

      if (!id || id <= 0) {
        return res.status(400).json({
          message: "id inválido",
        });
      }

      const { data, error } = await supabase
        .from("Evidencias")
        .delete()
        .eq("id", id)
        .select("id, Nombre, NombreArchivoOriginal")
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          message: "Error eliminando evidencia",
          detail: error.message,
        });
      }

      if (!data) {
        return res.status(404).json({
          message: "Evidencia no encontrada",
        });
      }

      return res.json({
        message: "Evidencia eliminada correctamente",
        Evidencia: data,
      });
    } catch (error) {
      console.error("DELETE /evidencias/:id error:", error);

      return res.status(500).json({
        message: "Error interno eliminando evidencia",
        detail: error.message,
      });
    }
  }
);

/* #################### Fin Subir evidencias a una evaluacion de una empresa ######################### */

/* #################### Agregando los Eventos y relacionaodo con evidencias ################ */

/**
 * @swagger
 * /api/evaluaciones/detalle/{detalleId}/eventos:
 *   get:
 *     summary: Listar eventos de un detalle de evaluacion
 *     tags: [Evaluaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: detalleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Eventos consultados
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  "/detalle/:detalleId/eventos",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_VER"],
    resolveEmpresaId: async (req) => {
      const detalleId = toInt(req.params.detalleId);
      if (!detalleId || detalleId <= 0) return null;
      return resolveCompanyIdByDetalleId(detalleId);
    },
  }),
  licenciaByDetalleId,
  async (req, res) => {
    try {
      const detalleId = toInt(req.params.detalleId);

      if (!detalleId || detalleId <= 0) {
        return res.status(400).json({
          message: "detalleId inválido",
        });
      }

      // 1) Traer eventos del detalle
      const { data: eventos, error: eventosError } = await supabase
        .from(TABLA_EVENTOS)
        .select("id, IdEvaluacionDetalle, FechaRegistro, IdEvidencia, Comentario")
        .eq("IdEvaluacionDetalle", detalleId)
        .order("FechaRegistro", { ascending: false });

      if (eventosError) {
        return res.status(500).json({
          message: "Error consultando eventos",
          detail: eventosError.message,
        });
      }

      const eventosRows = eventos || [];

      // 2) Traer evidencias relacionadas para enriquecer la respuesta
      const evidenciasIds = [
        ...new Set(
          eventosRows
            .map((x) => Number(x.IdEvidencia))
            .filter((x) => Number.isInteger(x) && x > 0)
        ),
      ];

      let evidenciasMap = {};

      if (evidenciasIds.length > 0) {
        const { data: evidencias, error: evidenciasError } = await supabase
          .from("Evidencias")
          .select(
            "id, Nombre, Descripcion, FechaRegistro, NombreArchivoOriginal, TipoMime"
          )
          .in("id", evidenciasIds);

        if (evidenciasError) {
          return res.status(500).json({
            message: "Error consultando evidencias relacionadas",
            detail: evidenciasError.message,
          });
        }

        evidenciasMap = Object.fromEntries(
          (evidencias || []).map((ev) => [Number(ev.id), ev])
        );
      }

      const result = eventosRows.map((evento) => ({
        ...evento,
        Evidencia: evidenciasMap[Number(evento.IdEvidencia)] || null,
      }));

      return res.json({
        Eventos: result,
      });
    } catch (error) {
      console.error("GET /detalle/:detalleId/eventos error:", error);

      return res.status(500).json({
        message: "Error interno consultando eventos",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/evaluaciones/detalle/{detalleId}/eventos:
 *   post:
 *     summary: Crear evento para un detalle de evaluacion
 *     tags: [Evaluaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: detalleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       201:
 *         description: Evento creado
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
  "/detalle/:detalleId/eventos",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_EDITAR"],
    resolveEmpresaId: async (req) => {
      const detalleId = toInt(req.params.detalleId);
      if (!detalleId || detalleId <= 0) return null;
      return resolveCompanyIdByDetalleId(detalleId);
    },
  }),
  licenciaByDetalleId,
  async (req, res) => {
    try {
      const detalleId = toInt(req.params.detalleId);
      const fechaRegistro = (req.body?.fechaRegistro || "").toString().trim();
      const idEvidencia = toInt(req.body?.idEvidencia);
      const comentario = (req.body?.comentario || "").toString().trim();

      if (!detalleId || detalleId <= 0) {
        return res.status(400).json({
          message: "detalleId inválido",
        });
      }

      if (!fechaRegistro) {
        return res.status(400).json({
          message: "fechaRegistro es requerido",
        });
      }

      if (!idEvidencia || idEvidencia <= 0) {
        return res.status(400).json({
          message: "idEvidencia es requerido",
        });
      }

      // 1) Validar que el detalle exista
      const { data: detalle, error: detalleError } = await supabase
        .from("EvaluacionDetalle")
        .select("id")
        .eq("id", detalleId)
        .maybeSingle();

      if (detalleError) {
        return res.status(500).json({
          message: "Error validando el detalle de evaluación",
          detail: detalleError.message,
        });
      }

      if (!detalle) {
        return res.status(404).json({
          message: "EvaluacionDetalle no encontrado",
        });
      }

      // 2) Validar que la evidencia exista y pertenezca al mismo detalle
      const { data: evidencia, error: evidenciaError } = await supabase
        .from("Evidencias")
        .select("id, IdEvaluacionDetalle, Nombre")
        .eq("id", idEvidencia)
        .maybeSingle();

      if (evidenciaError) {
        return res.status(500).json({
          message: "Error validando la evidencia",
          detail: evidenciaError.message,
        });
      }

      if (!evidencia) {
        return res.status(404).json({
          message: "Evidencia no encontrada",
        });
      }

      if (Number(evidencia.IdEvaluacionDetalle) !== detalleId) {
        return res.status(400).json({
          message:
            "La evidencia seleccionada no pertenece a este detalle de evaluación",
        });
      }

      const fechaIso = new Date(`${fechaRegistro}T00:00:00`).toISOString();

      // 3) Insertar evento
      const { data: eventoCreado, error: insertError } = await supabase
        .from(TABLA_EVENTOS)
        .insert({
          IdEvaluacionDetalle: detalleId,
          FechaRegistro: fechaIso,
          IdEvidencia: idEvidencia,
          Comentario: comentario || null,
        })
        .select("id, IdEvaluacionDetalle, FechaRegistro, IdEvidencia, Comentario")
        .single();

      if (insertError) {
        return res.status(500).json({
          message: "Error guardando evento",
          detail: insertError.message,
        });
      }

      return res.status(201).json({
        message: "Evento guardado correctamente",
        Evento: {
          ...eventoCreado,
          Evidencia: {
            id: evidencia.id,
            Nombre: evidencia.Nombre,
          },
        },
      });
    } catch (error) {
      console.error("POST /detalle/:detalleId/eventos error:", error);

      return res.status(500).json({
        message: "Error interno guardando evento",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/evaluaciones/eventos/{id}:
 *   delete:
 *     summary: Eliminar evento
 *     tags: [Evaluaciones]
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
 *         description: Evento eliminado
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
  "/eventos/:id",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_EDITAR"],
    resolveEmpresaId: async (req) => {
      const eventoId = toInt(req.params.id);
      if (!eventoId || eventoId <= 0) return null;
      return resolveCompanyIdByEventoId(eventoId);
    },
  }),
  licenciaByEventoId,
  async (req, res) => {
    try {
      const id = toInt(req.params.id);

      if (!id || id <= 0) {
        return res.status(400).json({
          message: "id inválido",
        });
      }

      const { data, error } = await supabase
        .from(TABLA_EVENTOS)
        .delete()
        .eq("id", id)
        .select("id, IdEvaluacionDetalle, FechaRegistro, IdEvidencia, Comentario")
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          message: "Error eliminando evento",
          detail: error.message,
        });
      }

      if (!data) {
        return res.status(404).json({
          message: "Evento no encontrado",
        });
      }

      return res.json({
        message: "Evento eliminado correctamente",
        Evento: data,
      });
    } catch (error) {
      console.error("DELETE /eventos/:id error:", error);

      return res.status(500).json({
        message: "Error interno eliminando evento",
        detail: error.message,
      });
    }
  }
);

/* #################### Fin Agregando los Eventos y relacionaodo con evidencias ################ */

/*###################  Agregando los responsables en evaluacion detalle ####################### */

/**
 * @swagger
 * /api/evaluaciones/detalle/{detalleId}/responsables/catalogo:
 *   get:
 *     summary: Listar catalogo de responsables
 *     tags: [Evaluaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: detalleId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: q
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Catalogo consultado
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  "/detalle/:detalleId/responsables/catalogo",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_VER"],
    resolveEmpresaId: async (req) => {
      const detalleId = toInt(req.params.detalleId);
      if (!detalleId || detalleId <= 0) return null;
      return resolveCompanyIdByDetalleId(detalleId);
    },
  }),
  licenciaByDetalleId,
  async (req, res) => {
    try {
      const detalleId = toInt(req.params.detalleId);
      const q = (req.query?.q || "").toString().trim();

      if (!detalleId || detalleId <= 0) {
        return res.status(400).json({
          message: "detalleId inválido",
        });
      }

      let query = supabase
        .from(TABLA_RESPONSABLES)
        .select("id, Nombre, Correo, FechaRegistro")
        .order("Nombre", { ascending: true });

      if (q) {
        query = query.or(`Nombre.ilike.%${q}%,Correo.ilike.%${q}%`);
      }

      const { data, error } = await query;

      if (error) {
        return res.status(500).json({
          message: "Error consultando catálogo de responsables",
          detail: error.message,
        });
      }

      return res.json({
        Responsables: data || [],
      });
    } catch (error) {
      console.error("GET /detalle/:detalleId/responsables/catalogo error:", error);

      return res.status(500).json({
        message: "Error interno consultando catálogo de responsables",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/evaluaciones/detalle/{detalleId}/responsables:
 *   post:
 *     summary: Asignar responsable a un detalle de evaluacion
 *     tags: [Evaluaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: detalleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       201:
 *         description: Responsable asignado
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Responsable ya asignado
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  "/detalle/:detalleId/responsables",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_EDITAR"],
    resolveEmpresaId: async (req) => {
      const detalleId = toInt(req.params.detalleId);
      if (!detalleId || detalleId <= 0) return null;
      return resolveCompanyIdByDetalleId(detalleId);
    },
  }),
  licenciaByDetalleId,
  async (req, res) => {
    try {
      const detalleId = toInt(req.params.detalleId);
      const idResponsable = toInt(req.body?.idResponsable);

      if (!detalleId || detalleId <= 0) {
        return res.status(400).json({
          message: "detalleId inválido",
        });
      }

      if (!idResponsable || idResponsable <= 0) {
        return res.status(400).json({
          message: "idResponsable es requerido",
        });
      }

      const empresaId = await resolveEmpresaIdFromDetalleId(detalleId);

      if (!empresaId) {
        return res.status(404).json({
          message: "No se pudo resolver la empresa del detalle",
        });
      }

      const { data: detalle, error: detalleError } = await supabase
        .from("EvaluacionDetalle")
        .select("id")
        .eq("id", detalleId)
        .maybeSingle();

      if (detalleError) {
        return res.status(500).json({
          message: "Error validando el detalle de evaluación",
          detail: detalleError.message,
        });
      }

      if (!detalle) {
        return res.status(404).json({
          message: "EvaluacionDetalle no encontrado",
        });
      }

      const { data: responsable, error: responsableError } = await supabase
        .from(TABLA_RESPONSABLES)
        .select("id, IdEmpresa, Nombre, Correo, FechaRegistro")
        .eq("id", idResponsable)
        .maybeSingle();

      if (responsableError) {
        return res.status(500).json({
          message: "Error validando responsable",
          detail: responsableError.message,
        });
      }

      if (!responsable) {
        return res.status(404).json({
          message: "Responsable no encontrado",
        });
      }

      if (Number(responsable.IdEmpresa) !== empresaId) {
        return res.status(400).json({
          message: "El responsable no pertenece a la empresa de este detalle",
        });
      }

      const { data: existente, error: existenteError } = await supabase
        .from(TABLA_REQUISITO_RESPONSABLES)
        .select("id")
        .eq("IdEvaluacionDetalle", detalleId)
        .eq("IdResponsable", idResponsable)
        .maybeSingle();

      if (existenteError) {
        return res.status(500).json({
          message: "Error validando asignación existente",
          detail: existenteError.message,
        });
      }

      if (existente) {
        return res.status(409).json({
          message: "Este responsable ya está asignado al requisito",
        });
      }

      const { data: relacion, error: insertError } = await supabase
        .from(TABLA_REQUISITO_RESPONSABLES)
        .insert({
          IdEvaluacionDetalle: detalleId,
          IdResponsable: idResponsable,
          FechaRegistro: new Date().toISOString(),
        })
        .select("id, IdEvaluacionDetalle, IdResponsable, FechaRegistro")
        .single();

      if (insertError) {
        return res.status(500).json({
          message: "Error asignando responsable",
          detail: insertError.message,
        });
      }

      return res.status(201).json({
        message: "Responsable asignado correctamente",
        ResponsableAsignado: {
          ...relacion,
          Responsable: responsable,
        },
      });
    } catch (error) {
      console.error("POST /detalle/:detalleId/responsables error:", error);

      return res.status(500).json({
        message: "Error interno asignando responsable",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/evaluaciones/detalle/{detalleId}/responsables:
 *   get:
 *     summary: Listar responsables asignados a un detalle
 *     tags: [Evaluaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: detalleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Responsables asignados consultados
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  "/detalle/:detalleId/responsables",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_VER"],
    resolveEmpresaId: async (req) => {
      const detalleId = toInt(req.params.detalleId);
      if (!detalleId || detalleId <= 0) return null;
      return resolveCompanyIdByDetalleId(detalleId);
    },
  }),
  licenciaByDetalleId,
  async (req, res) => {
    try {
      const detalleId = toInt(req.params.detalleId);

      if (!detalleId || detalleId <= 0) {
        return res.status(400).json({
          message: "detalleId inválido",
        });
      }

      const { data: relaciones, error: relacionesError } = await supabase
        .from(TABLA_REQUISITO_RESPONSABLES)
        .select("id, IdEvaluacionDetalle, IdResponsable, FechaRegistro")
        .eq("IdEvaluacionDetalle", detalleId)
        .order("FechaRegistro", { ascending: false });

      if (relacionesError) {
        return res.status(500).json({
          message: "Error consultando responsables asignados",
          detail: relacionesError.message,
        });
      }

      const relacionesRows = relaciones || [];

      const responsablesIds = [
        ...new Set(
          relacionesRows
            .map((x) => Number(x.IdResponsable))
            .filter((x) => Number.isInteger(x) && x > 0)
        ),
      ];

      let responsablesMap = {};

      if (responsablesIds.length > 0) {
        const { data: responsables, error: responsablesError } = await supabase
          .from(TABLA_RESPONSABLES)
          .select("id, IdEmpresa, Nombre, Correo, FechaRegistro")
          .in("id", responsablesIds);

        if (responsablesError) {
          return res.status(500).json({
            message: "Error consultando datos de responsables",
            detail: responsablesError.message,
          });
        }

        responsablesMap = Object.fromEntries(
          (responsables || []).map((r) => [Number(r.id), r])
        );
      }

      const result = relacionesRows.map((rel) => ({
        ...rel,
        Responsable: responsablesMap[Number(rel.IdResponsable)] || null,
      }));

      return res.json({
        ResponsablesAsignados: result,
      });
    } catch (error) {
      console.error("GET /detalle/:detalleId/responsables error:", error);

      return res.status(500).json({
        message: "Error interno consultando responsables asignados",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/evaluaciones/detalle/{detalleId}/responsables/disponibles:
 *   get:
 *     summary: Listar responsables disponibles por empresa del detalle
 *     tags: [Evaluaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: detalleId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: q
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Responsables disponibles consultados
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
  "/detalle/:detalleId/responsables/disponibles",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_VER"],
    resolveEmpresaId: async (req) => {
      const detalleId = toInt(req.params.detalleId);
      if (!detalleId || detalleId <= 0) return null;
      return resolveCompanyIdByDetalleId(detalleId);
    },
  }),
  licenciaByDetalleId,
  async (req, res) => {
    try {
      const detalleId = toInt(req.params.detalleId);
      const q = (req.query?.q || "").toString().trim();

      if (!detalleId || detalleId <= 0) {
        return res.status(400).json({
          message: "detalleId inválido",
        });
      }

      const empresaId = await resolveEmpresaIdFromDetalleId(detalleId);

      if (!empresaId) {
        return res.status(404).json({
          message: "No se pudo resolver la empresa del detalle",
        });
      }

      let query = supabase
        .from(TABLA_RESPONSABLES)
        .select("id, IdEmpresa, Nombre, Correo, FechaRegistro")
        .eq("IdEmpresa", empresaId)
        .order("Nombre", { ascending: true });

      if (q) {
        query = query.or(`Nombre.ilike.%${q}%,Correo.ilike.%${q}%`);
      }

      const { data, error } = await query;

      if (error) {
        return res.status(500).json({
          message: "Error consultando responsables disponibles",
          detail: error.message,
        });
      }

      return res.json({
        Responsables: data || [],
      });
    } catch (error) {
      console.error("GET /detalle/:detalleId/responsables/disponibles error:", error);

      return res.status(500).json({
        message: "Error interno consultando responsables disponibles",
        detail: error.message,
      });
    }
  }
);


/**
 * @swagger
 * /api/evaluaciones/detalle/{detalleId}/responsables/nuevo:
 *   post:
 *     summary: Crear y asignar responsable a un detalle
 *     tags: [Evaluaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: detalleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       201:
 *         description: Responsable creado y asignado
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Responsable ya asignado
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post(
  "/detalle/:detalleId/responsables/nuevo",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_EDITAR"],
    resolveEmpresaId: async (req) => {
      const detalleId = toInt(req.params.detalleId);
      if (!detalleId || detalleId <= 0) return null;
      return resolveCompanyIdByDetalleId(detalleId);
    },
  }),
  licenciaByDetalleId,
  async (req, res) => {
    try {
      const detalleId = toInt(req.params.detalleId);
      const nombre = (req.body?.nombre || "").toString().trim();
      const correo = (req.body?.correo || "").toString().trim();

      if (!detalleId || detalleId <= 0) {
        return res.status(400).json({
          message: "detalleId inválido",
        });
      }

      if (!nombre) {
        return res.status(400).json({
          message: "nombre es requerido",
        });
      }

      const empresaId = await resolveEmpresaIdFromDetalleId(detalleId);

      if (!empresaId) {
        return res.status(404).json({
          message: "No se pudo resolver la empresa del detalle",
        });
      }

      const { data: detalle, error: detalleError } = await supabase
        .from("EvaluacionDetalle")
        .select("id")
        .eq("id", detalleId)
        .maybeSingle();

      if (detalleError) {
        return res.status(500).json({
          message: "Error validando el detalle de evaluación",
          detail: detalleError.message,
        });
      }

      if (!detalle) {
        return res.status(404).json({
          message: "EvaluacionDetalle no encontrado",
        });
      }

      // Buscar si ya existe uno igual en la misma empresa
      let responsableExistente = null;

      if (correo) {
        const { data } = await supabase
          .from(TABLA_RESPONSABLES)
          .select("id, IdEmpresa, Nombre, Correo, FechaRegistro")
          .eq("IdEmpresa", empresaId)
          .eq("Correo", correo)
          .maybeSingle();

        responsableExistente = data || null;
      } else {
        const { data } = await supabase
          .from(TABLA_RESPONSABLES)
          .select("id, IdEmpresa, Nombre, Correo, FechaRegistro")
          .eq("IdEmpresa", empresaId)
          .eq("Nombre", nombre)
          .maybeSingle();

        responsableExistente = data || null;
      }

      let responsable = responsableExistente;

      if (!responsable) {
        const { data: creado, error: createError } = await supabase
          .from(TABLA_RESPONSABLES)
          .insert({
            IdEmpresa: empresaId,
            Nombre: nombre,
            Correo: correo || null,
            FechaRegistro: new Date().toISOString(),
          })
          .select("id, IdEmpresa, Nombre, Correo, FechaRegistro")
          .single();

        if (createError) {
          return res.status(500).json({
            message: "Error creando responsable",
            detail: createError.message,
          });
        }

        responsable = creado;
      }

      const { data: asignacionExistente, error: asignacionExistenteError } =
        await supabase
          .from(TABLA_REQUISITO_RESPONSABLES)
          .select("id")
          .eq("IdEvaluacionDetalle", detalleId)
          .eq("IdResponsable", responsable.id)
          .maybeSingle();

      if (asignacionExistenteError) {
        return res.status(500).json({
          message: "Error validando asignación existente",
          detail: asignacionExistenteError.message,
        });
      }

      if (asignacionExistente) {
        return res.status(409).json({
          message: "Este responsable ya está asignado al requisito",
          Responsable: responsable,
        });
      }

      const { data: relacion, error: insertError } = await supabase
        .from(TABLA_REQUISITO_RESPONSABLES)
        .insert({
          IdEvaluacionDetalle: detalleId,
          IdResponsable: responsable.id,
          FechaRegistro: new Date().toISOString(),
        })
        .select("id, IdEvaluacionDetalle, IdResponsable, FechaRegistro")
        .single();

      if (insertError) {
        return res.status(500).json({
          message: "Error asignando responsable nuevo",
          detail: insertError.message,
        });
      }

      return res.status(201).json({
        message: "Responsable creado y asignado correctamente",
        ResponsableAsignado: {
          ...relacion,
          Responsable: responsable,
        },
      });
    } catch (error) {
      console.error("POST /detalle/:detalleId/responsables/nuevo error:", error);

      return res.status(500).json({
        message: "Error interno creando y asignando responsable",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/evaluaciones/requisito-responsables/{id}:
 *   delete:
 *     summary: Desasignar responsable de un requisito evaluado
 *     tags: [Evaluaciones]
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
 *         description: Responsable desasignado
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
  "/requisito-responsables/:id",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_EDITAR"],
    resolveEmpresaId: async (req) => {
      const relacionId = toInt(req.params.id);
      if (!relacionId || relacionId <= 0) return null;
      return resolveCompanyIdByRequisitoResponsableId(relacionId);
    },
  }),
  licenciaByRequisitoResponsableId,
  async (req, res) => {
    try {
      const id = toInt(req.params.id);

      if (!id || id <= 0) {
        return res.status(400).json({
          message: "id inválido",
        });
      }

      const { data, error } = await supabase
        .from(TABLA_REQUISITO_RESPONSABLES)
        .delete()
        .eq("id", id)
        .select("id, IdEvaluacionDetalle, IdResponsable, FechaRegistro")
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          message: "Error eliminando asignación de responsable",
          detail: error.message,
        });
      }

      if (!data) {
        return res.status(404).json({
          message: "Asignación no encontrada",
        });
      }

      return res.json({
        message: "Responsable desasignado correctamente",
        ResponsableAsignado: data,
      });
    } catch (error) {
      console.error("DELETE /requisito-responsables/:id error:", error);

      return res.status(500).json({
        message: "Error interno eliminando asignación de responsable",
        detail: error.message,
      });
    }
  }
);

/*################### Fin Agregando los responsables en evaluacion detalle ####################### */


/*#################   Agregamos 2 enpoints para mejorar el campo de Informacion dentro del detalle de la evaluacion por requisito      #######################*/

/*### La solución correcta es agregar dos endpoints nuevos en tu mismo evaluaciones.routes.js: *###/
/*#### GET /api/evaluaciones/detalle/:detalleId/informacion ###*/
/*#### PUT /api/evaluaciones/detalle/:detalleId/informacion ##############*/

/**
 * GET /api/evaluaciones/detalle/:detalleId/informacion
 * Lee la información del requisito desde EvaluacionDetalle.
 * 
 * Campos editables:
 * - FechaPlanificada
 * - Responsable
 * - IdPeriocidad
 * 
 * Campos no editables:
 * - Nombre del requisito
 * - Descripción
 * - Estado
 */
/**
 * @swagger
 * /api/evaluaciones/detalle/{detalleId}/informacion:
 *   get:
 *     summary: Obtener informacion editable de un detalle de evaluacion
 *     tags: [Evaluaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: detalleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Informacion del detalle
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EvaluacionDetalleInformacionResponse'
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
  "/detalle/:detalleId/informacion",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_VER"],
    resolveEmpresaId: async (req) => {
      const detalleId = toInt(req.params.detalleId);
      if (!detalleId || detalleId <= 0) return null;
      return resolveCompanyIdByDetalleId(detalleId);
    },
  }),
  licenciaByDetalleId,
  async (req, res) => {
    try {
      const detalleId = toInt(req.params.detalleId);

      if (!detalleId || detalleId <= 0) {
        return res.status(400).json({
          message: "detalleId inválido",
        });
      }

      const { data: detalle, error: detalleError } = await supabase
        .from("EvaluacionDetalle")
        .select(
          'id, "FechaRegistro", "FechaPlanificada", "Responsable", "UltimaActualizacion", "IdEvaluacionEncabezado", "IdRequisito", "IdEstadoRequisito", "IdPeriocidad"'
        )
        .eq("id", detalleId)
        .maybeSingle();

      if (detalleError) {
        return res.status(500).json({
          message: "Error consultando EvaluacionDetalle",
          detail: detalleError.message,
        });
      }

      if (!detalle) {
        return res.status(404).json({
          message: "EvaluacionDetalle no encontrado",
        });
      }

      const informacion = await buildDetalleInformacionResponse(detalle);

      return res.json({
        Informacion: informacion,
      });
    } catch (error) {
      console.error("GET /detalle/:detalleId/informacion error:", error);

      return res.status(500).json({
        message: error.message || "Error interno consultando información",
        detail: error.detail || error.message,
      });
    }
  }
);

/**
 * PUT /api/evaluaciones/detalle/:detalleId/informacion
 * Actualiza solamente información propia del detalle por empresa.
 */
/**
 * @swagger
 * /api/evaluaciones/detalle/{detalleId}/informacion:
 *   put:
 *     summary: Actualizar informacion editable de un detalle de evaluacion
 *     tags: [Evaluaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: detalleId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Informacion del detalle actualizada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EvaluacionDetalleInformacionResponse'
 *       400:
 *         description: Datos invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: La evaluacion no esta activa
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.put(
  "/detalle/:detalleId/informacion",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_EDITAR"],
    resolveEmpresaId: async (req) => {
      const detalleId = toInt(req.params.detalleId);
      if (!detalleId || detalleId <= 0) return null;
      return resolveCompanyIdByDetalleId(detalleId);
    },
  }),
  licenciaByDetalleId,
  async (req, res) => {
    try {
      const detalleId = toInt(req.params.detalleId);

      const fechaPlanificada = normalizeDateOnly(req.body?.fechaPlanificada);
      const responsable = (req.body?.responsable || "").toString().trim();
      const idPeriocidad = toInt(req.body?.idPeriocidad);

      if (!detalleId || detalleId <= 0) {
        return res.status(400).json({
          message: "detalleId inválido",
        });
      }

      if (!fechaPlanificada) {
        return res.status(400).json({
          message: "fechaPlanificada es requerida y debe tener formato válido",
        });
      }

      if (!responsable) {
        return res.status(400).json({
          message: "responsable es requerido",
        });
      }

      if (!idPeriocidad || idPeriocidad <= 0) {
        return res.status(400).json({
          message: "idPeriocidad es requerido",
        });
      }

      const { data: detalle, error: detalleError } = await supabase
        .from("EvaluacionDetalle")
        .select(
          'id, "IdEvaluacionEncabezado", "IdRequisito", "IdEstadoRequisito", "IdPeriocidad"'
        )
        .eq("id", detalleId)
        .maybeSingle();

      if (detalleError) {
        return res.status(500).json({
          message: "Error consultando EvaluacionDetalle",
          detail: detalleError.message,
        });
      }

      if (!detalle) {
        return res.status(404).json({
          message: "EvaluacionDetalle no encontrado",
        });
      }

      const { data: encabezado, error: encabezadoError } = await supabase
        .from("EvaluacionEncabezado")
        .select('id, "Estado"')
        .eq("id", detalle.IdEvaluacionEncabezado)
        .maybeSingle();

      if (encabezadoError) {
        return res.status(500).json({
          message: "Error consultando EvaluacionEncabezado",
          detail: encabezadoError.message,
        });
      }

      if (!encabezado) {
        return res.status(404).json({
          message: "EvaluacionEncabezado no existe para este detalle",
        });
      }

      if (encabezado.Estado !== 1) {
        return res.status(409).json({
          message: "La evaluación no está activa (Estado != 1)",
        });
      }

      const { data: periocidad, error: periocidadError } = await supabase
        .from(TABLA_PERIOCIDAD)
        .select("*")
        .eq("id", idPeriocidad)
        .maybeSingle();

      if (periocidadError) {
        return res.status(500).json({
          message: "Error consultando periodicidad",
          detail: periocidadError.message,
        });
      }

      if (!periocidad) {
        return res.status(404).json({
          message: "La periodicidad seleccionada no existe",
        });
      }

      const { data: updated, error: updateError } = await supabase
        .from("EvaluacionDetalle")
        .update({
          FechaPlanificada: fechaPlanificada,
          Responsable: responsable,
          IdPeriocidad: idPeriocidad,
          UltimaActualizacion: new Date().toISOString(),
        })
        .eq("id", detalleId)
        .select(
          'id, "FechaRegistro", "FechaPlanificada", "Responsable", "UltimaActualizacion", "IdEvaluacionEncabezado", "IdRequisito", "IdEstadoRequisito", "IdPeriocidad"'
        )
        .single();

      if (updateError) {
        return res.status(500).json({
          message: "Error actualizando información del detalle",
          detail: updateError.message,
        });
      }

      const informacion = await buildDetalleInformacionResponse(updated);

      return res.json({
        message: "Información actualizada correctamente",
        Informacion: informacion,
      });
    } catch (error) {
      console.error("PUT /detalle/:detalleId/informacion error:", error);

      return res.status(500).json({
        message: "Error interno actualizando información",
        detail: error.message,
      });
    }
  }
);


/*#################  Fin Agregamos 2 enpoints para mejorar el campo de Informacion dentro del detalle de la evaluacion por requisito      #######################*/

/**
 * PUT /api/evaluaciones/:evaluacionId/proximo-evento
 * Actualiza ProximoEvento del encabezado de evaluacion.
 * Permitido solo para SUPER_ADMIN o ADMIN_GLOBAL.
 */
/**
 * @swagger
 * /api/evaluaciones/{evaluacionId}/proximo-evento:
 *   put:
 *     summary: Actualizar proximo evento de una evaluacion
 *     tags: [Evaluaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: evaluacionId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: ProximoEvento actualizado
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
  "/:evaluacionId/proximo-evento",
  requireAuth,
  requireSuperOrAdminGlobal,
  async (req, res) => {
    try {
      const evaluacionId = toInt(req.params.evaluacionId);

      if (!evaluacionId || evaluacionId <= 0) {
        return res.status(400).json({
          message: "evaluacionId invalido",
        });
      }

      const { value: proximoEvento, error: proximoEventoError } =
        getProximoEventoFromBody(req.body);

      if (proximoEventoError) {
        return res.status(400).json({
          message: proximoEventoError,
        });
      }

      const { data: evaluacion, error: evaluacionError } = await supabase
        .from("EvaluacionEncabezado")
        .select('id, "ProximoEvento"')
        .eq("id", evaluacionId)
        .maybeSingle();

      if (evaluacionError) {
        return res.status(500).json({
          message: "Error consultando EvaluacionEncabezado",
          detail: evaluacionError.message,
        });
      }

      if (!evaluacion) {
        return res.status(404).json({
          message: "EvaluacionEncabezado no encontrado",
        });
      }

      const { data: updated, error: updateError } = await supabase
        .from("EvaluacionEncabezado")
        .update({
          ProximoEvento: proximoEvento,
        })
        .eq("id", evaluacionId)
        .select("*")
        .single();

      if (updateError) {
        return res.status(500).json({
          message: "Error actualizando ProximoEvento",
          detail: updateError.message,
        });
      }

      return res.json({
        message: "ProximoEvento actualizado correctamente",
        Evaluacion: updated,
      });
    } catch (error) {
      console.error("PUT /:evaluacionId/proximo-evento error:", error);

      return res.status(500).json({
        message: "Error interno actualizando ProximoEvento",
        detail: error.message,
      });
    }
  }
);

/*##################### Endpoint para guardar los cambios de evaluacion ##################### */

/**
 * PUT /api/evaluaciones/:evaluacionId/guardar-cambios
 * Actualiza los campos resumen del encabezado de evaluación.
 *
 * Campos:
 * - UltimaVerificacion
 * - UltimoHistorico
 * - ProximoEvento
 */
/**
 * @swagger
 * /api/evaluaciones/{evaluacionId}/guardar-cambios:
 *   put:
 *     summary: Guardar cambios resumen del encabezado de evaluacion
 *     tags: [Evaluaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: evaluacionId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Cambios guardados
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: La evaluacion no esta activa
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.put(
  "/:evaluacionId/guardar-cambios",
  requireAuth,
  authorizeEmpresaAccess({
    requiredPermissions: ["EVALUACIONES_EDITAR"],
    resolveEmpresaId: async (req) => {
      const evaluacionId = toInt(req.params.evaluacionId);
      if (!evaluacionId || evaluacionId <= 0) return null;
      return resolveCompanyIdByEvaluacionId(evaluacionId);
    },
  }),
  licenciaByEvaluacionId,
  async (req, res) => {
    try {
      const evaluacionId = toInt(req.params.evaluacionId);

      if (!evaluacionId || evaluacionId <= 0) {
        return res.status(400).json({
          message: "evaluacionId inválido",
        });
      }

      const { data: evaluacion, error: evaluacionError } = await supabase
        .from("EvaluacionEncabezado")
        .select('id, "IdEmpresa", "Estado"')
        .eq("id", evaluacionId)
        .maybeSingle();

      if (evaluacionError) {
        return res.status(500).json({
          message: "Error consultando EvaluacionEncabezado",
          detail: evaluacionError.message,
        });
      }

      if (!evaluacion) {
        return res.status(404).json({
          message: "EvaluacionEncabezado no encontrado",
        });
      }

      if (evaluacion.Estado !== 1) {
        return res.status(409).json({
          message: "La evaluación no está activa (Estado != 1)",
        });
      }

      const { data: detalles, error: detallesError } = await supabase
        .from("EvaluacionDetalle")
        .select('id, "FechaRegistro", "UltimaActualizacion"')
        .eq("IdEvaluacionEncabezado", evaluacionId);

      if (detallesError) {
        return res.status(500).json({
          message: "Error consultando detalles de evaluación",
          detail: detallesError.message,
        });
      }

      const detallesSafe = detalles || [];

      const detalleIds = detallesSafe
        .map((d) => Number(d.id))
        .filter((id) => Number.isInteger(id) && id > 0);

      const now = new Date();
      const nowIso = now.toISOString();

      let ultimoHistorico = null;

      const fechasHistorico = detallesSafe
        .map((d) => d.UltimaActualizacion || d.FechaRegistro)
        .filter(Boolean)
        .map((fecha) => new Date(fecha))
        .filter((fecha) => !Number.isNaN(fecha.getTime()))
        .sort((a, b) => b.getTime() - a.getTime());

      if (fechasHistorico.length > 0) {
        ultimoHistorico = fechasHistorico[0].toISOString();
      }

      let proximoEvento = null;

      if (detalleIds.length > 0) {
        const { data: eventos, error: eventosError } = await supabase
          .from(TABLA_EVENTOS)
          .select('id, "IdEvaluacionDetalle", "FechaRegistro"')
          .in("IdEvaluacionDetalle", detalleIds)
          .gte("FechaRegistro", nowIso)
          .order("FechaRegistro", { ascending: true })
          .limit(1);

        if (eventosError) {
          return res.status(500).json({
            message: "Error consultando próximo evento",
            detail: eventosError.message,
          });
        }

        proximoEvento = eventos?.[0]?.FechaRegistro || null;
      }

      const { data: updated, error: updateError } = await supabase
        .from("EvaluacionEncabezado")
        .update({
          UltimaVerificacion: nowIso,
          UltimoHistorico: ultimoHistorico || nowIso,
          ProximoEvento: proximoEvento,
        })
        .eq("id", evaluacionId)
        .select("*")
        .single();

      if (updateError) {
        return res.status(500).json({
          message: "Error actualizando encabezado de evaluación",
          detail: updateError.message,
        });
      }

      return res.json({
        message: "Cambios de evaluación guardados correctamente",
        Evaluacion: updated,
      });
    } catch (error) {
      console.error("PUT /:evaluacionId/guardar-cambios error:", error);

      return res.status(500).json({
        message: "Error interno guardando cambios de evaluación",
        detail: error.message,
      });
    }
  }
);

export default router;
