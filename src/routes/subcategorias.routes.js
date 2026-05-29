import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Subcategorias
 *     description: Catalogo de subcategorias
 */

/**
 * @swagger
 * /api/subcategorias/options:
 *   get:
 *     summary: Listar opciones de subcategorias
 *     tags: [Subcategorias]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: categoriaId
 *         required: false
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Subcategorias consultadas
 *       400:
 *         description: Parametros invalidos
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * GET /api/subcategorias/options?categoriaId=2
 * Devuelve opciones con Label = "Categoria / SubCategoria"
 * Basado en la view public."vw_SubCategoriaOptions"
 */
router.get("/options", requireAuth, async (req, res) => {
  try {
    const categoriaId = req.query.categoriaId ? Number(req.query.categoriaId) : null;

    if (categoriaId !== null && (!Number.isInteger(categoriaId) || categoriaId <= 0)) {
      return res.status(400).json({ message: "categoriaId inválido" });
    }

    let q = supabase
      .from("vw_SubCategoriaOptions")
      .select('*')
      .order("Label", { ascending: true });

    if (categoriaId) q = q.eq("IdCategoria", categoriaId);

    const { data, error } = await q;

    if (error) {
      return res.status(500).json({ message: "Error consultando SubCategoria options", detail: error.message });
    }

    return res.json({ SubCategorias: data || [] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;
