import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: EstadosRequisito
 *     description: Estados disponibles para requisitos evaluados
 */

/**
 * @swagger
 * /api/estados-requisito:
 *   get:
 *     summary: Listar estados de requisito
 *     tags: [EstadosRequisito]
 *     security:
 *       - bearerAuth: []
 *     parameters: []
 *     responses:
 *       200:
 *         description: Estados de requisito consultados
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("EstadoRequisito")
      .select('id, "Estado"')
      .order("id", { ascending: true });

    if (error) {
      return res.status(500).json({ message: "Error consultando EstadoRequisito", detail: error.message });
    }

    return res.json({ Estados: data || [] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;
