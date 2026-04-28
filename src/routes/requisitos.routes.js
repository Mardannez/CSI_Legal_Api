import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = Router();

function parsePositiveInt(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) return "invalid";
  return n;
}

/**
 * GET /api/requisitos?countryId=1&q=energia
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

export default router;