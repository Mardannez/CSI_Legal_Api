import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { setInlinePdfHeaders } from "../helpers/pdf-response.helper.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Requisitos
 *     description: Consulta de requisitos y datos legales relacionados
 */

function parsePositiveInt(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) return "invalid";
  return n;
}

function postgresByteaToBuffer(value) {
  if (!value) return Buffer.alloc(0);

  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (typeof value === "string") {
    if (value.startsWith("\\x")) {
      return Buffer.from(value.slice(2), "hex");
    }

    if (value.startsWith("\\\\x")) {
      return Buffer.from(value.slice(3), "hex");
    }

    return Buffer.from(value, "base64");
  }

  throw new Error("Formato de bytea no soportado");
}

/**
 * GET /api/requisitos?countryId=1&q=energia
 */
/**
 * @swagger
 * /api/requisitos:
 *   get:
 *     summary: Listar requisitos
 *     tags: [Requisitos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: countryId
 *         required: false
 *         schema:
 *           type: integer
 *       - in: query
 *         name: subCategoriaId
 *         required: false
 *         schema:
 *           type: integer
 *       - in: query
 *         name: periocidadId
 *         required: false
 *         schema:
 *           type: integer
 *       - in: query
 *         name: responsableId
 *         required: false
 *         schema:
 *           type: integer
 *       - in: query
 *         name: q
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Requisitos consultados
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get("/", requireAuth, async (req, res) => {
  const requestId = `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    const countryId = parsePositiveInt(req.query.countryId);
    const subCategoriaId = parsePositiveInt(req.query.subCategoriaId);
    const periocidadId = parsePositiveInt(req.query.periocidadId);
    const responsableId = parsePositiveInt(req.query.responsableId);
    const q = (req.query.q || "").toString().trim();

    if (countryId === "invalid") return res.status(400).json({ message: "countryId inválido" });
    if (subCategoriaId === "invalid") return res.status(400).json({ message: "subCategoriaId inválido" });
    if (periocidadId === "invalid") return res.status(400).json({ message: "periocidadId inválido" });
    if (responsableId === "invalid") return res.status(400).json({ message: "responsableId inválido" });

    console.log(`[${requestId}] GET /api/requisitos query=`, req.query);

    let query = supabase
      .from("vw_RequisitoListado")
      .select(
        'id, "Titulo", "DescripcionRequisito", "Categoria","IdPais", "IdSubCategoria", "IdPeriocidad", "ResponsableEjecucion"'
      )
      .order("id", { ascending: true });

    // filtros
    if (countryId) query = query.eq("IdPais", countryId);
    if (subCategoriaId) query = query.eq("IdSubCategoria", subCategoriaId);
    if (periocidadId) query = query.eq("IdPeriocidad", periocidadId);
    if (responsableId) query = query.eq("ResponsableEjecucion", responsableId);

    // búsqueda (incluye Titulo)
    if (q.length > 0) {
      query = query.or(
        `Titulo.ilike.%${q}%,NombreRequisito.ilike.%${q}%,DescripcionRequisito.ilike.%${q}%`
      );
    }

    const { data, error } = await query;

    if (error) {
      console.error(`[${requestId}] ERROR /api/requisitos:`, error);
      return res.status(500).json({
        message: "Error consultando requisitos",
        detail: error.message,
        Debug: { requestId },
      });
    }

    return res.json({ Requisitos: data || [], Debug: { requestId } });
  } catch (err) {
    console.error(`[${requestId}] CATCH /api/requisitos:`, err);
    return res.status(500).json({
      message: "Error interno",
      detail: String(err),
      Debug: { requestId },
    });
  }
});

/**
 * @swagger
 * /api/requisitos/{requisitoId}/referencias-legales:
 *   get:
 *     summary: Listar referencias legales de un requisito
 *     tags: [Requisitos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requisitoId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Referencias legales consultadas
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get("/:requisitoId/referencias-legales", requireAuth, async (req, res) => {
  try {
    const requisitoId = parsePositiveInt(req.params.requisitoId);

    if (requisitoId === "invalid" || !requisitoId) {
      return res.status(400).json({
        message: "requisitoId invalido",
      });
    }

    const { data, error } = await supabase
      .from("ReferenciaLegal")
      .select("*")
      .eq("IdRequisito", requisitoId)
      .order("id", { ascending: true });

    if (error) {
      return res.status(500).json({
        message: "Error consultando referencias legales",
        detail: error.message,
      });
    }

    return res.json({
      ReferenciasLegales: data || [],
    });
  } catch (error) {
    console.error("GET /requisitos/:requisitoId/referencias-legales error:", error);

    return res.status(500).json({
      message: "Error interno consultando referencias legales",
      detail: error.message,
    });
  }
});

/**
 * @swagger
 * /api/requisitos/referencias-legales/{idReferenciaLegal}/leyes:
 *   get:
 *     summary: Listar leyes de una referencia legal
 *     tags: [Requisitos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: idReferenciaLegal
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Leyes consultadas
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get(
  "/referencias-legales/:idReferenciaLegal/leyes",
  requireAuth,
  async (req, res) => {
    try {
      const idReferenciaLegal = parsePositiveInt(req.params.idReferenciaLegal);

      if (idReferenciaLegal === "invalid" || !idReferenciaLegal) {
        return res.status(400).json({
          message: "idReferenciaLegal invalido",
        });
      }

      const { data, error } = await supabase
        .from("Ley")
        .select("id, IdReferenciaLegal, NombreLey")
        .eq("IdReferenciaLegal", idReferenciaLegal)
        .order("id", { ascending: true });

      if (error) {
        return res.status(500).json({
          message: "Error consultando leyes",
          detail: error.message,
        });
      }

      return res.json({
        Leyes: data || [],
      });
    } catch (error) {
      console.error(
        "GET /requisitos/referencias-legales/:idReferenciaLegal/leyes error:",
        error
      );

      return res.status(500).json({
        message: "Error interno consultando leyes",
        detail: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/requisitos/leyes/{id}/download:
 *   get:
 *     summary: Descargar PDF de una ley
 *     tags: [Requisitos]
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
 *         description: PDF de ley
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get("/leyes/:id/download", requireAuth, async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);

    if (id === "invalid" || !id) {
      return res.status(400).json({
        message: "id invalido",
      });
    }

    const { data: ley, error } = await supabase
      .from("Ley")
      .select("id, NombreLey, Documento")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        message: "Error consultando la ley",
        detail: error.message,
      });
    }

    if (!ley) {
      return res.status(404).json({
        message: "Ley no encontrada",
      });
    }

    const fileBuffer = postgresByteaToBuffer(ley.Documento);
    setInlinePdfHeaders(res, ley.NombreLey);

    return res.send(fileBuffer);
  } catch (error) {
    console.error("GET /requisitos/leyes/:id/download error:", error);

    return res.status(500).json({
      message: "Error interno descargando PDF",
      detail: error.message,
    });
  }
});

export default router;
