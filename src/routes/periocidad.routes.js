import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = Router();

/**
 * GET /api/periocidad
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("Periocidad")
      .select('id, "Periocidad"')
      .order("id", { ascending: true });

    if (error) {
      return res.status(500).json({ message: "Error consultando Periocidad", detail: error.message });
    }

    return res.json({ Periocidades: data || [] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error interno" });
  }
});

export default router;